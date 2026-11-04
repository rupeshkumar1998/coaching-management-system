require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const { AuditLog, AUDIT_ACTIONS } = require("../../models/AuditLog");
const { hashPassword } = require("../../services/authService");

const connectTestDB = require("../helpers/connectTestDB");

const BASE_PATH = "/api/admin/audit-logs";

const createdUserIds = [];
const createdPlanIds = [];
const createdAuditLogIds = [];

let server;
let baseUrl;
let passed = 0;
let failed = 0;

// ------------------------------------------
// Harness helpers
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
    name: `Audit API Test ${role}`,
    email: `audit-api-${role.toLowerCase()}-${suffix}@example.com`,
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

async function createTestPlan() {
  const planId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `AUDIT_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    name: "Audit API Test Plan",
    description: "Audit log API test",
    isActive: true,
    currentPublishedVersion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdPlanIds.push(planId);

  return planId;
}

async function insertAuditLog({
  actorId,
  planId,
  action = "PLAN_CREATED",
  planVersionId = null,
  oldValue = null,
  newValue = null,
  reason = null,
  timestamp = new Date(),
}) {
  const logId = new mongoose.Types.ObjectId();

  // Raw insert: bypasses the immutable-save guard so the
  // test can control the timestamp precisely.
  await AuditLog.collection.insertOne({
    _id: logId,
    action,
    actor: actorId,
    planId,
    planVersionId,
    oldValue,
    newValue,
    reason,
    timestamp,
  });

  createdAuditLogIds.push(logId);

  return logId;
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
      const instance = app.listen(0, "127.0.0.1", () => {
        resolve(instance);
      });
      instance.once("error", reject);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    console.log("Temporary API server started.");

    // Clean slate for audit logs so absolute-count assertions are
    // stable across repeated runs of this test file. Other test files
    // (e.g. test-subscription-plan-version-service.js) leave audit
    // logs behind on each run because they don't track planIds for
    // audit cleanup.
    await AuditLog.collection.deleteMany({});

    // ------------------------------------------
    // Setup
    // ------------------------------------------

    const superAdmin = await createTestUser("SUPER_ADMIN");
    const owner = await createTestUser("INSTITUTE_OWNER");
    const instituteAdmin = await createTestUser("INSTITUTE_ADMIN");
    const teacher = await createTestUser("TEACHER");
    const student = await createTestUser("STUDENT");
    const parent = await createTestUser("PARENT");

    const planA = await createTestPlan();
    const planB = await createTestPlan();

    const baseTime = Date.now();

    // Create 5 audit logs on planA and 2 on planB.
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planA,
      action: "PLAN_CREATED",
      newValue: { code: "PLAN_A" },
      timestamp: new Date(baseTime - 5000),
    });
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planA,
      action: "PLAN_DRAFT_CREATED",
      planVersionId: new mongoose.Types.ObjectId(),
      timestamp: new Date(baseTime - 4000),
    });
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planA,
      action: "PLAN_VERSION_PUBLISHED",
      planVersionId: new mongoose.Types.ObjectId(),
      timestamp: new Date(baseTime - 3000),
    });
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planA,
      action: "PLAN_PRICE_CHANGED",
      planVersionId: new mongoose.Types.ObjectId(),
      oldValue: { amount: 999 },
      newValue: { amount: 1499 },
      timestamp: new Date(baseTime - 2000),
    });
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planA,
      action: "PLAN_DISABLED",
      timestamp: new Date(baseTime - 1000),
    });

    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planB,
      action: "PLAN_CREATED",
      timestamp: new Date(baseTime - 800),
    });
    await insertAuditLog({
      actorId: superAdmin.user._id,
      planId: planB,
      action: "PLAN_ENABLED",
      timestamp: new Date(baseTime - 700),
    });

    // ==========================================
    // Section A — Access control
    // ==========================================

    await test(
      "SUPER_ADMIN can access /api/admin/audit-logs",
      async () => {
        const res = await request(BASE_PATH, {
          token: superAdmin.token,
        });
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          Array.isArray(res.data.data.logs),
          "Expected data.logs array"
        );
      }
    );

    const denied = [
      { name: "INSTITUTE_OWNER", token: owner.token },
      { name: "INSTITUTE_ADMIN", token: instituteAdmin.token },
      { name: "TEACHER", token: teacher.token },
      { name: "STUDENT", token: student.token },
      { name: "PARENT", token: parent.token },
    ];

    for (const role of denied) {
      await test(
        `${role.name} cannot access /api/admin/audit-logs`,
        async () => {
          const res = await request(BASE_PATH, {
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
      "Unauthenticated request returns 401",
      async () => {
        const res = await request(BASE_PATH);
        assert(
          res.status === 401,
          `Expected 401, got ${res.status}`
        );
      }
    );

    await test(
      "POST to audit-logs is not routed (404)",
      async () => {
        const res = await request(BASE_PATH, {
          method: "POST",
          token: superAdmin.token,
          body: { action: "PLAN_CREATED" },
        });
        assert(
          res.status === 404,
          `Expected 404, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section B — Validation
    // ==========================================

    await test(
      "Invalid planId returns 400",
      async () => {
        const res = await request(
          `${BASE_PATH}?planId=not-an-id`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 400,
          `Expected 400, got ${res.status}`
        );
      }
    );

    await test(
      "Invalid action returns 400",
      async () => {
        const res = await request(
          `${BASE_PATH}?action=NOT_A_REAL_ACTION`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 400,
          `Expected 400, got ${res.status}`
        );
      }
    );

    await test(
      "Invalid actorId returns 400",
      async () => {
        const res = await request(
          `${BASE_PATH}?actorId=not-an-id`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 400,
          `Expected 400, got ${res.status}`
        );
      }
    );

    await test(
      "Invalid fromDate returns 400",
      async () => {
        const res = await request(
          `${BASE_PATH}?fromDate=not-a-date`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 400,
          `Expected 400, got ${res.status}`
        );
      }
    );

    await test(
      "Invalid toDate returns 400",
      async () => {
        const res = await request(
          `${BASE_PATH}?toDate=not-a-date`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 400,
          `Expected 400, got ${res.status}`
        );
      }
    );

    // ==========================================
    // Section C — Filtering
    // ==========================================

    await test(
      "Filter by planId returns only that plan's logs",
      async () => {
        const res = await request(
          `${BASE_PATH}?planId=${planA}`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.total === 5,
          `Expected 5 logs for planA, got ${res.data.total}`
        );
        res.data.data.logs.forEach((log) => {
          assert(
            String(log.planId) === String(planA),
            "All logs must belong to planA"
          );
        });
      }
    );

    await test(
      "Filter by action returns only that action",
      async () => {
        const res = await request(
          `${BASE_PATH}?action=PLAN_CREATED`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.total === 2,
          `Expected 2 PLAN_CREATED logs, got ${res.data.total}`
        );
        res.data.data.logs.forEach((log) => {
          assert(
            log.action === "PLAN_CREATED",
            "All logs must be PLAN_CREATED"
          );
        });
      }
    );

    await test(
      "Filter by actorId returns only that actor's logs",
      async () => {
        const res = await request(
          `${BASE_PATH}?actorId=${superAdmin.user._id}`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.total === 7,
          `Expected 7 logs, got ${res.data.total}`
        );
      }
    );

    await test(
      "Filter by fromDate and toDate narrows results",
      async () => {
        const from = new Date(baseTime - 3500).toISOString();
        const to = new Date(baseTime - 500).toISOString();
        const res = await request(
          `${BASE_PATH}?fromDate=${from}&toDate=${to}`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        // Expected logs: timestamps between -3500ms and -500ms are:
        //   PLAN_VERSION_PUBLISHED (-3000),
        //   PLAN_PRICE_CHANGED    (-2000),
        //   PLAN_DISABLED         (-1000),
        //   PLAN_CREATED  on planB (-800),
        //   PLAN_ENABLED  on planB (-700)
        // = 5 logs
        assert(
          res.data.total === 5,
          `Expected 5 logs in date range, got ${res.data.total}`
        );
      }
    );

    await test(
      "Combined filters narrow to a single log",
      async () => {
        const res = await request(
          `${BASE_PATH}?planId=${planB}&action=PLAN_ENABLED`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.total === 1,
          `Expected 1 log, got ${res.data.total}`
        );
        assert(
          res.data.data.logs[0].action === "PLAN_ENABLED",
          "Wrong action returned"
        );
      }
    );

    // ==========================================
    // Section D — Pagination & sorting
    // ==========================================

    await test(
      "Default page returns logs sorted by timestamp descending",
      async () => {
        const res = await request(BASE_PATH, {
          token: superAdmin.token,
        });
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        const logs = res.data.data.logs;
        assert(logs.length === 7, `Expected 7 logs, got ${logs.length}`);

        for (let i = 1; i < logs.length; i++) {
          const prev = new Date(logs[i - 1].timestamp).getTime();
          const curr = new Date(logs[i].timestamp).getTime();
          assert(
            prev >= curr,
            "Logs must be sorted newest-first"
          );
        }
      }
    );

    await test(
      "Pagination: page=1&limit=3 returns 3 records",
      async () => {
        const res = await request(
          `${BASE_PATH}?page=1&limit=3`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.count === 3,
          `Expected 3, got ${res.data.count}`
        );
        assert(
          res.data.total === 7,
          `Expected total 7, got ${res.data.total}`
        );
        assert(
          res.data.page === 1,
          `Expected page 1, got ${res.data.page}`
        );
        assert(
          res.data.limit === 3,
          `Expected limit 3, got ${res.data.limit}`
        );
      }
    );

    await test(
      "Pagination: page=2&limit=3 returns next 3 records",
      async () => {
        const page1 = await request(
          `${BASE_PATH}?page=1&limit=3`,
          { token: superAdmin.token }
        );
        const page2 = await request(
          `${BASE_PATH}?page=2&limit=3`,
          { token: superAdmin.token }
        );
        assert(
          page2.data.count === 3,
          `Expected 3 on page 2, got ${page2.data.count}`
        );

        // No overlap between pages
        const ids1 = new Set(
          page1.data.data.logs.map((l) => String(l._id))
        );
        const overlap = page2.data.data.logs.filter((l) =>
          ids1.has(String(l._id))
        );
        assert(
          overlap.length === 0,
          "Pages must not overlap"
        );
      }
    );

    await test(
      "limit is capped at 100",
      async () => {
        const res = await request(
          `${BASE_PATH}?limit=9999`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.limit === 100,
          `Expected limit to be capped at 100, got ${res.data.limit}`
        );
      }
    );

    await test(
      "Invalid page defaults to 1",
      async () => {
        const res = await request(
          `${BASE_PATH}?page=0`,
          { token: superAdmin.token }
        );
        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.page === 1,
          `Expected page 1, got ${res.data.page}`
        );
      }
    );

    // ==========================================
    // Section E — Response shape
    // ==========================================

    await test(
      "Each log contains the expected fields",
      async () => {
        const res = await request(
          `${BASE_PATH}?planId=${planA}&action=PLAN_PRICE_CHANGED`,
          { token: superAdmin.token }
        );
        assert(
          res.data.data.logs.length === 1,
          "Expected exactly one PLAN_PRICE_CHANGED log"
        );

        const log = res.data.data.logs[0];
        assert(log._id, "_id missing");
        assert(log.action === "PLAN_PRICE_CHANGED", "action mismatch");
        assert(log.actor, "actor missing");
        assert(log.planId, "planId missing");
        assert(log.timestamp, "timestamp missing");
        assert(
          log.oldValue?.amount === 999,
          "oldValue.amount mismatch"
        );
        assert(
          log.newValue?.amount === 1499,
          "newValue.amount mismatch"
        );
      }
    );

    console.log(
      "\nAll audit log API tests executed."
    );
  } finally {
    console.log("\nCleaning up test-created records...");

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (createdAuditLogIds.length > 0) {
      await AuditLog.collection.deleteMany({
        _id: { $in: createdAuditLogIds },
      });
    }

    if (createdPlanIds.length > 0) {
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