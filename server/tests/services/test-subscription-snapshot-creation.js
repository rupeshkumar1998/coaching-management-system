require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const Institute = require("../../models/Institute");

const connectTestDB = require("../helpers/connectTestDB");
const {
  buildSubscriptionSnapshot,
} = require("../../services/subscriptionSnapshotBuilder");

const createdSubscriptionIds = [];
const createdVersionIds = [];
const createdPlanIds = [];
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
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

// Plan code must be UNIQUE across tests (MongoDB unique index),
// but Subscription.plan has a fixed enum. We keep the plan
// collection with dynamic codes, and use "PRO" for the
// subscription enum.
const ENUM_PLAN_CODE = "PRO";

const makePublishedVersion = async (overrides = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  const planCode = `SNAP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`;

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: planCode,
    name: "Snapshot Creation Test Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: 3,
    status: "PUBLISHED",
    amount: 1999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: [
      { key: "EXAM_TEST_MANAGEMENT", enabled: true },
      { key: "ANALYTICS", enabled: true },
      { key: "ONLINE_FEE_PAYMENT", enabled: false },
    ],
    limits: [
      { key: "MAX_STUDENTS", value: 1000 },
      { key: "MAX_TEACHERS", value: 50 },
    ],
    publishedAt: new Date(),
    publishedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
  createdVersionIds.push(versionId);

  return { planId, versionId, planCode, actorId };
};

