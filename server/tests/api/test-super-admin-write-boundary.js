require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const { AuditLog } = require("../../models/AuditLog");
const { hashPassword } = require("../../services/authService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const connectTestDB = require("../helpers/connectTestDB");

const createdUserIds = [];
const createdPlanIds = [];
const createdVersionIds = [];

let server;
let baseUrl;
let passed = 0;
let failed = 0;

// ------------------------------------------
// Harness
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

async function createTestUser(role) {
  const suffix = randomUUID();

  const user = await User.create({
    name: `Write Boundary ${role}`,
    email: `write-boundary-${role.toLowerCase()}-${suffix}@example.com`,
    password: await hashPassword("TemporaryTestPassword123!"),
    role,
    instituteId: null,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
  });

  createdUserIds.push(user._id);
  return { user, token: makeToken(user._id) };
}

function buildConfiguration(amount = 999) {
  return {
    amount,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),
    limits: [],
  };
}

// ------------------------------------------
// Runner
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
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    console.log("Temporary API server started.");

    // ------------------------------------------
    // Setup
    // ------------------------------------------

    const superAdmin = await createTestUser("SUPER_ADMIN");

    const nonAdminRoles = [
      { name: "INSTITUTE_OWNER", ...(await createTestUser("INSTITUTE_OWNER")) },
      { name: "INSTITUTE_ADMIN", ...(await createTestUser("INSTITUTE_ADMIN")) },
      { name: "TEACHER", ...(await createTestUser("TEACHER")) },
      { name: "STUDENT", ...(await createTestUser("STUDENT")) },
      { name: "PARENT", ...(await createTestUser("PARENT")) },
    ];

    // Create plan + DRAFT + PUBLISHED versions via raw inserts
    // so we don't burn the real lifecycle on setup.
    const planId = new mongoose.Types.ObjectId();

    await SubscriptionPlan.collection.insertOne({
      _id: planId,
      code: `BOUNDARY_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
      name: "Write Boundary Test Plan",
      description: "Write boundary matrix test",
      isActive: true,
      currentPublishedVersion: null,
      createdBy: superAdmin.user._id,
      updatedBy: superAdmin.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdPlanIds.push(planId);

    // A DRAFT version — target for update/publish tests.
    const draftVersionId = new mongoose.Types.ObjectId();
    await SubscriptionPlanVersion.collection.insertOne({
      _id: draftVersionId,
      planId,
      version: 1,
      status: "DRAFT",
      amount: 999,
      currency: "INR",
      durationDays: 30,
      paymentRequired: true,
      features: buildConfiguration().features,
      limits: [],
      createdBy: superAdmin.user._id,
      updatedBy: superAdmin.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdVersionIds.push(draftVersionId);

    // A PUBLISHED version — target for retire tests.
    const publishedVersionId = new mongoose.Types.ObjectId();
    await SubscriptionPlanVersion.collection.insertOne({
      _id: publishedVersionId,
      planId,
      version: 2,
      status: "PUBLISHED",
      amount: 1499,
      currency: "INR",
      durationDays: 30,
      paymentRequired: true,
      features: buildConfiguration().features,
      limits: [],
      publishedAt: new Date(),
      publishedBy: superAdmin.user._id,
      retiredAt: null,
      retiredBy: null,
      createdBy: superAdmin.user._id,
      updatedBy: superAdmin.user._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdVersionIds.push(publishedVersionId);

    // Point the plan at the published version.
    await SubscriptionPlan.collection.updateOne(
      { _id: planId },
      { $set: { currentPublishedVersion: publishedVersionId } }
    );

    // ------------------------------------------
    // Endpoint definitions
    // ------------------------------------------

    const endpoints = [
      {
        name: "POST create draft",
        method: "POST",
        path: `/api/admin/subscription-plans/${planId}/versions`,
        body: { configuration: buildConfiguration(1000) },
      },
      {
        name: "PATCH update draft",
        method: "PATCH",
        path: `/api/admin/subscription-plans/${planId}/versions/${draftVersionId}`,
        body: { configuration: { amount: 1200 } },
      },
      {
        name: "POST publish draft",
        method: "POST",
        path: `/api/admin/subscription-plans/${planId}/versions/${draftVersionId}/publish`,
        body: {},
      },
      {
        name: "POST retire published version",
        method: "POST",
        path: `/api/admin/subscription-plans/${planId}/versions/${publishedVersionId}/retire`,
        body: {},
      },
    ];

    // ==========================================
    // Section A — Non-admin roles blocked on every write endpoint
    // ==========================================

    for (const endpoint of endpoints) {
      for (const role of nonAdminRoles) {
        await test(
          `${role.name} → ${endpoint.name} is forbidden (403)`,
          async () => {
            const res = await request(endpoint.path, {
              method: endpoint.method,
              token: role.token,
              body: endpoint.body,
            });
            assert(
              res.status === 403,
              `Expected 403 for ${role.name} on ${endpoint.name}, got ${res.status}`
            );
            assert(
              res.data.success === false,
              "Expected success:false"
            );
          }
        );
      }
    }

    // ==========================================
    // Section B — Unauthenticated + invalid token
    // ==========================================

    for (const endpoint of endpoints) {
      await test(
        `Unauthenticated → ${endpoint.name} is 401`,
        async () => {
          const res = await request(endpoint.path, {
            method: endpoint.method,
            body: endpoint.body,
          });
          assert(
            res.status === 401,
            `Expected 401, got ${res.status}`
          );
        }
      );

      await test(
        `Invalid token → ${endpoint.name} is 401`,
        async () => {
          const res = await request(endpoint.path, {
            method: endpoint.method,
            token: "invalid.jwt.value",
            body: endpoint.body,
          });
          assert(
            res.status === 401,
            `Expected 401, got ${res.status}`
          );
        }
      );
    }

    // ==========================================
    // Section C — DB integrity: no non-admin wrote anything
    // ==========================================

    await test(
      "No non-admin attempts mutated the database",
      async () => {
        // After all the 403s, the DRAFT must still be DRAFT
        // at its original amount, and the PUBLISHED must still
        // be PUBLISHED with the plan pointer intact.
        const storedDraft = await SubscriptionPlanVersion.findById(
          draftVersionId
        );
        assert(
          storedDraft.status === "DRAFT",
          `DRAFT status changed to ${storedDraft.status}`
        );
        assert(
          storedDraft.amount === 999,
          `DRAFT amount changed to ${storedDraft.amount}`
        );

        const storedPublished = await SubscriptionPlanVersion.findById(
          publishedVersionId
        );
        assert(
          storedPublished.status === "PUBLISHED",
          `PUBLISHED status changed to ${storedPublished.status}`
        );

        const storedPlan = await SubscriptionPlan.findById(planId);
        assert(
          storedPlan.currentPublishedVersion.toString() ===
            publishedVersionId.toString(),
          "Plan pointer was mutated by a non-admin request"
        );

        // No extra versions must exist.
        const totalVersions =
          await SubscriptionPlanVersion.countDocuments({ planId });
        assert(
          totalVersions === 2,
          `Expected 2 versions, got ${totalVersions}`
        );
      }
    );

    // ==========================================
    // Section D — SUPER_ADMIN does succeed (sanity)
    // ==========================================

    await test(
      "SUPER_ADMIN succeeds on create draft (sanity)",
      async () => {
        const res = await request(endpoints[0].path, {
          method: "POST",
          token: superAdmin.token,
          body: {
            configuration: buildConfiguration(999),
          },
        });
        assert(
          res.status === 201,
          `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        createdVersionIds.push(
          new mongoose.Types.ObjectId(res.data.data._id)
        );
      }
    );

    await test(
      "SUPER_ADMIN succeeds on update draft (sanity)",
      async () => {
        const res = await request(
          endpoints[1].path,
          {
            method: "PATCH",
            token: superAdmin.token,
            body: { configuration: { amount: 1299 } },
          }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.amount === 1299,
          `Expected amount 1299, got ${res.data.data.amount}`
        );
      }
    );

    await test(
      "SUPER_ADMIN succeeds on publish draft (sanity)",
      async () => {
        // Publishing the draft retires the currently PUBLISHED v2.
        // This verifies that the write endpoints are genuinely wired.
        const res = await request(
          endpoints[2].path,
          {
            method: "POST",
            token: superAdmin.token,
            body: {},
          }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.status === "PUBLISHED",
          "Expected PUBLISHED"
        );
      }
    );

    await test(
      "SUPER_ADMIN succeeds on retire published version (sanity)",
      async () => {
        // The newly published draft is now the current version.
        const draftAfterPublish =
          await SubscriptionPlanVersion.findById(draftVersionId);
        assert(
          draftAfterPublish.status === "PUBLISHED",
          "Draft should be PUBLISHED after previous test"
        );

        const res = await request(
          `/api/admin/subscription-plans/${planId}/versions/${draftVersionId}/retire`,
          {
            method: "POST",
            token: superAdmin.token,
            body: {},
          }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.status === "RETIRED",
          "Expected RETIRED"
        );
      }
    );

    // ==========================================
    // Section E — No audit records from blocked attempts
    // ==========================================

    await test(
      "No audit records were created by blocked non-admin attempts",
      async () => {
        // Every non-admin attempt should have been rejected at
        // the role middleware before reaching the service layer,
        // so no audit records should reference the plan through
        // any non-SUPER_ADMIN actor.
        const logs = await AuditLog.find({ planId }).lean();

        const nonAdminActorIds = new Set(
          nonAdminRoles.map((r) => String(r.user._id))
        );

        const suspiciousLogs = logs.filter((log) =>
          nonAdminActorIds.has(String(log.actor))
        );

        assert(
          suspiciousLogs.length === 0,
          `Blocked attempts must not create audit logs, found ${suspiciousLogs.length}`
        );
      }
    );

    console.log(
      "\nAll write boundary matrix tests executed."
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
      await AuditLog.collection.deleteMany({
        planId: { $in: createdPlanIds },
      });
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
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