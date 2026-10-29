
require("dotenv").config();

const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Institute = require("./models/Institute");
const User = require("./models/User");
const Subscription = require("./models/Subscription");
const Payment = require("./models/Payment");
const SubscriptionPlan = require("./models/SubscriptionPlan");
const SubscriptionPlanVersion = require("./models/SubscriptionPlanVersion");

const TrialEligibilityClaim = require("./models/TrialEligibilityClaim");
const PlatformTrialOffer = require("./models/PlatformTrialOffer");
const PlatformTrialOfferAudit = require("./models/PlatformTrialOfferAudit");

const {
  createDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
} = require("./services/platformTrialOfferService");

const {
  createPlatformTrialSubscription,
} = require("./services/platformTrialSubscriptionService");


const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("./services/subscriptionPlanVersionService");

const {
  approveInstitute,
} = require("./controllers/adminInstituteController");

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
  userIds: [],
  subscriptionIds: [],
  paymentIds: [],
  createdPlanIds: [],
  createdOfferId: null,
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

function makeResponse() {
  return {
    statusCode: 200,
    body: null,

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function callApproval(instituteId, actorId = ids.actorId) {
  const req = {
    params: { instituteId: String(instituteId) },
    user: actorId ? { _id: actorId } : null,
  };

  const res = makeResponse();

  await approveInstitute(req, res);

  return res;
}

async function getPublishedTestPlan(code, amount, paymentRequired) {
  let plan = await SubscriptionPlan.findOne({ code });

  if (!plan) {
    plan = new SubscriptionPlan({
      code,
      name: `Approval Test ${code}`,
      description: "Created for isolated approval regression tests",
      isActive: true,
      createdBy: ids.actorId,
      updatedBy: ids.actorId,
    });

    await plan.save();
    ids.createdPlanIds.push(plan._id);
  } else if (plan.isActive !== true) {
    throw new Error(
      `Existing ${code} plan is inactive. No existing plan was modified.`
    );
  }

  let version = plan.currentPublishedVersion
    ? await SubscriptionPlanVersion.findOne({
        _id: plan.currentPublishedVersion,
        planId: plan._id,
        status: "PUBLISHED",
      })
    : null;

  if (!version && ids.createdPlanIds.some(
    (id) => String(id) === String(plan._id)
  )) {
    const draft = await createDraftPlanVersion({
      planId: plan._id,
      actorId: ids.actorId,
      configuration: {
        amount,
        currency: "INR",
        durationDays: 30,
        paymentRequired,
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
      `No current published version exists for ${code}. ` +
      "The test will not modify an existing plan."
    );
  }

  if (
    version.amount !== amount ||
    version.paymentRequired !== paymentRequired ||
    version.currency !== "INR"
  ) {
    throw new Error(
      `Existing ${code} plan version does not match the test configuration. ` +
      "No existing plan version was modified."
    );
  }

  return { plan, version };
}

async function ensureEnabledTrialOffer() {
  const existingOffer = await PlatformTrialOffer.findOne({
    status: "PUBLISHED",
  });

  if (existingOffer) {
    if (existingOffer.enabled !== true) {
      throw new Error(
        "A published trial offer exists but is disabled. " +
        "The test will not modify the existing offer."
      );
    }

    // Reuse the existing offer without changing it.
    return existingOffer;
  }

  const { plan, version } = await getPublishedTestPlan(
    "FREE",
    0,
    false
  );

  const draft = await createDraftTrialOffer({
    planId: plan._id,
    planVersionId: version._id,
    durationDays: 14,
    eligibility: "NEW_INSTITUTES_ONLY",
    actorId: ids.actorId,
  });

  ids.createdOfferId = draft._id;

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

  assert.ok(savedOffer, "Test trial offer was not saved");
  assert.equal(savedOffer.status, "PUBLISHED");
  assert.equal(savedOffer.enabled, true);

  return savedOffer;
}

async function createInstituteFixture(label, planCode, isTrial) {
  const suffix = `${Date.now()}_${new mongoose.Types.ObjectId()
    .toString()
    .slice(-6)}`;

  const institute = new Institute({
    name: `Approval Test ${label} ${suffix}`,
    code: `AT${suffix}`.slice(0, 30),
    email: `approval-${label}-${suffix}@example.test`,
    approvalStatus: "PENDING",
    isActive: false,
    subscriptionStatus: "PENDING",
    subscriptionPlan: planCode,
  });

  await institute.save();
  ids.instituteIds.push(institute._id);

  const admin = new User({
    instituteId: institute._id,
    name: `Test Admin ${label}`,
    email: `admin-${label}-${suffix}@example.test`,
    password: "TestPassword123!",
    role: "INSTITUTE_ADMIN",
    accountStatus: "PENDING",
    isActive: false,
    isDeleted: false,
  });

  await admin.save();
  ids.userIds.push(admin._id);

//   const amount = isTrial ? 0 : 999;
//   const paymentRequired = !isTrial;

//   const { plan, version } = await getPublishedTestPlan(
//     planCode,
//     amount,
//     paymentRequired
//   );

//   const subscriptionData = {
//     instituteId: institute._id,
//     subscriptionType: isTrial ? "TRIAL" : "STANDARD",
//     plan: plan.code,
//     planVersion: version.version,
//     planVersionId: version._id,
//     amount: version.amount,
//     currency: version.currency,
//     paymentRequired: version.paymentRequired,
//     durationDays: isTrial ? 14 : 30,
//     features: version.features.map(({ key, enabled }) => ({
//       key,
//       enabled,
//     })),
//     limits: version.limits.map(({ key, value }) => ({
//       key,
//       value,
//     })),
//     status: "PENDING",
//     startDate: null,
//     endDate: null,
//     activatedAt: null,
//     activatedBy: null,
//     autoRenew: false,
//   };

//   if (isTrial) {
//     subscriptionData.trialSource = "PLATFORM_OFFER";
//     subscriptionData.platformTrialOfferId =
//       new mongoose.Types.ObjectId();
//     subscriptionData.platformTrialOfferVersion = 1;
//     subscriptionData.trialGrantedBy = null;
//     subscriptionData.trialReason = null;
//   }

//   const subscription = new Subscription(subscriptionData);
//   await subscription.save();
//   ids.subscriptionIds.push(subscription._id);
let subscription;

if (isTrial) {
  // Create the real trial subscription and lifetime claim
  // from the currently published, enabled platform trial offer.
  const result = await createPlatformTrialSubscription({
    instituteId: institute._id,
  });

  subscription = result.subscription;
} else {
  const { plan, version } = await getPublishedTestPlan(
    planCode,
    999,
    true
  );

  subscription = new Subscription({
    instituteId: institute._id,
    subscriptionType: "STANDARD",
    plan: plan.code,
    planVersion: version.version,
    planVersionId: version._id,
    amount: version.amount,
    currency: version.currency,
    paymentRequired: version.paymentRequired,
    durationDays: version.durationDays,
    features: version.features.map(({ key, enabled }) => ({
      key,
      enabled,
    })),
    limits: version.limits.map(({ key, value }) => ({
      key,
      value,
    })),
    status: "PENDING",
    startDate: null,
    endDate: null,
    activatedAt: null,
    activatedBy: null,
    autoRenew: false,
  });

  await subscription.save();
}

ids.subscriptionIds.push(subscription._id);


  let payment = null;

  if (!isTrial) {
    payment = new Payment({
      instituteId: institute._id,
      subscriptionId: subscription._id,
      paymentType: "INSTITUTE_SUBSCRIPTION",
      amount: subscription.amount,
      currency: "INR",
      method: "MANUAL_UPI",
      gateway: "NONE",
      transactionId: `TEST-${suffix}`,
      status: "PENDING",
    });

    await payment.save();
    ids.paymentIds.push(payment._id);
  }

  return { institute, admin, subscription, payment };
}

async function cleanup() {
  // Only remove records created and tracked by this test.
  if (ids.instituteIds.length) {
    await TrialEligibilityClaim.collection.deleteMany({
      instituteId: { $in: ids.instituteIds },
    });
  }

  if (ids.createdOfferId) {
    await PlatformTrialOfferAudit.collection.deleteMany({
      offerId: ids.createdOfferId,
    });

    await PlatformTrialOffer.collection.deleteOne({
      _id: ids.createdOfferId,
    });
  }



  if (ids.paymentIds.length) {
    await Payment.collection.deleteMany({
      _id: { $in: ids.paymentIds },
    });
  }

  if (ids.subscriptionIds.length) {
    await Subscription.collection.deleteMany({
      _id: { $in: ids.subscriptionIds },
    });
  }

  if (ids.userIds.length) {
    await User.collection.deleteMany({
      _id: { $in: ids.userIds },
    });
  }

  if (ids.instituteIds.length) {
    await Institute.collection.deleteMany({
      _id: { $in: ids.instituteIds },
    });
  }

  for (const planId of ids.createdPlanIds) {
    await SubscriptionPlanVersion.collection.deleteMany({
      planId,
    });

    await SubscriptionPlan.collection.deleteOne({
      _id: planId,
    });
  }
}

async function main() {
  assert.ok(
    process.env.MONGO_URI,
    "MONGO_URI is missing from server/.env"
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
      User.init(),
      Subscription.init(),
      Payment.init(),
      SubscriptionPlan.init(),
      SubscriptionPlanVersion.init(),
    ]);

    // Create required published plans before running test cases.
    await getPublishedTestPlan("FREE", 0, false);
    await getPublishedTestPlan("BASIC", 999, true);

    await test(
      "Trial approval succeeds without a Payment record",
      async () => {
        await ensureEnabledTrialOffer();
        const fixture = await createInstituteFixture(
          "Trial",
          "FREE",
          true
        );

        const response = await callApproval(fixture.institute._id);

        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        assert.equal(response.body.success, true);

        const institute = await Institute.findById(
          fixture.institute._id
        );

        const admin = await User.findById(fixture.admin._id);

        const subscription = await Subscription.findById(
          fixture.subscription._id
        );

        assert.equal(institute.approvalStatus, "APPROVED");
        assert.equal(institute.isActive, true);
        assert.equal(admin.accountStatus, "ACTIVE");
        assert.equal(admin.isActive, true);
        assert.equal(subscription.status, "ACTIVE");
        assert.ok(subscription.startDate);
        assert.ok(subscription.endDate);
        assert.equal(subscription.paymentRequired, false);

const claim = await TrialEligibilityClaim.findOne({
  instituteId: fixture.institute._id,
  subscriptionId: fixture.subscription._id,
});

assert.ok(claim, "Lifetime trial claim should exist");
assert.equal(claim.source, "PLATFORM_OFFER");
assert.equal(
  String(claim.platformTrialOfferId),
  String(subscription.platformTrialOfferId)
);


        assert.equal(
          await Payment.countDocuments({
            subscriptionId: fixture.subscription._id,
          }),
          0
        );
      }
    );

    await test(
      "Paid approval verifies matching payment and activates subscription",
      async () => {
        const fixture = await createInstituteFixture(
          "Paid",
          "BASIC",
          false
        );

        const response = await callApproval(fixture.institute._id);

        assert.equal(response.statusCode, 200, JSON.stringify(response.body));
        assert.equal(response.body.success, true);

        const payment = await Payment.findById(fixture.payment._id);
        const subscription = await Subscription.findById(
          fixture.subscription._id
        );
        const institute = await Institute.findById(
          fixture.institute._id
        );

        assert.equal(payment.status, "VERIFIED");
        assert.equal(String(payment.verifiedBy), String(ids.actorId));
        assert.ok(payment.verifiedAt);
        assert.equal(subscription.status, "ACTIVE");
        assert.ok(subscription.startDate);
        assert.ok(subscription.endDate);
        assert.equal(institute.approvalStatus, "APPROVED");
      }
    );

    await test(
      "Paid approval rejects a missing matching payment without changing records",
      async () => {
        const fixture = await createInstituteFixture(
          "MissingPayment",
          "BASIC",
          false
        );

        // Remove only the payment created by this fixture.
        await Payment.collection.deleteOne({
          _id: fixture.payment._id,
        });

        const response = await callApproval(fixture.institute._id);

        assert.ok(response.statusCode >= 400);
        assert.equal(
          (await Institute.findById(fixture.institute._id)).approvalStatus,
          "PENDING"
        );
        assert.equal(
          (await Subscription.findById(fixture.subscription._id)).status,
          "PENDING"
        );
      }
    );

    await test(
      "Payment amount mismatch is rejected",
      async () => {
        const fixture = await createInstituteFixture(
          "AmountMismatch",
          "BASIC",
          false
        );

        await Payment.updateOne(
          { _id: fixture.payment._id },
          { $set: { amount: 123 } }
        );

        const response = await callApproval(fixture.institute._id);

        assert.ok(response.statusCode >= 400);

        assert.equal(
          (await Institute.findById(fixture.institute._id)).approvalStatus,
          "PENDING"
        );

        assert.equal(
          (await Subscription.findById(fixture.subscription._id)).status,
          "PENDING"
        );

        assert.equal(
          (await Payment.findById(fixture.payment._id)).status,
          "PENDING"
        );
      }
    );

    await test(
      "Activation failure rolls back institute approval and payment verification",
      async () => {
        const fixture = await createInstituteFixture(
          "Rollback",
          "BASIC",
          false
        );

        // Deliberately corrupt the saved feature snapshot to force
        // activateSubscription() to reject the subscription.
        await Subscription.updateOne(
          { _id: fixture.subscription._id },
          {
            $set: {
              features: [{ key: "AUTHENTICATION", enabled: false }],
            },
          }
        );

        const response = await callApproval(fixture.institute._id);

        assert.ok(response.statusCode >= 400);

        const institute = await Institute.findById(
          fixture.institute._id
        );
        const admin = await User.findById(fixture.admin._id);
        const subscription = await Subscription.findById(
          fixture.subscription._id
        );
        const payment = await Payment.findById(fixture.payment._id);

        assert.equal(institute.approvalStatus, "PENDING");
        assert.equal(institute.isActive, false);
        assert.equal(admin.accountStatus, "PENDING");
        assert.equal(admin.isActive, false);
        assert.equal(subscription.status, "PENDING");
        assert.equal(payment.status, "PENDING");
      }
    );

    await test(
      "Invalid institute ID is rejected before starting approval",
      async () => {
        const response = await callApproval("not-an-object-id");

        assert.equal(response.statusCode, 400);
        assert.equal(response.body.success, false);
      }
    );

    await test(
      "Missing authenticated Super Admin is rejected",
      async () => {
        const response = await callApproval(
          new mongoose.Types.ObjectId(),
          null
        );

        assert.equal(response.statusCode, 401);
        assert.equal(response.body.success, false);
      }
    );

    await test(
      "Already-approved institute cannot be approved twice",
      async () => {
        const fixture = await createInstituteFixture(
          "AlreadyApproved",
          "FREE",
          true
        );

        await Institute.updateOne(
          { _id: fixture.institute._id },
          {
            $set: {
              approvalStatus: "APPROVED",
              isActive: true,
            },
          }
        );

        const response = await callApproval(fixture.institute._id);

        assert.equal(response.statusCode, 409);
        assert.equal(response.body.success, false);
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
    console.log("All institute approval controller tests passed.");
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
