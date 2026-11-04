require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const { AuditLog } = require("../../models/AuditLog");
const { hashPassword } = require("../../services/authService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const {
  createSubscriptionPlan,
  activateSubscriptionPlan,
} = require("../../services/subscriptionPlanService");

const {
  hasVerifiedPayment,
} = require("../../services/subscriptionService");

const connectTestDB = require("../helpers/connectTestDB");

const PLAN_CODE = "PRO";

const OWNER_PLAN_PATH = `/api/owner/subscription-plans/${PLAN_CODE}`;
const PLAN_VERSIONS_PATH = (planId) =>
  `/api/admin/subscription-plans/${planId}/versions`;
const VERSION_PATH = (planId, versionId) =>
  `/api/admin/subscription-plans/${planId}/versions/${versionId}`;
const AUDIT_PATH = (planId) =>
  `/api/admin/audit-logs?planId=${planId}`;

const createdUserIds = [];
const createdInstituteIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdSubscriptionIds = [];
const createdPaymentIds = [];

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
    name: `E2E Regression ${role}`,
    email: `e2e-regression-${role.toLowerCase()}-${suffix}@example.com`,
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

async function createTestInstitute(ownerId) {
  const instituteId = new mongoose.Types.ObjectId();

  await Institute.collection.insertOne({
    _id: instituteId,
    code: `INST_E2E_${instituteId.toString()}`,
    name: "E2E Regression Institute",
    ownerId,
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    subscriptionPlan: "PRO",
    subscriptionStatus: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdInstituteIds.push(instituteId);

  return instituteId;
}

function buildConfiguration(amount) {
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
    // Pre-flight: ensure PLAN_CODE is free across prior aborted runs.
    const existingPlan = await SubscriptionPlan.findOne({
      code: PLAN_CODE,
    });
    if (existingPlan) {
      await SubscriptionPlanVersion.collection.deleteMany({
        planId: existingPlan._id,
      });
      await AuditLog.collection.deleteMany({
        planId: existingPlan._id,
      });
      await SubscriptionPlan.collection.deleteOne({
        _id: existingPlan._id,
      });
    }

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
    const owner = await createTestUser("INSTITUTE_OWNER");
    const instituteId = await createTestInstitute(owner.user._id);

    await User.updateOne(
      { _id: owner.user._id },
      { $set: { instituteId } }
    );

    // ==========================================
    // PHASE 1 — SUPER_ADMIN creates PRO + v3
    // ==========================================

    const plan = await createSubscriptionPlan({
      code: PLAN_CODE,
      name: "Professional Plan",
      description: "E2E regression plan",
      actorId: superAdmin.user._id,
    });

    createdPlanIds.push(plan._id);

    await activateSubscriptionPlan({
      planId: plan._id,
      actorId: superAdmin.user._id,
    });

    let v3Id = null;

    await test(
      "HTTP: SUPER_ADMIN creates v3 draft with amount 1999",
      async () => {
        const res = await request(PLAN_VERSIONS_PATH(plan._id), {
          method: "POST",
          token: superAdmin.token,
          body: { configuration: buildConfiguration(1999) },
        });

        assert(
          res.status === 201,
          `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.status === "DRAFT",
          "Expected DRAFT"
        );
        assert(
          res.data.data.amount === 1999,
          `Expected amount 1999, got ${res.data.data.amount}`
        );

        v3Id = res.data.data._id;
        createdVersionIds.push(new mongoose.Types.ObjectId(v3Id));
      }
    );

    await test(
      "HTTP: SUPER_ADMIN publishes v3",
      async () => {
        const res = await request(
          `${VERSION_PATH(plan._id, v3Id)}/publish`,
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

    // ==========================================
    // PHASE 2 — Owner reads v3 via read-only API
    // ==========================================

    await test(
      "Owner sees v3 amount 1999 via read-only endpoint",
      async () => {
        const res = await request(OWNER_PLAN_PATH, {
          token: owner.token,
        });

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.version.amount === 1999,
          `Expected amount 1999, got ${res.data.data.version.amount}`
        );
        assert(
          res.data.data.version.version === 1,
          `Expected v1, got v${res.data.data.version.version}`
        );
      }
    );

    // ==========================================
    // PHASE 3 — Institute subscribes to v3
    // ==========================================

    let v3SubscriptionId = null;
    let v3PaymentId = null;

    await test(
      "Institute subscribes to v3 with verified payment",
      async () => {
        const v3 = await SubscriptionPlanVersion.findById(v3Id);

        const subscription = await Subscription.create({
          instituteId,
          subscriptionType: "STANDARD",
          plan: PLAN_CODE,
          planVersion: v3.version,
          planVersionId: v3._id,
          amount: v3.amount,
          currency: v3.currency,
          paymentRequired: v3.paymentRequired,
          durationDays: v3.durationDays,
          features: v3.features,
          limits: v3.limits,
          status: "PENDING",
        });

        v3SubscriptionId = subscription._id;
        createdSubscriptionIds.push(subscription._id);

        const payment = await Payment.create({
          instituteId,
          subscriptionId: subscription._id,
          paymentType: "INSTITUTE_SUBSCRIPTION",
          amount: 1999,
          currency: "INR",
          method: "ONLINE_GATEWAY",
          gateway: "RAZORPAY",
          transactionId: `TXN_${randomUUID()}`,
          status: "VERIFIED",
          verifiedAt: new Date(),
          verifiedBy: superAdmin.user._id,
        });

        v3PaymentId = payment._id;
        createdPaymentIds.push(payment._id);

        // Sanity: payment verifies
        const verified = await hasVerifiedPayment(subscription);
        assert(
          verified,
          "Payment should verify immediately after creation"
        );
      }
    );

    // ==========================================
    // PHASE 4 — SUPER_ADMIN publishes v4 (₹2499)
    // ==========================================

    let v4Id = null;

    await test(
      "HTTP: SUPER_ADMIN creates v4 draft with amount 2499",
      async () => {
        const res = await request(PLAN_VERSIONS_PATH(plan._id), {
          method: "POST",
          token: superAdmin.token,
          body: { configuration: buildConfiguration(2499) },
        });

        assert(
          res.status === 201,
          `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
        );
        assert(
          res.data.data.amount === 2499,
          "Expected amount 2499"
        );

        v4Id = res.data.data._id;
        createdVersionIds.push(new mongoose.Types.ObjectId(v4Id));
      }
    );

    await test(
      "HTTP: SUPER_ADMIN publishes v4 (retires v3 automatically)",
      async () => {
        const res = await request(
          `${VERSION_PATH(plan._id, v4Id)}/publish`,
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
          "Expected v4 to be PUBLISHED"
        );
      }
    );

    // ==========================================
    // PHASE 5 — GOLDEN RULE VERIFICATION
    // Plan change ≠ Existing Subscription change
    // ==========================================

    await test(
      "GOLDEN RULE: v3 is RETIRED but retains original amount 1999",
      async () => {
        const v3 = await SubscriptionPlanVersion.findById(v3Id);

        assert(v3, "v3 must still exist");
        assert(
          v3.status === "RETIRED",
          `Expected RETIRED, got ${v3.status}`
        );
        assert(
          v3.amount === 1999,
          `GOLDEN RULE VIOLATED: v3 amount changed to ${v3.amount}`
        );
        assert(
          v3.retiredAt !== null,
          "v3 must have retiredAt"
        );
      }
    );

    await test(
      "GOLDEN RULE: existing subscription still points to v3 with 1999",
      async () => {
        const sub = await Subscription.findById(v3SubscriptionId);

        assert(sub, "Subscription must still exist");
        assert(
          sub.planVersionId.toString() === v3Id.toString(),
          "Subscription must still reference v3"
        );
        assert(
          sub.amount === 1999,
          `GOLDEN RULE VIOLATED: subscription amount changed to ${sub.amount}`
        );
        assert(
          sub.planVersion === 1,
          "Subscription must still have planVersion 1"
        );
      }
    );

    await test(
      "GOLDEN RULE: v3 payment still verifies after v4 publish",
      async () => {
        const sub = await Subscription.findById(v3SubscriptionId);
        const verified = await hasVerifiedPayment(sub);

        assert(
          verified,
          "GOLDEN RULE VIOLATED: v3 payment no longer verifies"
        );
        assert(
          verified.amount === 1999,
          "Verified payment amount must remain 1999"
        );
      }
    );

    await test(
      "Owner now sees v4 amount 2499 via read-only endpoint",
      async () => {
        const res = await request(OWNER_PLAN_PATH, {
          token: owner.token,
        });

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );
        assert(
          res.data.data.version.amount === 2499,
          `Expected v4 amount 2499, got ${res.data.data.version.amount}`
        );
        assert(
          res.data.data.version.version === 2,
          `Expected v2, got v${res.data.data.version.version}`
        );
      }
    );

    await test(
      "Plan pointer references v4, exactly one PUBLISHED version",
      async () => {
        const reloadedPlan = await SubscriptionPlan.findById(plan._id);
        assert(
          reloadedPlan.currentPublishedVersion.toString() ===
            v4Id.toString(),
          "Plan pointer must reference v4"
        );

        const publishedCount =
          await SubscriptionPlanVersion.countDocuments({
            planId: plan._id,
            status: "PUBLISHED",
          });
        assert(
          publishedCount === 1,
          `Expected exactly 1 PUBLISHED, got ${publishedCount}`
        );

        const retiredCount =
          await SubscriptionPlanVersion.countDocuments({
            planId: plan._id,
            status: "RETIRED",
          });
        assert(
          retiredCount === 1,
          `Expected exactly 1 RETIRED (v3), got ${retiredCount}`
        );
      }
    );

    // ==========================================
    // PHASE 6 — Audit trail completeness
    // ==========================================

    await test(
      "Audit trail contains the entire plan lifecycle",
      async () => {
        const res = await request(AUDIT_PATH(plan._id), {
          token: superAdmin.token,
        });

        assert(
          res.status === 200,
          `Expected 200, got ${res.status}`
        );

        const actions = res.data.data.logs.map((log) => log.action);

        // Required actions
        assert(
          actions.includes("PLAN_CREATED"),
          "PLAN_CREATED missing"
        );
        assert(
          actions.includes("PLAN_ENABLED"),
          "PLAN_ENABLED missing"
        );
        assert(
          actions.includes("PLAN_DRAFT_CREATED"),
          "PLAN_DRAFT_CREATED missing"
        );
        assert(
          actions.includes("PLAN_VERSION_PUBLISHED"),
          "PLAN_VERSION_PUBLISHED missing"
        );
        assert(
          actions.includes("PLAN_VERSION_RETIRED"),
          "PLAN_VERSION_RETIRED missing"
        );

        // Counts
        const countOf = (a) =>
          actions.filter((x) => x === a).length;

        assert(
          countOf("PLAN_DRAFT_CREATED") === 2,
          `Expected 2 PLAN_DRAFT_CREATED, got ${countOf("PLAN_DRAFT_CREATED")}`
        );
        assert(
          countOf("PLAN_VERSION_PUBLISHED") === 2,
          `Expected 2 PLAN_VERSION_PUBLISHED, got ${countOf("PLAN_VERSION_PUBLISHED")}`
        );
        assert(
          countOf("PLAN_VERSION_RETIRED") === 1,
          `Expected 1 PLAN_VERSION_RETIRED, got ${countOf("PLAN_VERSION_RETIRED")}`
        );
        assert(
          countOf("PLAN_CREATED") === 1,
          `Expected 1 PLAN_CREATED, got ${countOf("PLAN_CREATED")}`
        );
      }
    );

    await test(
      "Audit trail links v3 retirement to the correct version",
      async () => {
        const res = await request(AUDIT_PATH(plan._id), {
          token: superAdmin.token,
        });

        const retireLog = res.data.data.logs.find(
          (log) => log.action === "PLAN_VERSION_RETIRED"
        );

        assert(retireLog, "PLAN_VERSION_RETIRED log missing");
        assert(
          retireLog.planVersionId.toString() === v3Id.toString(),
          "Retired log must reference v3"
        );
        assert(
          retireLog.oldValue?.status === "PUBLISHED",
          "oldValue.status must be PUBLISHED"
        );
        assert(
          retireLog.newValue?.status === "RETIRED",
          "newValue.status must be RETIRED"
        );
      }
    );

    console.log("\nAll E2E plan management regression tests executed.");
  } finally {
    console.log("\nCleaning up test-created records...");

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (createdPaymentIds.length > 0) {
      await Payment.collection.deleteMany({
        _id: { $in: createdPaymentIds },
      });
    }

    if (createdSubscriptionIds.length > 0) {
      await Subscription.collection.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
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