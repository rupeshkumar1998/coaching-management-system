require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const { hashPassword } = require("../../services/authService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const BASE_PATH = "/api/admin/subscription-plans";

const connectTestDB = require("../helpers/connectTestDB");


const createdUserIds = [];
const createdPlanIds = [];
const createdVersionIds = [];

let server;
let baseUrl;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

function makeToken(userId) {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token
        ? { Cookie: `accessToken=${options.token}` }
        : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  return {
    status: response.status,
    data,
  };
}

async function createTestUser(role) {
  const suffix = randomUUID();

  const user = await User.create({
    name: `API Test ${role}`,
    email: `api-test-${role.toLowerCase()}-${suffix}@example.com`,
    password: await hashPassword("TemporaryTestPassword123!"),
    role,
    instituteId: null,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  createdUserIds.push(user._id);

  return {
    user,
    token: makeToken(user._id),
  };
}

async function createTestPlan(actorId) {
  const plan = await SubscriptionPlan.create({
    code: `TST_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    name: "API Integration Test Plan",
    description: "Temporary plan created by the API integration test",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });

  createdPlanIds.push(plan._id);

  return plan;
}

function makeConfiguration(overrides = {}) {
  return {
    amount: 999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),
    limits: [],
    ...overrides,
  };
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from .env");
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from .env");
  }

  // Connect only to the isolated test database.
  await connectTestDB();

  try {
    // Start the actual Express app on an automatically selected port.
    const app = require("../../app");

    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => {
        resolve(instance);
      });

      instance.once("error", reject);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    console.log("Temporary API server started.");

    const admin = await createTestUser("SUPER_ADMIN");

    const owner = await createTestUser("INSTITUTE_OWNER");
    const instituteAdmin = await createTestUser("INSTITUTE_ADMIN");
    const teacher = await createTestUser("TEACHER");
    const student = await createTestUser("STUDENT");
    const parent = await createTestUser("PARENT");

    const plan = await createTestPlan(admin.user._id);

    const planPath = `${BASE_PATH}/${plan._id}/versions`;

    // 1. No authentication cookie.
    await test("Unauthenticated request returns 401", async () => {
      const result = await request(planPath, {
        method: "POST",
        body: { configuration: makeConfiguration() },
      });

      assert(result.status === 401, `Expected 401, received ${result.status}`);
    });

    // 2. Invalid token.
    await test("Invalid JWT returns 401", async () => {
      const result = await request(planPath, {
        method: "POST",
        token: "invalid.test.token",
        body: { configuration: makeConfiguration() },
      });

      assert(result.status === 401, `Expected 401, received ${result.status}`);
    });

    // // 3. Authenticated non-admin.
    // await test("INSTITUTE_OWNER is denied with 403", async () => {
    //   const result = await request(planPath, {
    //     method: "POST",
    //     token: owner.token,
    //     body: { configuration: makeConfiguration() },
    //   });

    //   assert(result.status === 403, `Expected 403, received ${result.status}`);
    // });

    // 3A. Other institute roles must not create subscription plan versions.
    const restrictedRoles = [
      { name: "INSTITUTE_OWNER", token: owner.token },
      { name: "INSTITUTE_ADMIN", token: instituteAdmin.token },
      { name: "TEACHER", token: teacher.token },
      { name: "STUDENT", token: student.token },
      { name: "PARENT", token: parent.token },
    ];

    for (const role of restrictedRoles) {
      await test(`${role.name} is denied subscription plan version creation`, async () => {
        const result = await request(planPath, {
          method: "POST",
          token: role.token,
          body: { configuration: makeConfiguration() },
        });

        assert(
          result.status === 403,
          `Expected 403 for ${role.name}, received ${result.status}`
        );
      });
    }

    // 4. Invalid Mongo ID.
    await test("SUPER_ADMIN invalid plan ID returns 400", async () => {
      const result = await request(
        `${BASE_PATH}/invalid-id/versions`,
        {
          method: "POST",
          token: admin.token,
          body: { configuration: makeConfiguration() },
        }
      );

      assert(result.status === 400, `Expected 400, received ${result.status}`);
      assert(
        result.data.success === false,
        "Expected success:false in validation response"
      );
    });

    let versionId;

    // 5. Create a draft through the real HTTP API.
    await test("SUPER_ADMIN creates a draft with HTTP 201", async () => {
      const result = await request(planPath, {
        method: "POST",
        token: admin.token,
        body: { configuration: makeConfiguration() },
      });

      assert(result.status === 201, `Expected 201, received ${result.status}`);
      assert(result.data.success === true, "Expected success:true");
      assert(result.data.data, "Expected created version in data");
      assert(result.data.data.status === "DRAFT", "Expected DRAFT status");
      assert(result.data.data.version === 1, "Expected version number 1");

      versionId = result.data.data._id;
      assert(versionId, "Created version ID is missing");

      createdVersionIds.push(
        new mongoose.Types.ObjectId(versionId)
      );
    });

    // 6. Invalid amount.
    await test("Negative amount is rejected with 400", async () => {
      const result = await request(planPath, {
        method: "POST",
        token: admin.token,
        body: {
          configuration: makeConfiguration({ amount: -10 }),
        },
      });

      assert(result.status === 400, `Expected 400, received ${result.status}`);
      assert(result.data.success === false, "Expected success:false");
    });

    if (versionId) {
      const versionPath =
        `${BASE_PATH}/${plan._id}/versions/${versionId}`;

      // 7A. Non-SUPER_ADMIN roles cannot update a draft.
      for (const role of restrictedRoles) {
        await test(`${role.name} is denied draft version update`, async () => {
          const result = await request(versionPath, {
            method: "PATCH",
            token: role.token,
            body: {
              configuration: { amount: 1499 },
            },
          });

          assert(
            result.status === 403,
            `Expected 403 for ${role.name}, received ${result.status}`
          );
        });
      }

      // 7. Update draft.
      await test("SUPER_ADMIN updates a draft with HTTP 200", async () => {
        const result = await request(versionPath, {
          method: "PATCH",
          token: admin.token,
          body: {
            configuration: { amount: 1299 },
          },
        });

        assert(result.status === 200, `Expected 200, received ${result.status}`);
        assert(result.data.success === true, "Expected success:true");
        assert(result.data.data.amount === 1299, "Expected amount 1299");
      });


      // 8A. Non-SUPER_ADMIN roles cannot publish a draft.
      for (const role of restrictedRoles) {
        await test(`${role.name} is denied draft version publishing`, async () => {
          const result = await request(`${versionPath}/publish`, {
            method: "POST",
            token: role.token,
            body: {},
          });

          assert(
            result.status === 403,
            `Expected 403 for ${role.name}, received ${result.status}`
          );
        });
      }
      // 8. Publish draft.
      await test("SUPER_ADMIN publishes a draft with HTTP 200", async () => {
        const result = await request(`${versionPath}/publish`, {
          method: "POST",
          token: admin.token,
          body: {},
        });

        assert(result.status === 200, `Expected 200, received ${result.status}`);
        assert(result.data.success === true, "Expected success:true");
        assert(
          result.data.data.status === "PUBLISHED",
          "Expected PUBLISHED status"
        );
      });

      // 9. Published version cannot be edited.
      await test("Published version cannot be edited", async () => {
        const result = await request(versionPath, {
          method: "PATCH",
          token: admin.token,
          body: {
            configuration: { amount: 1599 },
          },
        });

        assert(result.status === 409, `Expected 409, received ${result.status}`);
      });

      // 10A. Non-SUPER_ADMIN roles cannot retire a published version.
      for (const role of restrictedRoles) {
        await test(`${role.name} is denied published version retirement`, async () => {
          const result = await request(`${versionPath}/retire`, {
            method: "POST",
            token: role.token,
            body: {},
          });

          assert(
            result.status === 403,
            `Expected 403 for ${role.name}, received ${result.status}`
          );
        });
      }

      // 10. Retire published version.
      await test("SUPER_ADMIN retires a published version", async () => {
        const result = await request(`${versionPath}/retire`, {
          method: "POST",
          token: admin.token,
          body: {},
        });

        assert(result.status === 200, `Expected 200, received ${result.status}`);
        assert(result.data.success === true, "Expected success:true");
        assert(
          result.data.data.status === "RETIRED",
          "Expected RETIRED status"
        );
      });
    }
  } finally {
    console.log("\nCleaning up test-created records...");

    // Close HTTP listener before disconnecting from MongoDB.
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Delete only the IDs tracked by this test.
    // Raw collection cleanup intentionally bypasses lifecycle guards.
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }

    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }

    if (createdUserIds.length) {
      await User.deleteMany({
        _id: { $in: createdUserIds },
      });
    }

    await mongoose.disconnect();
  }

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});
