require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const { hashPassword } = require("../../services/authService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const connectTestDB = require("../helpers/connectTestDB");

const OWNER_BASE_PATH = "/api/owner/subscription-plans";
const ADMIN_BASE_PATH = "/api/admin/available-subscription-plans";

const createdUserIds = [];
const createdInstituteIds = [];
const createdPlanIds = [];
const createdVersionIds = [];

let server;
let baseUrl;
let passed = 0;
let failed = 0;

// ------------------------------------------
// Test harness helpers
// ------------------------------------------

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

  return { status: response.status, data };
}

// ------------------------------------------
// Fixtures
// ------------------------------------------

async function createTestUser(role, options = {}) {
  const suffix = randomUUID();

  const user = await User.create({
    name: `ReadOnly Boundary ${role}`,
    email: `readonly-${role.toLowerCase()}-${suffix}@example.com`,
    password: await hashPassword("TemporaryTestPassword123!"),
    role,
    instituteId: options.instituteId || null,
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

async function createTestInstitute(ownerId) {
  const instituteId = new mongoose.Types.ObjectId();

  // Raw insert: we bypass schema validation because only a
  // subset of fields is required for these tests.
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `INST_${instituteId.toString()}`,
    name: "Read-Only Boundary Test Institute",
    ownerId,
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    subscriptionPlan: "BASIC",
    subscriptionStatus: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdInstituteIds.push(instituteId);

  return instituteId;
}

async function createPublishedPlan(actorId, { code, amount = 999 }) {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code,
    name: `Plan ${code}`,
    description: "Read-only API test plan",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: 1,
    status: "PUBLISHED",
    amount,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),
    limits: [],
    publishedAt: new Date(),
    publishedBy: actorId,
    retiredAt: null,
    retiredBy: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdPlanIds.push(planId);
  createdVersionIds.push(versionId);

  return { planId, versionId, code };
}

async function addDraftVersion(planId, actorId, versionNumber) {
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: versionNumber,
    status: "DRAFT",
    amount: 999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),
    limits: [],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdVersionIds.push(versionId);

  return versionId;
}

async function createInactivePlan(actorId, { code }) {
  const planId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code,
    name: `Plan ${code}`,
    description: "Inactive plan for read-only test",
    isActive: false,
    currentPublishedVersion: null,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdPlanIds.push(planId);

  return planId;
}

// ------------------------------------------
// Test runner
// ------------------------------------------

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from .env");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from .env");
  }

  await connectTestDB();

  try {
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

    // ------------------------------------------
    // Setup: users, institute, plans
    // ------------------------------------------

    const superAdmin = await createTestUser("SUPER_ADMIN");
    const owner = await createTestUser("INSTITUTE_OWNER");

    const instituteId = await createTestInstitute(owner.user._id);

    // Owner must be associated with the institute created above.
    await User.updateOne(
      { _id: owner.user._id },
      { $set: { instituteId } }
    );

    const instituteAdmin = await createTestUser("INSTITUTE_ADMIN", {
      instituteId,
    });
    const teacher = await createTestUser("TEACHER");
    const student = await createTestUser("STUDENT");
    const parent = await createTestUser("PARENT");

    const publishedPlan = await createPublishedPlan(
      superAdmin.user._id,
      { code: "READONLY_BASIC", amount: 999 }
    );

    // Attach a DRAFT v2 to the same plan so we can prove
    // it never leaks to institute users.
    await addDraftVersion(
      publishedPlan.planId,
      superAdmin.user._id,
      2
    );

    const inactivePlan = await createInactivePlan(
      superAdmin.user._id,
      { code: "READONLY_INACTIVE" }
    );

    // ==========================================
    // Section A — Owner list endpoint
    // ==========================================

    await test(
      "Owner GET /api/owner/subscription-plans returns 200 with sanitized data",
      async () => {
        const res = await request(OWNER_BASE_PATH, {
          token: owner.token,
        });

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(res.data.success === true, "Expected success:true");
        assert(
          Array.isArray(res.data.data.plans),
          "Expected plans array"
        );

        const entry = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_BASIC"
        );
        assert(entry, "READONLY_BASIC plan not present");

        // Plan fields present
        assert(entry.plan.name, "Plan name missing");
        assert(entry.plan.isActive === true, "isActive missing");

        // Plan audit / internal fields must NOT leak
        assert(
          entry.plan._id === undefined,
          "plan._id must not leak"
        );
        assert(
          entry.plan.createdBy === undefined,
          "plan.createdBy must not leak"
        );
        assert(
          entry.plan.currentPublishedVersion === undefined,
          "plan.currentPublishedVersion must not leak"
        );

        // Version fields present
        assert(
          entry.version.amount === 999,
          `Expected amount 999, got ${entry.version.amount}`
        );
        assert(
          entry.version.currency === "INR",
          "version.currency mismatch"
        );

        // Version audit / internal fields must NOT leak
        assert(
          entry.version._id === undefined,
          "version._id must not leak"
        );
        assert(
          entry.version.planId === undefined,
          "version.planId must not leak"
        );
        assert(
          entry.version.publishedBy === undefined,
          "version.publishedBy must not leak"
        );
        assert(
          entry.version.retiredAt === undefined,
          "version.retiredAt must not leak"
        );
        assert(
          entry.version.retiredBy === undefined,
          "version.retiredBy must not leak"
        );
        assert(
          entry.version.createdBy === undefined,
          "version.createdBy must not leak"
        );

        // publishedAt is intentionally exposed
        assert(
          entry.version.publishedAt,
          "version.publishedAt should be present"
        );
      }
    );

    await test(
      "Owner list never leaks the DRAFT version",
      async () => {
        const res = await request(OWNER_BASE_PATH, {
          token: owner.token,
        });

        const entry = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_BASIC"
        );
        assert(entry, "Plan missing");

        assert(
          entry.version.version === 1,
          `Expected version 1 (PUBLISHED), got ${entry.version.version}`
        );
      }
    );

    await test(
      "Owner list excludes inactive plans",
      async () => {
        const res = await request(OWNER_BASE_PATH, {
          token: owner.token,
        });

        const inactiveEntry = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_INACTIVE"
        );

        assert(
          !inactiveEntry,
          "Inactive plan must not appear in the owner list"
        );
      }
    );

    const deniedRolesForOwner = [
      { name: "INSTITUTE_ADMIN", token: instituteAdmin.token },
      { name: "SUPER_ADMIN", token: superAdmin.token },
      { name: "TEACHER", token: teacher.token },
      { name: "STUDENT", token: student.token },
      { name: "PARENT", token: parent.token },
    ];

    for (const role of deniedRolesForOwner) {
      await test(
        `${role.name} cannot access /api/owner/subscription-plans`,
        async () => {
          const res = await request(OWNER_BASE_PATH, {
            token: role.token,
          });
          assert(
            res.status === 403,
            `Expected 403 for ${role.name}, got ${res.status}`
          );
        }
      );
    }

    await test(
      "Unauthenticated request to owner endpoint returns 401",
      async () => {
        const res = await request(OWNER_BASE_PATH);
        assert(
          res.status === 401,
          `Expected 401, got ${res.status}`
        );
      }
    );

    await test(
      "POST to owner list endpoint is not routed (404)",
      async () => {
        const res = await request(OWNER_BASE_PATH, {
          method: "POST",
          token: owner.token,
          body: { amount: 1 },
        });
        assert(
          res.status === 404,
          `Expected 404 for POST, got ${res.status}`
        );
      }
    );

    await test(
      "PATCH to owner list endpoint is not routed (404)",
      async () => {
        const res = await request(OWNER_BASE_PATH, {
          method: "PATCH",
          token: owner.token,
          body: { amount: 1 },
        });
        assert(
          res.status === 404,
          `Expected 404 for PATCH, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section B — Owner detail endpoint
    // ==========================================

    await test(
      "Owner GET /:planCode returns the published version",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/READONLY_BASIC`,
          { token: owner.token }
        );

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.data.plan.code === "READONLY_BASIC",
          "Plan code mismatch"
        );
        assert(
          res.data.data.version.version === 1,
          `Expected v1, got v${res.data.data.version.version}`
        );
        assert(
          res.data.data.version.publishedBy === undefined,
          "publishedBy must not leak"
        );
      }
    );

    await test(
      "Owner detail is case-insensitive on plan code",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/readonly_basic`,
          { token: owner.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.data.plan.code === "READONLY_BASIC",
          "Plan code must be normalized to uppercase"
        );
      }
    );

    await test(
      "Owner detail returns 404 for unknown plan",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/DOES_NOT_EXIST`,
          { token: owner.token }
        );
        assert(
          res.status === 404,
          `Expected 404, got ${res.status}`
        );
      }
    );

    await test(
      "Owner detail returns 409 for inactive plan",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/READONLY_INACTIVE`,
          { token: owner.token }
        );
        assert(
          res.status === 409,
          `Expected 409, got ${res.status}`
        );
      }
    );

    await test(
      "INSTITUTE_ADMIN cannot access /api/owner/subscription-plans/:planCode",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/READONLY_BASIC`,
          { token: instituteAdmin.token }
        );
        assert(
          res.status === 403,
          `Expected 403, got ${res.status}`
        );
      }
    );

    await test(
      "SUPER_ADMIN cannot access /api/owner/subscription-plans/:planCode",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/READONLY_BASIC`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 403,
          `Expected 403, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section C — Admin list endpoint
    // ==========================================

    await test(
      "Admin GET /api/admin/available-subscription-plans returns 200 with sanitized data",
      async () => {
        const res = await request(ADMIN_BASE_PATH, {
          token: instituteAdmin.token,
        });

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );

        const entry = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_BASIC"
        );
        assert(entry, "READONLY_BASIC plan not present");
        assert(
          entry.version.publishedBy === undefined,
          "publishedBy must not leak to admin"
        );
        assert(
          entry.plan._id === undefined,
          "plan._id must not leak to admin"
        );
      }
    );

    await test(
      "Admin list never leaks the DRAFT version",
      async () => {
        const res = await request(ADMIN_BASE_PATH, {
          token: instituteAdmin.token,
        });
        const entry = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_BASIC"
        );
        assert(
          entry.version.version === 1,
          `Expected v1, got v${entry.version.version}`
        );
      }
    );

    await test(
      "Admin list excludes inactive plans",
      async () => {
        const res = await request(ADMIN_BASE_PATH, {
          token: instituteAdmin.token,
        });
        const inactive = res.data.data.plans.find(
          (p) => p.plan.code === "READONLY_INACTIVE"
        );
        assert(
          !inactive,
          "Inactive plan must not appear in the admin list"
        );
      }
    );

    const deniedRolesForAdmin = [
      { name: "INSTITUTE_OWNER", token: owner.token },
      { name: "SUPER_ADMIN", token: superAdmin.token },
      { name: "TEACHER", token: teacher.token },
      { name: "STUDENT", token: student.token },
      { name: "PARENT", token: parent.token },
    ];

    for (const role of deniedRolesForAdmin) {
      await test(
        `${role.name} cannot access /api/admin/available-subscription-plans`,
        async () => {
          const res = await request(ADMIN_BASE_PATH, {
            token: role.token,
          });
          assert(
            res.status === 403,
            `Expected 403 for ${role.name}, got ${res.status}`
          );
        }
      );
    }

    await test(
      "Unauthenticated admin endpoint returns 401",
      async () => {
        const res = await request(ADMIN_BASE_PATH);
        assert(
          res.status === 401,
          `Expected 401, got ${res.status}`
        );
      }
    );

    await test(
      "POST to admin read-only endpoint is not routed (404)",
      async () => {
        const res = await request(ADMIN_BASE_PATH, {
          method: "POST",
          token: instituteAdmin.token,
          body: { amount: 1 },
        });
        assert(
          res.status === 404,
          `Expected 404 for POST, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section D — Admin detail endpoint
    // ==========================================

    await test(
      "Admin GET /:planCode returns the published version",
      async () => {
        const res = await request(
          `${ADMIN_BASE_PATH}/READONLY_BASIC`,
          { token: instituteAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.data.version.version === 1,
          "Expected v1"
        );
      }
    );

    await test(
      "Admin detail returns 404 for unknown plan",
      async () => {
        const res = await request(
          `${ADMIN_BASE_PATH}/DOES_NOT_EXIST`,
          { token: instituteAdmin.token }
        );
        assert(
          res.status === 404,
          `Expected 404, got ${res.status}`
        );
      }
    );

    await test(
      "INSTITUTE_OWNER cannot access admin detail endpoint",
      async () => {
        const res = await request(
          `${ADMIN_BASE_PATH}/READONLY_BASIC`,
          { token: owner.token }
        );
        assert(
          res.status === 403,
          `Expected 403, got ${res.status}`
        );
      }
    );

    await test(
      "SUPER_ADMIN cannot access admin detail endpoint",
      async () => {
        const res = await request(
          `${ADMIN_BASE_PATH}/READONLY_BASIC`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 403,
          `Expected 403, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section E — verify no writes are possible
    // ==========================================

    await test(
      "DELETE on admin read-only endpoint is not routed (404)",
      async () => {
        const res = await request(ADMIN_BASE_PATH, {
          method: "DELETE",
          token: instituteAdmin.token,
        });
        assert(
          res.status === 404,
          `Expected 404 for DELETE, got ${res.status}`
        );
      }
    );

    await test(
      "DELETE on owner detail endpoint is not routed (404)",
      async () => {
        const res = await request(
          `${OWNER_BASE_PATH}/READONLY_BASIC`,
          { method: "DELETE", token: owner.token }
        );
        assert(
          res.status === 404,
          `Expected 404 for DELETE, got ${res.status}`
        );
      }
    );

    console.log(
      "\nAll read-only boundary API tests executed."
    );
  } finally {
    console.log("\nCleaning up test-created records...");

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (createdVersionIds.length > 0) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }

    if (createdPlanIds.length > 0) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }

    if (createdInstituteIds.length > 0) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }

    if (createdUserIds.length > 0) {
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