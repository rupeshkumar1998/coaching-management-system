require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const connectTestDB = require("../helpers/connectTestDB");
const entitlementService = require("../../services/entitlementService");

// ---------------------------------------------------------
// Tracking for cleanup
// ---------------------------------------------------------

const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];

let passed = 0;
let failed = 0;

// ---------------------------------------------------------
// Test harness
// ---------------------------------------------------------

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

const expectThrow = async (fn, expectedCode) => {
  let threw = false;

  try {
    await fn();
  } catch (error) {
    threw = true;

    if (expectedCode && error.code !== expectedCode) {
      throw new Error(
        `Expected error code "${expectedCode}", received "${error.code}" (${error.message})`
      );
    }
  }

  assert(threw, `Expected function to throw "${expectedCode}", but it succeeded`);
};

// ---------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------

const CORE_KEYS = [
  "AUTHENTICATION",
  "ROLE_AUTHORIZATION",
  "TENANT_ISOLATION",
  "PERMISSION_AUTHORIZATION",
  "ACCOUNT_SECURITY",
  "SESSION_SECURITY",
  "INSTITUTE_PROFILE",
  "BASIC_DASHBOARD",
  "SECURITY_AUDIT",
];

const makeCoreFeatures = () =>
  CORE_KEYS.map((key) => ({ key, enabled: true }));

const makeFeatures = (overrides = {}) => {
  const base = makeCoreFeatures();
  const keys = Object.keys(overrides);

  for (const key of keys) {
    const existing = base.find((f) => f.key === key);
    if (existing) {
      existing.enabled = overrides[key];
    } else {
      base.push({ key, enabled: overrides[key] });
    }
  }

  return base;
};

