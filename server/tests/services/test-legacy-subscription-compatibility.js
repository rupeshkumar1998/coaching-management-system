require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");

const connectTestDB = require("../helpers/connectTestDB");
const {
  validatePlanSnapshot,
  activateSubscription,
  getEffectiveSubscription,
} = require("../../services/subscriptionService");
const {
  checkFeatureAccess,
} = require("../../services/entitlementService");
const {
  checkLimit,
} = require("../../services/limitService");

const createdInstituteIds = [];
const createdSubscriptionIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectThrow = async (fn, expectedCode) => {
  let threw = false;
  let code = null;
  try {
    await fn();
  } catch (e) {
    threw = true;
    code = e.code;
  }
  assert(threw, `Expected throw "${expectedCode}", succeeded`);
  if (expectedCode) {
    assert(
      code === expectedCode,
      `Expected code "${expectedCode}", got "${code}"`
    );
  }
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

// =========================================================
// 32.16.15.13 — Legacy Subscription Compatibility Tests
//
// Formal verification that pre-.12 subscriptions
// (planVersionId === null, features undefined) continue to
// work through the entire stack.
//
// Constants used (from constants/subscriptionPlans.js):
//   FREE:       version 1, amount 0,    paymentRequired false
//   BASIC:      version 1, amount 999,  paymentRequired true
//   PRO:        version 1, amount 1999, paymentRequired true
//   ENTERPRISE: version 1, amount 4999, paymentRequired true
// =========================================================

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async (approved = true) => {
  const instituteId = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `LEG_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Legacy Compatibility Test Institute",
    approvalStatus: approved ? "APPROVED" : "PENDING",
    isActive: approved,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);
  return instituteId;
};

const makeLegacySubscription = async (instituteId, overrides = {}) => {
  const base = {
    instituteId,
    subscriptionType: "STANDARD",
    plan: "BASIC",
    planVersion: 1,
    planVersionId: null, // legacy
    amount: 999,
    currency: "INR",
    paymentRequired: true,
    durationDays: 30,
    status: "PENDING",
    // features: undefined (legacy)
    // limits: undefined (legacy)
    // snapshotCapturedAt: null (legacy default)
  };
  const sub = await Subscription.create({ ...base, ...overrides });
  createdSubscriptionIds.push(sub._id);
  return sub;
};

const makeActiveLegacySubscription = async (instituteId, overrides = {}) => {
  const now = Date.now();
  const base = {
    instituteId,
    subscriptionType: "STANDARD",
    plan: "BASIC",
    planVersion: 1,
    planVersionId: null,
    amount: 999,
    currency: "INR",
    paymentRequired: true,
    durationDays: 30,
    status: "ACTIVE",
    startDate: new Date(now - 86400000),
    endDate: new Date(now + 86400000 * 30),
  };
  const sub = await Subscription.create({ ...base, ...overrides });
  createdSubscriptionIds.push(sub._id);
  return sub;
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // Group A — Legacy Subscription Structure (4 tests)
    // =====================================================

    await test("A1: legacy sub with planVersionId null can be created", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId);

      assert(sub._id, "should have _id");
      assert(sub.planVersionId === null, "planVersionId should be null");
    });

    await test("A2: legacy sub has features undefined by default", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId);

      assert(
        sub.features === undefined,
        `features should be undefined, got ${typeof sub.features}`
      );
    });

    await test("A3: legacy sub has snapshotCapturedAt null", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId);

      assert(
        sub.snapshotCapturedAt === null,
        `snapshotCapturedAt should be null, got ${sub.snapshotCapturedAt}`
      );
    });

    await test("A4: legacy sub is fully readable", async () => {
      const instituteId = await makeInstitute();
      const created = await makeLegacySubscription(instituteId);

      const reloaded = await Subscription.findById(created._id);

      assert(reloaded !== null, "should be readable");
      assert(reloaded.plan === "BASIC", "plan");
      assert(reloaded.planVersion === 1, "planVersion");
      assert(reloaded.planVersionId === null, "planVersionId");
      assert(reloaded.amount === 999, "amount");
      assert(reloaded.currency === "INR", "currency");
    });

    // =====================================================
    // Group B — validatePlanSnapshot Legacy Fallback (3 tests)
    // =====================================================

    await test("B1: legacy BASIC sub validates against constants", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId);

      const plan = await validatePlanSnapshot(sub);

      assert(plan !== null, "should return plan");
      assert(plan.code === "BASIC", `plan.code ${plan.code}`);
      assert(plan.amount === 999, "plan.amount");
      assert(plan.version === 1, "plan.version");
    });

    await test("B2: legacy sub with wrong amount → PLAN_AMOUNT_MISMATCH", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId, {
        amount: 555, // wrong (BASIC should be 999)
      });

      await expectThrow(
        () => validatePlanSnapshot(sub),
        "PLAN_AMOUNT_MISMATCH"
      );
    });

    await test("B3: legacy sub with wrong version → PLAN_VERSION_MISMATCH", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeLegacySubscription(instituteId, {
        planVersion: 2, // wrong (BASIC constant is v1)
      });

      await expectThrow(
        () => validatePlanSnapshot(sub),
        "PLAN_VERSION_MISMATCH"
      );
    });

    // =====================================================
    // Group C — entitlementService Legacy Behavior (3 tests)
    // =====================================================

    await test("C1: legacy sub without features → ENTITLEMENT_SNAPSHOT_MISSING", async () => {
      const instituteId = await makeInstitute();
      await makeActiveLegacySubscription(instituteId);

      const result = await checkFeatureAccess(
        String(instituteId),
        "EXAM_TEST_MANAGEMENT"
      );

      assert(result.allowed === false, "should be denied");
      assert(
        result.reason === "ENTITLEMENT_SNAPSHOT_MISSING",
        `got ${result.reason}`
      );
    });

    await test("C2: legacy sub with empty features → FEATURE_NOT_INCLUDED", async () => {
      const instituteId = await makeInstitute();
      await makeActiveLegacySubscription(instituteId, {
        features: [], // empty array, valid but no features
      });

      const result = await checkFeatureAccess(
        String(instituteId),
        "EXAM_TEST_MANAGEMENT"
      );

      assert(result.allowed === false, "should be denied");
      assert(
        result.reason === "FEATURE_NOT_INCLUDED",
        `got ${result.reason}`
      );
    });

    await test("C3: legacy sub with populated features → works", async () => {
      const instituteId = await makeInstitute();
      await makeActiveLegacySubscription(instituteId, {
        features: [
          { key: "EXAM_TEST_MANAGEMENT", enabled: true },
        ],
      });

      const result = await checkFeatureAccess(
        String(instituteId),
        "EXAM_TEST_MANAGEMENT"
      );

      assert(result.allowed === true, `denied: ${result.reason}`);
    });

    // =====================================================
    // Group D — limitService Legacy Behavior (2 tests)
    // =====================================================

    await test("D1: legacy sub without limits → LIMIT_NOT_CONFIGURED", async () => {
      const instituteId = await makeInstitute();
      await makeActiveLegacySubscription(instituteId, {
        features: [
          { key: "STUDENT_MANAGEMENT", enabled: true },
        ],
        // limits undefined
      });

      const result = await checkLimit({
        instituteId: String(instituteId),
        limitKey: "MAX_STUDENTS",
      });

      assert(result.allowed === false, "should be denied");
      assert(
        result.reason === "LIMIT_NOT_CONFIGURED",
        `got ${result.reason}`
      );
    });

    await test("D2: legacy sub with populated limits → works", async () => {
      const instituteId = await makeInstitute();
      await makeActiveLegacySubscription(instituteId, {
        features: [
          { key: "STUDENT_MANAGEMENT", enabled: true },
        ],
        limits: [{ key: "MAX_STUDENTS", value: 100 }],
      });

      const result = await checkLimit({
        instituteId: String(instituteId),
        limitKey: "MAX_STUDENTS",
      });

      assert(result.allowed === true, `denied: ${result.reason}`);
      assert(result.limit === 100, `limit ${result.limit}`);
      assert(result.current === 0, `current ${result.current}`);
    });

    // =====================================================
    // Group E — Status & Immutability (3 tests)
    // =====================================================

    await test("E1: legacy FREE sub can transition PENDING → ACTIVE", async () => {
      const instituteId = await makeInstitute(true);
      const now = Date.now();
      const sub = await Subscription.create({
        instituteId,
        subscriptionType: "STANDARD",
        plan: "FREE",
        planVersion: 1,
        planVersionId: null,
        amount: 0,
        currency: "INR",
        paymentRequired: false,
        durationDays: null,
        status: "PENDING",
        startDate: null,
        endDate: null,
      });
      createdSubscriptionIds.push(sub._id);

      const activated = await activateSubscription({
        subscriptionId: sub._id,
      });

      assert(activated.status === "ACTIVE", `status ${activated.status}`);
      assert(activated.startDate !== null, "startDate should be set");
      assert(activated.endDate === null, "endDate should be null for FREE");
    });

    await test("E2: legacy sub snapshot immutable after transition", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeActiveLegacySubscription(instituteId);

      const reloaded = await Subscription.findById(sub._id);
      reloaded.amount = 555; // attempt to change

      let threw = false;
      try {
        await reloaded.save();
      } catch (error) {
        threw = true;
        assert(
          error.message.includes("immutable"),
          `wrong error: ${error.message}`
        );
      }
      assert(threw, "should throw on amount change");
    });

    await test("E3: legacy sub not auto-upgraded when new version published", async () => {
      const instituteId = await makeInstitute();
      const sub = await makeActiveLegacySubscription(instituteId, {
        plan: "PRO",
        planVersion: 1,
        planVersionId: null,
        amount: 1999,
        paymentRequired: true,
        features: [
          { key: "EXAM_TEST_MANAGEMENT", enabled: true },
        ],
      });

      // Simulate new version publish via raw insert (no side effect on sub)
      const planId = new mongoose.Types.ObjectId();
      const newVersionId = new mongoose.Types.ObjectId();
      const now = new Date();

      await require("../../models/SubscriptionPlan").collection.insertOne({
        _id: planId,
        code: `E3_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
        name: "E3 Test Plan",
        description: "",
        isActive: true,
        currentPublishedVersion: newVersionId,
        createdAt: now,
        updatedAt: now,
      });

      await require("../../models/SubscriptionPlanVersion").collection.insertOne({
        _id: newVersionId,
        planId,
        version: 2,
        status: "PUBLISHED",
        amount: 2999,
        currency: "INR",
        durationDays: 30,
        paymentRequired: true,
        features: [],
        limits: [],
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      // Verify the legacy sub was NOT touched
      const reloaded = await Subscription.findById(sub._id);
      assert(reloaded.planVersionId === null, "planVersionId still null");
      assert(reloaded.planVersion === 1, "planVersion still 1");
      assert(reloaded.amount === 1999, "amount still 1999");
      assert(
        reloaded.features.length === 1 &&
          reloaded.features[0].key === "EXAM_TEST_MANAGEMENT",
        "features unchanged"
      );

      // Cleanup the two new records
      await require("../../models/SubscriptionPlanVersion").collection.deleteOne({
        _id: newVersionId,
      });
      await require("../../models/SubscriptionPlan").collection.deleteOne({
        _id: planId,
      });
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdSubscriptionIds.length) {
      await Subscription.collection.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});