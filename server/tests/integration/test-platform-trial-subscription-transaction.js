
require("dotenv").config();

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const TrialEligibilityClaim = require("../../models/TrialEligibilityClaim");
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
  publishTrialOffer,
  setTrialOfferEnabled,
} = require("../../services/platformTrialOfferService");

const {
  createPlatformTrialSubscription,
} = require("../../services/platformTrialSubscriptionService");

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

const ids = {
  actorId: new mongoose.Types.ObjectId(),
  instituteIds: [],
  planId: null,
  planVersionId: null,
  offerId: null,
  createdPlan: false,
};

let passed = 0;
let failed = 0;

function logPass(message) {
  passed++;
  console.log(`PASS: ${message}`);
}

async function test(name, fn) {
  try {
    await fn();
    logPass(name);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function createTestPlanIfNeeded() {
  let plan = await SubscriptionPlan.findOne({ code: "FREE" });

  if (!plan) {
    plan = new SubscriptionPlan({
      code: "FREE",
      name: "Temporary Trial Transaction Test Plan",
      description: "Created only in the isolated test database",
      isActive: true,
      createdBy: ids.actorId,
      updatedBy: ids.actorId,
    });

    await plan.save();
    ids.createdPlan = true;
  }

  ids.planId = plan._id;

  if (plan.isActive !== true) {
    throw new Error(
      "The existing FREE plan in the test database is inactive. " +
      "No existing plan was modified."
    );
  }

  let version = plan.currentPublishedVersion
    ? await SubscriptionPlanVersion.findOne({
        _id: plan.currentPublishedVersion,
        planId: plan._id,
        status: "PUBLISHED",
      })
    : null;

  if (!version && ids.createdPlan) {
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

    version = await publishPlanVersion({
      planId: plan._id,
      versionId: draft._id,
      actorId: ids.actorId,
    });
  }

  if (!version) {
    throw new Error(
      "No valid published version exists for the FREE plan in the " +
      "test database. No existing plan or version was modified."
    );
  }

  if (
    version.amount !== 0 ||
    version.paymentRequired !== false
  ) {
    throw new Error(
      "The current FREE plan version must be zero-cost and require no payment."
    );
  }

  ids.planVersionId = version._id;
  return { plan, version };
}

async function createEnabledTestOffer() {
  const existingOffer = await PlatformTrialOffer.findOne({
    status: "PUBLISHED",
  });

  if (existingOffer) {
    throw new Error(
      "A published trial offer already exists in the test database. " +
      "This test will not alter or retire an existing offer."
    );
  }

  const { plan, version } = await createTestPlanIfNeeded();

  const draft = await createDraftTrialOffer({
    planId: plan._id,
    planVersionId: version._id,
    durationDays: 14,
    eligibility: "NEW_INSTITUTES_ONLY",
    actorId: ids.actorId,
  });

  ids.offerId = draft._id;

  await publishTrialOffer({
    offerId: draft._id,
    actorId: ids.actorId,
  });

  await setTrialOfferEnabled({
    offerId: draft._id,
    enabled: true,
    actorId: ids.actorId,
  });

  const savedOffer = await PlatformTrialOffer.findById(draft._id);

  assert.equal(savedOffer.status, "PUBLISHED");
  assert.equal(savedOffer.enabled, true);

  return savedOffer;
}

async function createTestInstitute(label) {
  const suffix = `${Date.now()}_${new mongoose.Types.ObjectId()
    .toString()
    .slice(-6)}`;

  const institute = new Institute({
    name: `Trial Test ${label} ${suffix}`,
    code: `TT${suffix}`.slice(0, 30),
    email: `trial-${label}-${suffix}@example.test`,
    approvalStatus: "PENDING",
    isActive: false,
    subscriptionStatus: "PENDING",
    subscriptionPlan: "FREE",
  });

  await institute.save();
  ids.instituteIds.push(institute._id);

  return institute;
}

async function cleanup() {
  // Delete only test records with IDs recorded by this test.
  if (ids.instituteIds.length) {
    await TrialEligibilityClaim.collection.deleteMany({
      instituteId: { $in: ids.instituteIds },
    });

    await Subscription.collection.deleteMany({
      instituteId: { $in: ids.instituteIds },
    });

    await Institute.collection.deleteMany({
      _id: { $in: ids.instituteIds },
    });
  }

  if (ids.offerId) {
    await PlatformTrialOffer.collection.deleteOne({
      _id: ids.offerId,
    });

    await PlatformTrialOfferAudit.collection.deleteMany({
      offerId: ids.offerId,
    });
  }

  if (ids.createdPlan && ids.planId) {
    await SubscriptionPlanVersion.collection.deleteMany({
      planId: ids.planId,
    });

    await SubscriptionPlan.collection.deleteOne({
      _id: ids.planId,
    });
  }
}

async function main() {
  assert.ok(
    process.env.MONGO_URI,
    "MONGO_URI is missing from the server .env file"
  );

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
      Institute.init(),
      Subscription.init(),
      TrialEligibilityClaim.init(),
      SubscriptionPlan.init(),
      SubscriptionPlanVersion.init(),
      PlatformTrialOffer.init(),
      PlatformTrialOfferAudit.init(),
    ]);

    await createEnabledTestOffer();

    await test(
      "Trial subscription and lifetime claim persist together",
      async () => {
        const institute = await createTestInstitute("Success");

        const result = await createPlatformTrialSubscription({
          instituteId: institute._id,
        });

        const savedSubscription = await Subscription.findById(
          result.subscription._id
        );

        const savedClaim = await TrialEligibilityClaim.findOne({
          instituteId: institute._id,
        });

        assert.ok(savedSubscription);
        assert.ok(savedClaim);

        assert.equal(savedSubscription.status, "PENDING");
        assert.equal(savedSubscription.subscriptionType, "TRIAL");
        assert.equal(savedSubscription.amount, 0);
        assert.equal(savedSubscription.paymentRequired, false);
        assert.equal(savedSubscription.startDate, null);
        assert.equal(savedSubscription.endDate, null);

        assert.equal(savedClaim.source, "PLATFORM_OFFER");
        assert.equal(
          String(savedClaim.subscriptionId),
          String(savedSubscription._id)
        );

        assert.equal(
          String(savedSubscription.platformTrialOfferId),
          String(ids.offerId)
        );

        assert.equal(
          String(savedClaim.platformTrialOfferId),
          String(ids.offerId)
        );

        assert.equal(
          String(savedClaim.planVersionId),
          String(ids.planVersionId)
        );
      }
    );

    await test(
      "Second lifetime trial claim is rejected",
      async () => {
        const institute = await createTestInstitute("Duplicate");

        await createPlatformTrialSubscription({
          instituteId: institute._id,
        });

        await assert.rejects(
          createPlatformTrialSubscription({
            instituteId: institute._id,
          }),
          (error) => error.code === "TRIAL_ALREADY_USED"
        );

        assert.equal(
          await Subscription.countDocuments({
            instituteId: institute._id,
          }),
          1
        );

        assert.equal(
          await TrialEligibilityClaim.countDocuments({
            instituteId: institute._id,
          }),
          1
        );
      }
    );

    await test(
      "Concurrent trial requests create only one lifetime claim",
      async () => {
        const institute = await createTestInstitute("Concurrent");

        const results = await Promise.allSettled([
          createPlatformTrialSubscription({
            instituteId: institute._id,
          }),
          createPlatformTrialSubscription({
            instituteId: institute._id,
          }),
        ]);

        const successful = results.filter(
          (result) => result.status === "fulfilled"
        );

        const rejected = results.filter(
          (result) => result.status === "rejected"
        );

        assert.equal(
          successful.length,
          1,
          "Exactly one concurrent request should succeed"
        );

        assert.equal(
          rejected.length,
          1,
          "Exactly one concurrent request should be rejected"
        );

        assert.equal(
          rejected[0].reason.code,
          "TRIAL_ALREADY_USED"
        );

        assert.equal(
          await Subscription.countDocuments({
            instituteId: institute._id,
          }),
          1,
          "Only one trial subscription should persist"
        );

        assert.equal(
          await TrialEligibilityClaim.countDocuments({
            instituteId: institute._id,
          }),
          1,
          "Only one lifetime claim should persist"
        );
      }
    );




    await test(
      "Claim-write failure rolls back the pending subscription",
      async () => {
        const institute = await createTestInstitute("Rollback");
        const originalSave = TrialEligibilityClaim.prototype.save;

        try {
          TrialEligibilityClaim.prototype.save = async function (...args) {
            if (this.isNew) {
              throw new Error("INJECTED_TRIAL_CLAIM_FAILURE");
            }

            return originalSave.apply(this, args);
          };

          await assert.rejects(
            createPlatformTrialSubscription({
              instituteId: institute._id,
            }),
            /INJECTED_TRIAL_CLAIM_FAILURE/
          );
        } finally {
          TrialEligibilityClaim.prototype.save = originalSave;
        }

        assert.equal(
          await Subscription.countDocuments({
            instituteId: institute._id,
          }),
          0,
          "Subscription must roll back when claim creation fails"
        );

        assert.equal(
          await TrialEligibilityClaim.countDocuments({
            instituteId: institute._id,
          }),
          0,
          "No lifetime claim should persist after transaction failure"
        );
      }
    );
  } finally {
    try {
      await cleanup();
    } finally {
      await mongoose.disconnect();
    }
  }

  console.log("\n--------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("--------------------------------");

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    console.log("All platform trial subscription transaction tests passed.");
  }
}

main().catch(async (error) => {
  console.error("\nTEST SETUP / RUNNER ERROR:", error.message);
  await cleanup().catch((cleanupError) => {
    console.error("Cleanup error:", cleanupError.message);
  });
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
