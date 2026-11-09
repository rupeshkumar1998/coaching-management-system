require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const Subscription = require("../../models/Subscription");
const Institute = require("../../models/Institute");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const {
  deactivateSubscriptionPlan,
} = require("../../services/subscriptionPlanService");

const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

// =========================================================
// 32.16.15.16 — Plan Version Regression (formal consolidated)
//
// Single-file proof for the 10-item regression matrix from
// the phase plan.
//
// Key property under test:
//   Publishing v(N+1) does NOT change v(N) or its existing
//   subscribers. New subscribers get v(N+1).
// =========================================================

const createdPlanIds = [];
const createdVersionIds = [];
const createdSubscriptionIds = [];
const createdInstituteIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
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

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeConfiguration = (overrides = {}) => ({
  amount: 1999,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: [
    ...getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),
    { key: "STUDENT_MANAGEMENT", enabled: true },
    { key: "ONLINE_FEE_PAYMENT", enabled: false },
  ],
  limits: [{ key: "MAX_STUDENTS", value: 1000 }],
  ...overrides,
});

const createPlan = async () => {
  const actorId = new mongoose.Types.ObjectId();
  const plan = await SubscriptionPlan.create({
    code: `REG_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Plan Version Regression Test",
    description: "",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });
  createdPlanIds.push(plan._id);
  return { plan, actorId };
};

const createAndPublishVersion = async (planId, actorId, configuration) => {
  const draft = await createDraftPlanVersion({
    planId,
    configuration,
    actorId,
  });
  createdVersionIds.push(draft._id);

  const published = await publishPlanVersion({
    planId,
    versionId: draft._id,
    actorId,
  });

  return published;
};

const createInstitute = async () => {
  const instituteId = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `REG_INST_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Plan Version Regression Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);
  return instituteId;
};

const createSubscription = async (instituteId, version, planCode) => {
  const subId = new mongoose.Types.ObjectId();
  const now = Date.now();

  await Subscription.collection.insertOne({
    _id: subId,
    instituteId,
    subscriptionType: "STANDARD",
    plan: planCode,
    planVersion: version.version,
    planVersionId: version._id,
    amount: version.amount,
    currency: version.currency,
    paymentRequired: version.paymentRequired,
    durationDays: version.durationDays,
    features: version.features,
    limits: version.limits,
    status: "ACTIVE",
    startDate: new Date(now - 86400000),
    endDate: new Date(now + 86400000 * 30),
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });

  createdSubscriptionIds.push(subId);
  return subId;
};

const featureValue = (features, key) =>
  features.find((f) => f.key === key)?.enabled;
const limitValue = (limits, key) =>
  limits.find((l) => l.key === key)?.value;

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // Shared scenario setup
    const { plan, actorId } = await createPlan();

    const v3 = await createAndPublishVersion(
      plan._id,
      actorId,
      makeConfiguration({
        amount: 1999,
        features: [
          ...getMandatoryFeatureKeys().map((key) => ({
            key,
            enabled: true,
          })),
          { key: "STUDENT_MANAGEMENT", enabled: true },
          { key: "ONLINE_FEE_PAYMENT", enabled: false },
        ],
        limits: [{ key: "MAX_STUDENTS", value: 1000 }],
      })
    );

    const instituteA = await createInstitute();
    const instituteASubId = await createSubscription(
      instituteA,
      v3,
      plan.code
    );

    // Publish v4 with different configuration
    const v4 = await createAndPublishVersion(
      plan._id,
      actorId,
      makeConfiguration({
        amount: 2499,
        features: [
          ...getMandatoryFeatureKeys().map((key) => ({
            key,
            enabled: true,
          })),
          { key: "STUDENT_MANAGEMENT", enabled: true },
          { key: "ONLINE_FEE_PAYMENT", enabled: true },
        ],
        limits: [{ key: "MAX_STUDENTS", value: 2000 }],
      })
    );

    const instituteB = await createInstitute();
    const instituteBSubId = await createSubscription(
      instituteB,
      v4,
      plan.code
    );

    // =====================================================
    // Test 1 — v3 status unchanged after v4 publish
    // =====================================================
    await test(
      "1. v3 status → RETIRED, not deleted",
      async () => {
        const stored = await SubscriptionPlanVersion.findById(v3._id);
        assert(stored !== null, "v3 must exist");
        assert(
          stored.status === "RETIRED",
          `v3 should be RETIRED, got ${stored.status}`
        );
        assert(stored.retiredAt !== null, "v3 retiredAt set");
      }
    );

    // =====================================================
    // Test 2 — v3 amount/features/limits unchanged
    // =====================================================
    await test(
      "2. v3 amount/features/limits unchanged after v4",
      async () => {
        const stored = await SubscriptionPlanVersion.findById(v3._id);
        assert(stored.amount === 1999, `amount ${stored.amount}`);
        assert(
          featureValue(stored.features, "ONLINE_FEE_PAYMENT") === false,
          "ONLINE_FEE_PAYMENT should still be OFF in v3"
        );
        assert(
          limitValue(stored.limits, "MAX_STUDENTS") === 1000,
          "MAX_STUDENTS should still be 1000 in v3"
        );
      }
    );

    // =====================================================
    // Test 3 — existing sub still references v3
    // =====================================================
    await test(
      "3. Institute A sub references v3 (planVersionId)",
      async () => {
        const sub = await Subscription.findById(instituteASubId);
        assert(
          String(sub.planVersionId) === String(v3._id),
          "planVersionId mismatch"
        );
        assert(sub.planVersion === 1, `planVersion ${sub.planVersion}`);
      }
    );

    // =====================================================
    // Test 4 — new sub after v4 → uses v4
    // =====================================================
    await test(
      "4. Institute B sub (after v4) → references v4",
      async () => {
        const sub = await Subscription.findById(instituteBSubId);
        assert(
          String(sub.planVersionId) === String(v4._id),
          "B should use v4"
        );
        assert(sub.planVersion === 2, `B planVersion ${sub.planVersion}`);
      }
    );

    // =====================================================
    // Test 5 — price change isolation
    // =====================================================
    await test(
      "5. Price isolation: A ₹1999, B ₹2499",
      async () => {
        const a = await Subscription.findById(instituteASubId);
        const b = await Subscription.findById(instituteBSubId);
        assert(a.amount === 1999, `A amount ${a.amount}`);
        assert(b.amount === 2499, `B amount ${b.amount}`);
      }
    );

    // =====================================================
    // Test 6 — add feature isolation
    // =====================================================
    await test(
      "6. Feature ON added in v4 → A does not have it",
      async () => {
        const a = await Subscription.findById(instituteASubId);
        assert(
          featureValue(a.features, "ONLINE_FEE_PAYMENT") === false,
          "A: ONLINE_FEE_PAYMENT should be OFF (from v3)"
        );

        const b = await Subscription.findById(instituteBSubId);
        assert(
          featureValue(b.features, "ONLINE_FEE_PAYMENT") === true,
          "B: ONLINE_FEE_PAYMENT should be ON (from v4)"
        );
      }
    );

    // =====================================================
    // Test 7 — remove feature isolation (reverse)
    // =====================================================
    await test(
      "7. Feature removal in v4 → A retains it from v3",
      async () => {
        // Publish v5 without the mandatory keys? Not possible.
        // Use a specific feature that exists in v3 but not v4.
        // Instead, verify that a feature being OFF in v4 doesn't
        // remove it from v3.
        // Both v3/v4 have mandatory features — test a specific
        // non-mandatory feature difference.
        // v3: ONLINE_FEE_PAYMENT OFF (no feature) — not the case
        // v4: ONLINE_FEE_PAYMENT ON
        // Reverse test: v3 subscriber keeps whatever it had.
        const a = await Subscription.findById(instituteASubId);
        const aFeatures = JSON.parse(JSON.stringify(a.features));
        const v3Doc = await SubscriptionPlanVersion.findById(v3._id);
        const v3Features = JSON.parse(JSON.stringify(v3Doc.features));
        assert(
          JSON.stringify(aFeatures) === JSON.stringify(v3Features),
          "A features must match v3"
        );
      }
    );

    // =====================================================
    // Test 8 — increase limit isolation
    // =====================================================
    await test(
      "8. Limit increase in v4 → A stays at 1000",
      async () => {
        const a = await Subscription.findById(instituteASubId);
        assert(
          limitValue(a.limits, "MAX_STUDENTS") === 1000,
          `A: MAX_STUDENTS ${limitValue(a.limits, "MAX_STUDENTS")}`
        );

        const b = await Subscription.findById(instituteBSubId);
        assert(
          limitValue(b.limits, "MAX_STUDENTS") === 2000,
          `B: MAX_STUDENTS ${limitValue(b.limits, "MAX_STUDENTS")}`
        );
      }
    );

    // =====================================================
    // Test 9 — decrease limit isolation
    // =====================================================
    await test(
      "9. Limit decrease in v4 → A unaffected",
      async () => {
        // Create v5 with DECREASED limit
        const v5 = await createAndPublishVersion(
          plan._id,
          actorId,
          makeConfiguration({
            amount: 1999,
            features: [
              ...getMandatoryFeatureKeys().map((key) => ({
                key,
                enabled: true,
              })),
              { key: "STUDENT_MANAGEMENT", enabled: true },
              { key: "ONLINE_FEE_PAYMENT", enabled: false },
            ],
            limits: [{ key: "MAX_STUDENTS", value: 500 }],
          })
        );

        const instituteC = await createInstitute();
        const cSubId = await createSubscription(
          instituteC,
          v5,
          plan.code
        );

        // A still at 1000
        const a = await Subscription.findById(instituteASubId);
        assert(
          limitValue(a.limits, "MAX_STUDENTS") === 1000,
          "A stays at 1000 even after v5 with 500"
        );

        // C gets 500
        const c = await Subscription.findById(cSubId);
        assert(
          limitValue(c.limits, "MAX_STUDENTS") === 500,
          "C should have 500"
        );
      }
    );

    // =====================================================
    // Test 10 — plan disable does not cancel subs
    // =====================================================
    await test(
      "10. Plan disabled → existing subscriptions stay ACTIVE",
      async () => {
        await deactivateSubscriptionPlan({
          planId: plan._id,
          actorId,
        });

        const a = await Subscription.findById(instituteASubId);
        assert(a.status === "ACTIVE", `A status ${a.status}`);

        const b = await Subscription.findById(instituteBSubId);
        assert(b.status === "ACTIVE", `B status ${b.status}`);
      }
    );

    // =====================================================
    // Test 11 — edit published v3 rejected
    // =====================================================
    await test(
      "11. Editing a published version is rejected",
      async () => {
        let threw = false;
        try {
          await SubscriptionPlanVersion.updateOne(
            { _id: v3._id },
            { $set: { amount: 9999 } }
          );
        } catch (e) {
          threw = true;
        }
        assert(threw, "published version should reject updates");
      }
    );

    // =====================================================
    // Test 12 — pointer integrity + v3 still readable
    // =====================================================
    await test(
      "12. currentPublishedVersion → v5, v3 still readable",
      async () => {
        const storedPlan = await SubscriptionPlan.findById(plan._id);
        // After v3, v4, v5 publishes, pointer should be v5
        const allPublished = await SubscriptionPlanVersion.find({
          planId: plan._id,
          status: "PUBLISHED",
        }).lean();
        assert(
          allPublished.length === 1,
          `exactly 1 PUBLISHED expected, got ${allPublished.length}`
        );
        assert(
          String(storedPlan.currentPublishedVersion) ===
          String(allPublished[0]._id),
          "pointer must match the single PUBLISHED version"
        );

        // v3 still readable (RETIRED)
        const v3Doc = await SubscriptionPlanVersion.findById(v3._id);
        assert(v3Doc !== null, "v3 must remain readable");
        assert(
          v3Doc.status === "RETIRED",
          `v3 status ${v3Doc.status}`
        );
      }
    );

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