const makeInstitute = async () => {
  const instituteId = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `INST_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Snapshot Creation Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);
  return instituteId;
};

// Helper: override plan to a valid enum value (PRO) because
// the test uses dynamic plan codes in the plan collection for
// uniqueness. Subscription.plan requires a fixed enum.
const createTestSubscription = async (snapshot, instituteId, extra = {}) => {
  const [sub] = await Subscription.create([
    {
      ...snapshot,
      plan: ENUM_PLAN_CODE,
      instituteId,
      ...extra,
    },
  ]);
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
    // Section A — STANDARD snapshot correctness (4 tests)
    // =====================================================

    await test(
      "STANDARD: all snapshot fields match source version",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );

        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          {
            subscriptionType: "STANDARD",
            status: "PENDING",
            autoRenew: false,
          }
        );

        assert(sub.plan === ENUM_PLAN_CODE, `plan: ${sub.plan}`);
        assert(sub.planVersion === 3, `planVersion: ${sub.planVersion}`);
        assert(
          String(sub.planVersionId) === String(versionId),
          "planVersionId"
        );
        assert(sub.amount === 1999, `amount: ${sub.amount}`);
        assert(sub.currency === "INR", "currency");
        assert(sub.paymentRequired === true, "paymentRequired");
        assert(sub.durationDays === 30, "durationDays");
        assert(sub.features.length === 3, "features count");
        assert(sub.limits.length === 2, "limits count");
      }
    );

    await test(
      "STANDARD: features are exact copy of source",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        const featureMap = Object.fromEntries(
          sub.features.map((f) => [f.key, f.enabled])
        );

        assert(featureMap.EXAM_TEST_MANAGEMENT === true, "EXAM");
        assert(featureMap.ANALYTICS === true, "ANALYTICS");
        assert(featureMap.ONLINE_FEE_PAYMENT === false, "ONLINE_FEE");
      }
    );

    await test(
      "STANDARD: limits are exact copy of source",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        const limitMap = Object.fromEntries(
          sub.limits.map((l) => [l.key, l.value])
        );

        assert(limitMap.MAX_STUDENTS === 1000, "MAX_STUDENTS");
        assert(limitMap.MAX_TEACHERS === 50, "MAX_TEACHERS");
      }
    );

    await test(
      "STANDARD: snapshotCapturedAt is populated (not null)",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const before = Date.now();
        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const after = Date.now();

        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        assert(sub.snapshotCapturedAt, "must not be null");
        const ts = sub.snapshotCapturedAt.getTime();
        assert(
          ts >= before && ts <= after,
          `capturedAt ${ts} outside [${before}, ${after}]`
        );
      }
    );

    // =====================================================
    // Section B — TRIAL snapshot correctness (3 tests)
    // =====================================================

    await test(
      "TRIAL: snapshot with overrides (amount=0, paymentRequired=false)",
      async () => {
        const { versionId, planCode } = await makePublishedVersion({
          amount: 0,
          paymentRequired: false,
          durationDays: null,
        });
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode,
          {
            overrides: {
              amount: 0,
              paymentRequired: false,
              durationDays: 14,
            },
          }
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          {
            subscriptionType: "TRIAL",
            status: "PENDING",
            trialSource: "PLATFORM_OFFER",
            platformTrialOfferId: new mongoose.Types.ObjectId(),
            platformTrialOfferVersion: 1,
          }
        );

        assert(sub.amount === 0, `amount: ${sub.amount}`);
        assert(sub.paymentRequired === false, "paymentRequired");
        assert(sub.durationDays === 14, `durationDays: ${sub.durationDays}`);
        assert(sub.subscriptionType === "TRIAL", "TRIAL type");
      }
    );

    await test(
      "TRIAL: features and limits also captured",
      async () => {
        const { versionId, planCode } = await makePublishedVersion({
          amount: 0,
          paymentRequired: false,
          durationDays: null,
        });
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode,
          {
            overrides: {
              amount: 0,
              paymentRequired: false,
              durationDays: 14,
            },
          }
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          {
            subscriptionType: "TRIAL",
            status: "PENDING",
            trialSource: "PLATFORM_OFFER",
            platformTrialOfferId: new mongoose.Types.ObjectId(),
            platformTrialOfferVersion: 1,
          }
        );

        assert(sub.features.length === 3, "features");
        assert(sub.limits.length === 2, "limits");
      }
    );

    await test(
      "TRIAL: snapshotCapturedAt is populated",
      async () => {
        const { versionId, planCode } = await makePublishedVersion({
          amount: 0,
          paymentRequired: false,
          durationDays: null,
        });
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode,
          {
            overrides: {
              amount: 0,
              paymentRequired: false,
              durationDays: 14,
            },
          }
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          {
            subscriptionType: "TRIAL",
            status: "PENDING",
            trialSource: "PLATFORM_OFFER",
            platformTrialOfferId: new mongoose.Types.ObjectId(),
            platformTrialOfferVersion: 1,
          }
        );

        assert(sub.snapshotCapturedAt, "must not be null");
        assert(
          sub.snapshotCapturedAt instanceof Date,
          "should be Date"
        );
      }
    );

    // =====================================================
    // Section C — Legacy compatibility (2 tests)
    // =====================================================

    await test(
      "Legacy: subscription without snapshotCapturedAt has null",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const legacySub = await createTestSubscription(
          {
            plan: ENUM_PLAN_CODE,
            planVersion: 3,
            planVersionId: versionId,
            amount: sourceVersion.amount,
            currency: sourceVersion.currency,
            paymentRequired: sourceVersion.paymentRequired,
            durationDays: sourceVersion.durationDays,
            features: sourceVersion.features,
            limits: sourceVersion.limits,
          },
          instituteId,
          {
            subscriptionType: "STANDARD",
            status: "PENDING",
            // Note: no snapshotCapturedAt provided
          }
        );

        assert(
          legacySub.snapshotCapturedAt === null,
          "legacy default should be null"
        );
      }
    );

    await test(
      "Legacy: null snapshotCapturedAt does not break reads",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const legacySub = await createTestSubscription(
          {
            plan: ENUM_PLAN_CODE,
            planVersion: 3,
            planVersionId: versionId,
            amount: sourceVersion.amount,
            currency: sourceVersion.currency,
            paymentRequired: sourceVersion.paymentRequired,
            durationDays: sourceVersion.durationDays,
            features: sourceVersion.features,
            limits: sourceVersion.limits,
          },
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        const reloaded = await Subscription.findById(legacySub._id);
        assert(reloaded !== null, "readable");
        assert(
          reloaded.snapshotCapturedAt === null,
          "still null after reload"
        );
        assert(reloaded.features.length > 0, "features readable");
      }
    );

    // =====================================================
    // Section D — Immutability (3 tests)
    // =====================================================

    await test(
      "Immutability: save() with modified snapshotCapturedAt is rejected",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        const reloaded = await Subscription.findById(sub._id);
        reloaded.snapshotCapturedAt = new Date();

        let threw = false;
        try {
          await reloaded.save();
        } catch (error) {
          threw = true;
          assert(
            error.message.includes("immutable"),
            `Wrong error: ${error.message}`
          );
        }
        assert(threw, "should throw on save");
      }
    );

    await test(
      "Immutability: updateOne on snapshotCapturedAt is rejected",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        let threw = false;
        try {
          await Subscription.updateOne(
            { _id: sub._id },
            { $set: { snapshotCapturedAt: new Date() } }
          );
        } catch (error) {
          threw = true;
          assert(
            error.message.includes("immutable"),
            `Wrong error: ${error.message}`
          );
        }
        assert(threw, "should throw on updateOne");
      }
    );

    await test(
      "Immutability: feature/limit changes also rejected",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        let threw = false;
        try {
          await Subscription.updateOne(
            { _id: sub._id },
            { $set: { "features.0.enabled": false } }
          );
        } catch (error) {
          threw = true;
        }
        assert(threw, "feature snapshot must be immutable");
      }
    );

    // =====================================================
    // Section E — Round-trip integrity (2 tests)
    // =====================================================

    await test(
      "Round-trip: reloaded subscription preserves all fields",
      async () => {
        const { versionId, planCode } = await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);
        const instituteId = await makeInstitute();

        const snapshot = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const sub = await createTestSubscription(
          snapshot,
          instituteId,
          { subscriptionType: "STANDARD", status: "PENDING" }
        );

        const reloaded = await Subscription.findById(sub._id);

        assert(reloaded.plan === ENUM_PLAN_CODE, "plan preserved");
        assert(reloaded.amount === 1999, "amount preserved");
        assert(reloaded.currency === "INR", "currency");
        assert(reloaded.paymentRequired === true, "paymentRequired");
        assert(reloaded.durationDays === 30, "durationDays");
        assert(
          String(reloaded.planVersionId) === String(versionId),
          "planVersionId"
        );
        assert(reloaded.snapshotCapturedAt, "capturedAt");
        assert(reloaded.features.length === 3, "features");
        assert(reloaded.limits.length === 2, "limits");
      }
    );

    await test(
      "Round-trip: two subscriptions share plan but have different snapshots",
      async () => {
        const { planId, versionId, planCode, actorId } =
          await makePublishedVersion();
        const sourceVersion =
          await SubscriptionPlanVersion.findById(versionId);

        // MARK v3 as RETIRED first (unique partial index allows
        // only one PUBLISHED per plan)
        await SubscriptionPlanVersion.collection.updateOne(
          { _id: versionId },
          {
            $set: {
              status: "RETIRED",
              retiredAt: new Date(),
              retiredBy: actorId,
            },
          }
        );

        // Now insert v4 as PUBLISHED
        const v4Id = new mongoose.Types.ObjectId();
        await SubscriptionPlanVersion.collection.insertOne({
          _id: v4Id,
          planId,
          version: 4,
          status: "PUBLISHED",
          amount: 2499,
          currency: "INR",
          durationDays: 30,
          paymentRequired: true,
          features: [
            { key: "EXAM_TEST_MANAGEMENT", enabled: false },
            { key: "ANALYTICS", enabled: true },
          ],
          limits: [{ key: "MAX_STUDENTS", value: 2000 }],
          publishedAt: new Date(),
          publishedBy: actorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdVersionIds.push(v4Id);

        // Point the plan at v4
        await SubscriptionPlan.collection.updateOne(
          { _id: planId },
          { $set: { currentPublishedVersion: v4Id } }
        );

        // Institute A subscribes to v3 (snapshot pre-change)
        const instituteA = await makeInstitute();
        const snapshotA = buildSubscriptionSnapshot(
          sourceVersion,
          planCode
        );
        const subA = await createTestSubscription(
          snapshotA,
          instituteA,
          { subscriptionType: "STANDARD", status: "ACTIVE" }
        );

        // Institute B subscribes to v4
        const v4Doc = await SubscriptionPlanVersion.findById(v4Id);
        const instituteB = await makeInstitute();
        const snapshotB = buildSubscriptionSnapshot(v4Doc, planCode);
        const subB = await createTestSubscription(
          snapshotB,
          instituteB,
          { subscriptionType: "STANDARD", status: "ACTIVE" }
        );

        // Verify A has v3 snapshot
        assert(subA.amount === 1999, "A: amount 1999");
        assert(subA.planVersion === 3, "A: v3");
        assert(
          subA.features.find((f) => f.key === "EXAM_TEST_MANAGEMENT")
            .enabled === true,
          "A: EXAM enabled"
        );

        // Verify B has v4 snapshot
        assert(subB.amount === 2499, "B: amount 2499");
        assert(subB.planVersion === 4, "B: v4");
        assert(
          subB.features.find((f) => f.key === "EXAM_TEST_MANAGEMENT")
            .enabled === false,
          "B: EXAM disabled"
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