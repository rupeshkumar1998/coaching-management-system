require("dotenv").config();

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const PlatformTrialOffer = require("../../models/PlatformTrialOffer");
const PlatformTrialOfferAudit = require("../../models/PlatformTrialOfferAudit");

const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const {
  createDraftTrialOffer,
} = require("../../services/platformTrialOfferService");

const TEST_DATABASE = "coaching_management_test";

const CORE_FEATURES = [
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

const FEATURES = [
  ...CORE_FEATURES.map((key) => ({ key, enabled: true })),
  { key: "STUDENT_MANAGEMENT", enabled: true },
  { key: "TEACHER_MANAGEMENT", enabled: true },
];

const LIMITS = [
  { key: "MAX_STUDENTS", value: 100 },
  { key: "MAX_TEACHERS", value: 10 },
];

function createTestIds() {
  return {
    actorId: new mongoose.Types.ObjectId(),
    planId: null,
    planVersionId: null,
    offerId: null,
  };
}

async function createPublishedTestPlan(ids) {
  const suffix = `${Date.now()}_${new mongoose.Types.ObjectId()
    .toString()
    .slice(-6)}`;

  const plan = new SubscriptionPlan({
    code: `TEST_TRIAL_${suffix}`,
    name: `Trial Transaction Test ${suffix}`,
    description: "Temporary plan for isolated transaction testing",
    isActive: true,
    createdBy: ids.actorId,
    updatedBy: ids.actorId,
  });

  await plan.save();
  ids.planId = plan._id;

  const draft = await createDraftPlanVersion({
    planId: plan._id,
    actorId: ids.actorId,
    configuration: {
      amount: 0,
      currency: "INR",
      durationDays: 30,
      paymentRequired: false,
      features: FEATURES,
      limits: LIMITS,
    },
  });

  ids.planVersionId = draft._id;

  const published = await publishPlanVersion({
    planId: plan._id,
    versionId: draft._id,
    actorId: ids.actorId,
  });

  assert.equal(String(published._id), String(draft._id));

  const refreshedPlan = await SubscriptionPlan.findById(plan._id);

  assert.equal(
    String(refreshedPlan.currentPublishedVersion),
    String(draft._id),
    "Plan should point to the published version"
  );

  return {
    planId: plan._id,
    planVersionId: draft._id,
  };
}

async function cleanupTestRecords(ids) {
  // Delete only records belonging to this test's generated IDs.
  if (ids.offerId) {
    await PlatformTrialOffer.collection.deleteOne({
      _id: ids.offerId,
    });
  }

  if (ids.planId) {
    await PlatformTrialOffer.collection.deleteMany({
      planId: ids.planId,
    });

    await PlatformTrialOfferAudit.collection.deleteMany({
      actorId: ids.actorId,
    });

    await SubscriptionPlanVersion.collection.deleteMany({
      planId: ids.planId,
    });

    await SubscriptionPlan.collection.deleteOne({
      _id: ids.planId,
    });
  }
}

async function testSuccessfulCreation() {
  const ids = createTestIds();

  try {
    const { planId, planVersionId } =
      await createPublishedTestPlan(ids);

    const offer = await createDraftTrialOffer({
      planId,
      planVersionId,
      durationDays: 14,
      eligibility: "NEW_INSTITUTES_ONLY",
      actorId: ids.actorId,
    });

    ids.offerId = offer._id;

    const savedOffer = await PlatformTrialOffer.findById(offer._id);

    assert.ok(savedOffer, "Offer should persist in MongoDB");
    assert.equal(savedOffer.status, "DRAFT");
    assert.equal(savedOffer.enabled, false);
    assert.equal(String(savedOffer.planId), String(planId));
    assert.equal(
      String(savedOffer.planVersionId),
      String(planVersionId)
    );
    assert.equal(savedOffer.durationDays, 14);

    const auditRecords = await PlatformTrialOfferAudit.find({
      offerId: offer._id,
      actorId: ids.actorId,
      eventType: "TRIAL_OFFER_CREATED",
    });

    assert.equal(
      auditRecords.length,
      1,
      "Exactly one creation audit record should persist"
    );

    assert.equal(
      auditRecords[0].offerVersion,
      savedOffer.version
    );

    console.log(
      "PASS: Offer and creation audit persist in MongoDB"
    );
  } finally {
    await cleanupTestRecords(ids);
  }
}

async function testAuditFailureRollsBackOffer() {
  const ids = createTestIds();
  const originalSave = PlatformTrialOfferAudit.prototype.save;

  try {
    const { planId, planVersionId } =
      await createPublishedTestPlan(ids);

    // Simulate an audit write failure.
    // Restore the original method in finally.
    PlatformTrialOfferAudit.prototype.save = async function (...args) {
      if (this.isNew) {
        throw new Error("INJECTED_AUDIT_FAILURE");
      }

      return originalSave.apply(this, args);
    };

    let creationFailed = false;

    try {
      await createDraftTrialOffer({
        planId,
        planVersionId,
        durationDays: 14,
        eligibility: "NEW_INSTITUTES_ONLY",
        actorId: ids.actorId,
      });
    } catch (error) {
      creationFailed = true;

      assert.match(
        error.message,
        /INJECTED_AUDIT_FAILURE/,
        "The injected audit failure should reach the caller"
      );
    }

    assert.equal(
      creationFailed,
      true,
      "Offer creation must fail if the audit write fails"
    );

    // Check the actual database after the transaction aborts.
    const offerCount = await PlatformTrialOffer.countDocuments({
      planId,
      createdBy: ids.actorId,
    });

    const auditCount = await PlatformTrialOfferAudit.countDocuments({
      actorId: ids.actorId,
    });

    assert.equal(
      offerCount,
      0,
      "Offer must be rolled back when audit creation fails"
    );

    assert.equal(
      auditCount,
      0,
      "No audit record should persist after the failed transaction"
    );

    console.log(
      "PASS: Audit failure rolls back offer and audit writes"
    );
  } finally {
    PlatformTrialOfferAudit.prototype.save = originalSave;
    await cleanupTestRecords(ids);
  }
}

async function main() {
  assert.ok(
    process.env.MONGO_URI,
    "MONGO_URI is missing from the server .env file"
  );

  // Explicitly override the database in the connection options.
  // Never run this test against the development database.
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: TEST_DATABASE,
  });

  if (mongoose.connection.name !== TEST_DATABASE) {
    throw new Error(
      `Unsafe database "${mongoose.connection.name}". ` +
      `Expected "${TEST_DATABASE}". Aborting.`
    );
  }

  console.log(`Connected to isolated database: ${TEST_DATABASE}`);

  try {
    await Promise.all([
      SubscriptionPlan.init(),
      SubscriptionPlanVersion.init(),
      PlatformTrialOffer.init(),
      PlatformTrialOfferAudit.init(),
    ]);

    await testSuccessfulCreation();
    await testAuditFailureRollsBackOffer();

    console.log(
      "\nAll platform trial offer transaction tests passed."
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("\nFAIL:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});