async function createInstitute(nameSuffix = "") {
  const instituteId = new mongoose.Types.ObjectId();

  await Institute.collection.insertOne({
    _id: instituteId,
    code: `INST_ENT_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: `Entitlement Test Institute ${nameSuffix}`,
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    subscriptionPlan: "PRO",
    subscriptionStatus: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdInstituteIds.push(instituteId);

  return instituteId;
}

async function createSubscriptionForInstitute(
  instituteId,
  overrides = {}
) {
  const subId = new mongoose.Types.ObjectId();
  const now = Date.now();

  const base = {
    _id: subId,
    instituteId,
    subscriptionType: "STANDARD",
    plan: "PRO",
    planVersion: 1,
    planVersionId: null,
    amount: 999,
    currency: "INR",
    paymentRequired: true,
    durationDays: 30,
    status: "ACTIVE",
    startDate: new Date(now - 86400000), // yesterday
    endDate: new Date(now + 86400000 * 30), // in 30 days
    features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
    limits: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const doc = { ...base, ...overrides };

  await Subscription.collection.insertOne(doc);
  createdSubscriptionIds.push(subId);

  return subId;
}

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // Section A — Input validation (4 tests)
    // =====================================================

    await test(
      "Invalid instituteId → INSTITUTE_CONTEXT_REQUIRED",
      async () => {
        const r = await entitlementService.checkFeatureAccess(
          "not-an-objectid",
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "INSTITUTE_CONTEXT_REQUIRED",
          `Got reason: ${r.reason}`
        );
        assert(r.source === null, "Source should be null");
      }
    );

    await test(
      "Missing instituteId → INSTITUTE_CONTEXT_REQUIRED",
      async () => {
        const r = await entitlementService.checkFeatureAccess(
          null,
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "INSTITUTE_CONTEXT_REQUIRED",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test("Unknown featureKey → UNKNOWN_FEATURE", async () => {
      const instituteId = await createInstitute("A-unknown");

      const r = await entitlementService.checkFeatureAccess(
        String(instituteId),
        "TOTALLY_MADE_UP_FEATURE"
      );

      assert(r.allowed === false, "Expected denied");
      assert(
        r.reason === "UNKNOWN_FEATURE",
        `Got reason: ${r.reason}`
      );
    });

    await test(
      "Empty featureKey → UNKNOWN_FEATURE",
      async () => {
        const instituteId = await createInstitute("A-empty");

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "   "
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "UNKNOWN_FEATURE",
          `Got reason: ${r.reason}`
        );
      }
    );

    // =====================================================
    // Section B — Feature decisions (6 tests)
    // =====================================================

    await test(
      "Active sub + feature ON → allowed",
      async () => {
        const instituteId = await createInstitute("B-on");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === true, "Expected allowed");
        assert(r.reason === null, "Reason should be null");
        assert(r.source === "SUBSCRIPTION", "Source should be SUBSCRIPTION");
      }
    );

    await test(
      "Active sub + feature OFF → FEATURE_NOT_INCLUDED",
      async () => {
        const instituteId = await createInstitute("B-off");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: false }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "FEATURE_NOT_INCLUDED",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "Feature absent from snapshot → FEATURE_NOT_INCLUDED",
      async () => {
        const instituteId = await createInstitute("B-absent");
        // Only CORE features + no commercial
        await createSubscriptionForInstitute(instituteId, {
          features: makeCoreFeatures(),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "FEATURE_NOT_INCLUDED",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "hasFeature returns true for enabled feature",
      async () => {
        const instituteId = await createInstitute("B-has-true");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const result = await entitlementService.hasFeature(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(result === true, "Expected true");
      }
    );

    await test(
      "hasFeature returns false for disabled feature",
      async () => {
        const instituteId = await createInstitute("B-has-false");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: false }),
        });

        const result = await entitlementService.hasFeature(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(result === false, "Expected false");
      }
    );

    await test(
      "Case-insensitive featureKey works",
      async () => {
        const instituteId = await createInstitute("B-case");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "exam_test_management"
        );

        assert(r.allowed === true, "Expected allowed");
        assert(
          r.featureKey === "EXAM_TEST_MANAGEMENT",
          "FeatureKey should be normalized to uppercase"
        );
      }
    );

    // =====================================================
    // Section C — Subscription status (7 tests)
    // =====================================================

    await test(
      "No subscription → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-none");

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "PENDING subscription → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-pending");
        await createSubscriptionForInstitute(instituteId, {
          status: "PENDING",
          startDate: null,
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "SUSPENDED subscription → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-suspended");
        await createSubscriptionForInstitute(instituteId, {
          status: "SUSPENDED",
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "EXPIRED subscription → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-expired");
        await createSubscriptionForInstitute(instituteId, {
          status: "EXPIRED",
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "CANCELLED subscription → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-cancelled");
        await createSubscriptionForInstitute(instituteId, {
          status: "CANCELLED",
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "Future startDate → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-future");
        const now = Date.now();
        await createSubscriptionForInstitute(instituteId, {
          startDate: new Date(now + 86400000 * 5), // 5 days in future
          endDate: new Date(now + 86400000 * 35),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "Past endDate → SUBSCRIPTION_INACTIVE",
      async () => {
        const instituteId = await createInstitute("C-past");
        const now = Date.now();
        await createSubscriptionForInstitute(instituteId, {
          startDate: new Date(now - 86400000 * 60), // 60 days ago
          endDate: new Date(now - 86400000), // yesterday
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Got reason: ${r.reason}`
        );
      }
    );

    // =====================================================
    // Section D — Snapshot integrity (4 tests)
    // =====================================================
    // -----------------------------------------------------
    // Helper for defense-in-depth tests
    //
    // Why mock instead of raw insert?
    //   Mongoose performs type casting when loading a
    //   document from MongoDB. If we inserted a corrupt
    //   value (e.g. features: "corrupted"), the load would
    //   silently cast it (or drop the field). The service
    //   would then see the *cast* value, not the corrupt
    //   one — making the test meaningless.
    //
    //   By overriding getEffectiveSubscription to return
    //   a plain object, we test the service's defensive
    //   checks directly. This mirrors the scenario where
    //   a bypass path (script, migration, raw driver write)
    //   corrupts data after load.
    //
    //   Real DB integration is still exercised in every
    //   other test in this file.
    // -----------------------------------------------------
    const withMockedSubscription = async (fakeSubscription, fn) => {
      const subscriptionService = require("../../services/subscriptionService");
      const original = subscriptionService.getEffectiveSubscription;
      subscriptionService.getEffectiveSubscription = async () =>
        fakeSubscription;

      try {
        await fn();
      } finally {
        subscriptionService.getEffectiveSubscription = original;
      }
    };

    // -----------------------------------------------------
    // Helper for simulating unexpected errors
    // (e.g. DB connection failure, timeout)
    // -----------------------------------------------------
    const withThrowingSubscription = async (error, fn) => {
      const subscriptionService = require("../../services/subscriptionService");
      const original = subscriptionService.getEffectiveSubscription;
      subscriptionService.getEffectiveSubscription = async () => {
        throw error;
      };

      try {
        await fn();
      } finally {
        subscriptionService.getEffectiveSubscription = original;
      }
    };

    await test(
      "features === undefined → ENTITLEMENT_SNAPSHOT_MISSING",
      async () => {
        const instituteId = new mongoose.Types.ObjectId();

        await withMockedSubscription(
          {
            _id: new mongoose.Types.ObjectId(),
            instituteId,
            subscriptionType: "STANDARD",
            plan: "PRO",
            planVersion: 1,
            planVersionId: null,
            status: "ACTIVE",
            startDate: new Date(Date.now() - 86400000),
            endDate: new Date(Date.now() + 86400000 * 30),
            features: undefined,
            limits: [],
            createdAt: new Date(),
          },
          async () => {
            const r = await entitlementService.checkFeatureAccess(
              String(instituteId),
              "EXAM_TEST_MANAGEMENT"
            );

            assert(r.allowed === false, "Expected denied");
            assert(
              r.reason === "ENTITLEMENT_SNAPSHOT_MISSING",
              `Got reason: ${r.reason}`
            );
          }
        );
      }
    );

    await test(
      "features not an array → ENTITLEMENT_CONFIGURATION_INVALID",
      async () => {
        const instituteId = new mongoose.Types.ObjectId();

        await withMockedSubscription(
          {
            _id: new mongoose.Types.ObjectId(),
            instituteId,
            subscriptionType: "STANDARD",
            plan: "PRO",
            planVersion: 1,
            planVersionId: null,
            status: "ACTIVE",
            startDate: new Date(Date.now() - 86400000),
            endDate: new Date(Date.now() + 86400000 * 30),
            features: "corrupted",
            limits: [],
            createdAt: new Date(),
          },
          async () => {
            const r = await entitlementService.checkFeatureAccess(
              String(instituteId),
              "EXAM_TEST_MANAGEMENT"
            );

            assert(r.allowed === false, "Expected denied");
            assert(
              r.reason === "ENTITLEMENT_CONFIGURATION_INVALID",
              `Got reason: ${r.reason}`
            );
          }
        );
      }
    );

    await test(
      "Non-boolean enabled value → ENTITLEMENT_CONFIGURATION_INVALID",
      async () => {
        const instituteId = new mongoose.Types.ObjectId();

        await withMockedSubscription(
          {
            _id: new mongoose.Types.ObjectId(),
            instituteId,
            subscriptionType: "STANDARD",
            plan: "PRO",
            planVersion: 1,
            planVersionId: null,
            status: "ACTIVE",
            startDate: new Date(Date.now() - 86400000),
            endDate: new Date(Date.now() + 86400000 * 30),
            features: [
              ...makeCoreFeatures(),
              { key: "EXAM_TEST_MANAGEMENT", enabled: "true" },
            ],
            limits: [],
            createdAt: new Date(),
          },
          async () => {
            const r = await entitlementService.checkFeatureAccess(
              String(instituteId),
              "EXAM_TEST_MANAGEMENT"
            );

            assert(r.allowed === false, "Expected denied");
            assert(
              r.reason === "ENTITLEMENT_CONFIGURATION_INVALID",
              `Got reason: ${r.reason}`
            );
          }
        );
      }
    );

    await test(
      "Duplicate feature keys → ENTITLEMENT_CONFIGURATION_INVALID",
      async () => {
        const instituteId = await createInstitute("D-dup");
        await createSubscriptionForInstitute(instituteId, {
          features: [
            ...makeCoreFeatures(),
            { key: "EXAM_TEST_MANAGEMENT", enabled: true },
            { key: "exam_test_management", enabled: false },
          ],
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "ENTITLEMENT_CONFIGURATION_INVALID",
          `Got reason: ${r.reason}`
        );
      }
    );

    // =====================================================
    // Section E — CORE protection (3 tests)
    // =====================================================

    await test(
      "CORE feature enabled → allowed",
      async () => {
        const instituteId = await createInstitute("E-core-ok");
        await createSubscriptionForInstitute(instituteId, {
          features: makeCoreFeatures(),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "AUTHENTICATION"
        );

        assert(r.allowed === true, "Expected allowed");
        assert(r.reason === null, "Reason should be null");
      }
    );

    await test(
      "CORE feature disabled → ENTITLEMENT_CONFIGURATION_INVALID",
      async () => {
        const instituteId = await createInstitute("E-core-off");
        await createSubscriptionForInstitute(instituteId, {
          features: makeCoreFeatures().map((f) =>
            f.key === "TENANT_ISOLATION"
              ? { ...f, enabled: false }
              : f
          ),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "TENANT_ISOLATION"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "ENTITLEMENT_CONFIGURATION_INVALID",
          `Got reason: ${r.reason}`
        );
      }
    );

    await test(
      "CORE feature missing → ENTITLEMENT_CONFIGURATION_INVALID",
      async () => {
        const instituteId = await createInstitute("E-core-missing");
        await createSubscriptionForInstitute(instituteId, {
          features: makeCoreFeatures().filter(
            (f) => f.key !== "AUTHENTICATION"
          ),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "AUTHENTICATION"
        );

        assert(r.allowed === false, "Expected denied");
        assert(
          r.reason === "ENTITLEMENT_CONFIGURATION_INVALID",
          `Got reason: ${r.reason}`
        );
      }
    );

    // =====================================================
    // Section F — Bulk getInstituteEntitlements (4 tests)
    // =====================================================

    await test(
      "getInstituteEntitlements returns full shape",
      async () => {
        const instituteId = await createInstitute("F-bulk");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({
            EXAM_TEST_MANAGEMENT: true,
            ONLINE_FEE_PAYMENT: false,
          }),
          limits: [
            { key: "MAX_STUDENTS", value: 1000 },
            { key: "MAX_TEACHERS", value: 50 },
          ],
        });

        const r = await entitlementService.getInstituteEntitlements(
          String(instituteId)
        );

        assert(r.instituteId === String(instituteId), "Wrong instituteId");
        assert(r.subscription.plan === "PRO", "Wrong plan");
        assert(r.subscription.status === "ACTIVE", "Wrong status");
        assert(r.source === "SUBSCRIPTION", "Wrong source");
        assert(r.features.length > 0, "Features should be non-empty");
        assert(r.limits.length === 2, "Should have 2 limits");
      }
    );

    await test(
      "getInstituteEntitlements features are sorted alphabetically",
      async () => {
        const instituteId = await createInstitute("F-sorted");
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({
            EXAM_TEST_MANAGEMENT: true,
            ONLINE_FEE_PAYMENT: true,
            ANALYTICS: true,
          }),
        });

        const r = await entitlementService.getInstituteEntitlements(
          String(instituteId)
        );

        const keys = r.features.map((f) => f.key);
        const sorted = [...keys].sort((a, b) => a.localeCompare(b));

        assert(
          JSON.stringify(keys) === JSON.stringify(sorted),
          "Features should be sorted"
        );
      }
    );

    await test(
      "getInstituteEntitlements throws SUBSCRIPTION_INACTIVE when no sub",
      async () => {
        const instituteId = await createInstitute("F-no-sub");

        await expectThrow(
          () =>
            entitlementService.getInstituteEntitlements(
              String(instituteId)
            ),
          "SUBSCRIPTION_INACTIVE"
        );
      }
    );

    await test(
      "getInstituteEntitlements handles limits undefined → []",
      async () => {
        const instituteId = await createInstitute("F-limits-undef");
        await createSubscriptionForInstitute(instituteId, {
          limits: undefined,
        });

        const r = await entitlementService.getInstituteEntitlements(
          String(instituteId)
        );

        assert(Array.isArray(r.limits), "Limits should be array");
        assert(r.limits.length === 0, "Limits should be empty");
      }
    );

    // =====================================================
    // Section G — Regression (3 tests)
    // =====================================================

    await test(
      "Trial subscription works identically to STANDARD",
      async () => {
        const instituteId = await createInstitute("G-trial");
        const now = Date.now();

        await createSubscriptionForInstitute(instituteId, {
          subscriptionType: "TRIAL",
          amount: 0,
          paymentRequired: false,
          durationDays: 14,
          endDate: new Date(now + 86400000 * 14),
          trialSource: "MANUAL_GRANT",
          trialGrantedBy: new mongoose.Types.ObjectId(),
          trialReason: "Trial for regression test",
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === true, "Trial should allow EXAM");
      }
    );

    await test(
      "FREE subscription (permanent, endDate null) works",
      async () => {
        const instituteId = await createInstitute("G-free");

        await createSubscriptionForInstitute(instituteId, {
          plan: "FREE",
          amount: 0,
          paymentRequired: false,
          durationDays: null,
          endDate: null,
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === true, "FREE should allow EXAM");
      }
    );

    await test(
      "Regression — v3→v4 plan publish keeps v3 subscriber on v3 features",
      async () => {
        const instituteId = await createInstitute("G-v3v4");
        const actorId = new mongoose.Types.ObjectId();

        // Create plan with v3 (RETIRED) and v4 (PUBLISHED)
        const planId = new mongoose.Types.ObjectId();
        const v3Id = new mongoose.Types.ObjectId();
        const v4Id = new mongoose.Types.ObjectId();

        const v3Features = makeFeatures({
          EXAM_TEST_MANAGEMENT: true,
          ONLINE_FEE_PAYMENT: false,
        });
        const v4Features = makeFeatures({
          EXAM_TEST_MANAGEMENT: false,
          ONLINE_FEE_PAYMENT: true,
        });

        await SubscriptionPlan.collection.insertOne({
          _id: planId,
          code: `REG_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
          name: "Regression Plan",
          description: "v3→v4 regression test",
          isActive: true,
          currentPublishedVersion: v4Id,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdPlanIds.push(planId);

        await SubscriptionPlanVersion.collection.insertOne({
          _id: v3Id,
          planId,
          version: 3,
          status: "RETIRED",
          amount: 999,
          currency: "INR",
          durationDays: 30,
          paymentRequired: true,
          features: v3Features,
          limits: [],
          publishedAt: new Date(now_minus(86400000 * 60)),
          publishedBy: actorId,
          retiredAt: new Date(now_minus(86400000 * 5)),
          retiredBy: actorId,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: new Date(now_minus(86400000 * 90)),
          updatedAt: new Date(now_minus(86400000 * 5)),
        });
        createdVersionIds.push(v3Id);

        await SubscriptionPlanVersion.collection.insertOne({
          _id: v4Id,
          planId,
          version: 4,
          status: "PUBLISHED",
          amount: 2499,
          currency: "INR",
          durationDays: 30,
          paymentRequired: true,
          features: v4Features,
          limits: [],
          publishedAt: new Date(now_minus(86400000 * 5)),
          publishedBy: actorId,
          retiredAt: null,
          retiredBy: null,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: new Date(now_minus(86400000 * 10)),
          updatedAt: new Date(now_minus(86400000 * 5)),
        });
        createdVersionIds.push(v4Id);

        // Create subscription that references v3 with v3 features
        await createSubscriptionForInstitute(instituteId, {
          planVersion: 3,
          planVersionId: v3Id,
          amount: 999,
          features: v3Features,
        });

        // Query via entitlementService — should see v3 features
        const examResult = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );
        assert(
          examResult.allowed === true,
          "Regression: EXAM should still be enabled from v3 snapshot"
        );

        const onlineFeeResult = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "ONLINE_FEE_PAYMENT"
        );
        assert(
          onlineFeeResult.allowed === false &&
          onlineFeeResult.reason === "FEATURE_NOT_INCLUDED",
          "Regression: ONLINE_FEE should be disabled from v3 snapshot"
        );
      }
    );

    // =====================================================
    // Section H — Cross-tenant isolation (5 tests)
    //
    // Permanent verification that no institute can ever
    // see another institute's entitlements.
    // =====================================================

    await test(
      "Cross-tenant: A and B have different feature sets",
      async () => {
        const instituteA = await createInstitute("H-A");
        const instituteB = await createInstitute("H-B");

        await createSubscriptionForInstitute(instituteA, {
          features: makeFeatures({
            EXAM_TEST_MANAGEMENT: true,
            ONLINE_FEE_PAYMENT: false,
          }),
        });

        await createSubscriptionForInstitute(instituteB, {
          features: makeFeatures({
            EXAM_TEST_MANAGEMENT: false,
            ONLINE_FEE_PAYMENT: true,
          }),
        });

        const aExam = await entitlementService.checkFeatureAccess(
          String(instituteA),
          "EXAM_TEST_MANAGEMENT"
        );
        const bExam = await entitlementService.checkFeatureAccess(
          String(instituteB),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(aExam.allowed === true, "A must have EXAM");
        assert(bExam.allowed === false, "B must NOT have EXAM");
        assert(
          bExam.reason === "FEATURE_NOT_INCLUDED",
          `B's reason should be FEATURE_NOT_INCLUDED, got ${bExam.reason}`
        );
      }
    );

    await test(
      "Cross-tenant: A and B see opposite ONLINE_FEE status",
      async () => {
        const instituteA = await createInstitute("H-2A");
        const instituteB = await createInstitute("H-2B");

        await createSubscriptionForInstitute(instituteA, {
          features: makeFeatures({ ONLINE_FEE_PAYMENT: false }),
        });
        await createSubscriptionForInstitute(instituteB, {
          features: makeFeatures({ ONLINE_FEE_PAYMENT: true }),
        });

        const aOnline = await entitlementService.checkFeatureAccess(
          String(instituteA),
          "ONLINE_FEE_PAYMENT"
        );
        const bOnline = await entitlementService.checkFeatureAccess(
          String(instituteB),
          "ONLINE_FEE_PAYMENT"
        );

        assert(aOnline.allowed === false, "A must NOT have ONLINE_FEE");
        assert(bOnline.allowed === true, "B must have ONLINE_FEE");
      }
    );

    await test(
      "Cross-tenant: institute with no sub does NOT fall back to another tenant's data",
      async () => {
        const instituteWithSub = await createInstitute("H-with");
        const instituteWithoutSub = await createInstitute("H-without");

        await createSubscriptionForInstitute(instituteWithSub, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        const r = await entitlementService.checkFeatureAccess(
          String(instituteWithoutSub),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(r.allowed === false, "Should be denied");
        assert(
          r.reason === "SUBSCRIPTION_INACTIVE",
          `Expected SUBSCRIPTION_INACTIVE, got ${r.reason}`
        );
        assert(
          r.source === null,
          "Source must be null (no data ever read)"
        );
      }
    );

    await test(
      "Cross-tenant: getInstituteEntitlements returns correct instituteId",
      async () => {
        const instituteA = await createInstitute("H-getA");
        const instituteB = await createInstitute("H-getB");

        await createSubscriptionForInstitute(instituteA, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });
        await createSubscriptionForInstitute(instituteB, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: false }),
        });

        const a = await entitlementService.getInstituteEntitlements(
          String(instituteA)
        );
        const b = await entitlementService.getInstituteEntitlements(
          String(instituteB)
        );

        assert(
          a.instituteId === String(instituteA),
          "A: wrong instituteId"
        );
        assert(
          b.instituteId === String(instituteB),
          "B: wrong instituteId"
        );

        const aExam = a.features.find(
          (f) => f.key === "EXAM_TEST_MANAGEMENT"
        );
        const bExam = b.features.find(
          (f) => f.key === "EXAM_TEST_MANAGEMENT"
        );

        assert(aExam.enabled === true, "A: EXAM must be enabled");
        assert(bExam.enabled === false, "B: EXAM must be disabled");
      }
    );

    await test(
      "Cross-tenant: two institutes with identical features stay isolated",
      async () => {
        const instituteA = await createInstitute("H-same-A");
        const instituteB = await createInstitute("H-same-B");

        const sameFeatures = makeFeatures({
          EXAM_TEST_MANAGEMENT: true,
        });

        await createSubscriptionForInstitute(instituteA, {
          features: sameFeatures,
        });
        await createSubscriptionForInstitute(instituteB, {
          features: sameFeatures,
        });

        const a = await entitlementService.getInstituteEntitlements(
          String(instituteA)
        );
        const b = await entitlementService.getInstituteEntitlements(
          String(instituteB)
        );

        assert(
          a.subscription.id !== b.subscription.id,
          "Subscriptions must be different documents"
        );
        assert(
          a.instituteId === String(instituteA) &&
          b.instituteId === String(instituteB),
          "Each result must reference its own institute"
        );
      }
    );

    // =====================================================
    // Section I — Fail-closed on unexpected errors (3 tests)
    //
    // If the subscription resolver throws (DB outage,
    // timeout, unexpected exception), the service must:
    //   - NEVER allow access
    //   - Return INTERNAL_ERROR (checkFeatureAccess)
    //   - Return false (hasFeature)
    //   - Throw (getInstituteEntitlements — resolver contract)
    // =====================================================

    await test(
      "DB error → checkFeatureAccess returns INTERNAL_ERROR (fail closed)",
      async () => {
        const dbError = new Error("Simulated DB connection failure");

        await withThrowingSubscription(dbError, async () => {
          const r = await entitlementService.checkFeatureAccess(
            "507f1f77bcf86cd799439011",
            "EXAM_TEST_MANAGEMENT"
          );

          assert(r.allowed === false, "Must be denied on DB error");
          assert(
            r.reason === "INTERNAL_ERROR",
            `Expected INTERNAL_ERROR, got ${r.reason}`
          );
          assert(r.source === null, "Source must be null");
        });
      }
    );

    await test(
      "DB error → hasFeature returns false (fail closed)",
      async () => {
        const dbError = new Error("Simulated DB connection failure");

        await withThrowingSubscription(dbError, async () => {
          const result = await entitlementService.hasFeature(
            "507f1f77bcf86cd799439011",
            "EXAM_TEST_MANAGEMENT"
          );

          assert(result === false, "Must return false on DB error");
        });
      }
    );

    await test(
      "DB error → getInstituteEntitlements propagates the error",
      async () => {
        const dbError = new Error("Simulated DB connection failure");

        await withThrowingSubscription(dbError, async () => {
          await expectThrow(
            () =>
              entitlementService.getInstituteEntitlements(
                "507f1f77bcf86cd799439011"
              ),
            null // any error is acceptable
          );
        });
      }
    );

    // =====================================================
    // Section J — Plan lifecycle regression (1 test)
    //
    // Regression guard: entitlements must come from the
    // subscription snapshot, never from the parent
    // SubscriptionPlan's current state. Disabling a plan
    // must not affect existing subscriptions.
    // =====================================================

    await test(
      "Plan disabled does NOT affect existing subscription entitlements",
      async () => {
        const instituteId = await createInstitute("J-disabled");
        const actorId = new mongoose.Types.ObjectId();
        const planId = new mongoose.Types.ObjectId();

        // Create a plan that is INACTIVE (disabled)
        await SubscriptionPlan.collection.insertOne({
          _id: planId,
          code: `DIS_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
          name: "Disabled Plan",
          description: "Regression: disabled plan",
          isActive: false,
          currentPublishedVersion: null,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdPlanIds.push(planId);

        // Create a subscription that was granted BEFORE the
        // plan was disabled. Its snapshot is intact.
        await createSubscriptionForInstitute(instituteId, {
          features: makeFeatures({ EXAM_TEST_MANAGEMENT: true }),
        });

        // Entitlement check must succeed — snapshot is the
        // source of truth, not the plan's current isActive.
        const r = await entitlementService.checkFeatureAccess(
          String(instituteId),
          "EXAM_TEST_MANAGEMENT"
        );

        assert(
          r.allowed === true,
          "Existing subscription must retain access even if plan is disabled"
        );
      }
    );

  } finally {
    console.log("\nCleaning up test-created records...");

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
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }

    if (createdInstituteIds.length > 0) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
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
};

// Helper for date arithmetic
function now_minus(ms) {
  return Date.now() - ms;
}

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});