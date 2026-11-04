require("dotenv").config();

const mongoose = require("mongoose");

const Institute = require("../../models/Institute");
const Payment = require("../../models/Payment");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createSubscriptionPlan,
  activateSubscriptionPlan,
} = require("../../services/subscriptionPlanService");

const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const {
  hasVerifiedPayment,
} = require("../../services/subscriptionService");

const {
  verifyFinancialIntegrity,
  verifySubscriptionFinancials,
} = require("../../services/financialIntegrityService");

const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

const createdPlanIds = [];
const createdSubscriptionIds = [];
const createdPaymentIds = [];
const createdInstituteIds = [];

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectReject = async (operation, expectedMessagePart) => {
  let rejected = false;
  let receivedMessage = "";

  try {
    await operation();
  } catch (error) {
    rejected = true;
    receivedMessage = error.message || "";
  }

  assert(rejected, "Expected operation to reject, but it succeeded");

  if (
    expectedMessagePart &&
    !receivedMessage.includes(expectedMessagePart)
  ) {
    throw new Error(
      `Expected error containing "${expectedMessagePart}", received "${receivedMessage}"`
    );
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

const makeConfiguration = (overrides = {}) => ({
  amount: 999,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: getMandatoryFeatureKeys().map((key) => ({
    key,
    enabled: true,
  })),
  limits: [],
  ...overrides,
});

// ---------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------

const createTestInstitute = async () => {
  const instituteId = new mongoose.Types.ObjectId();

  await Institute.collection.insertOne({
    _id: instituteId,
    // Institute schema has a unique index on `code`.
    // Every fixture must supply a unique code to avoid
    // cross-test duplicate-key failures.
    code: `INST_${instituteId.toString()}`,
    name: "Financial Integrity Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    subscriptionPlan: "BASIC",
    subscriptionStatus: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdInstituteIds.push(instituteId);

  return instituteId;
};

const createPublishedPlanWithVersion = async ({
  amount = 999,
} = {}) => {
  const actorId = new mongoose.Types.ObjectId();

  const plan = await createSubscriptionPlan({
    code: `FIN_${new mongoose.Types.ObjectId().toString()}`,
    name: "Financial Integrity Test Plan",
    description: "Automated financial integrity test",
    actorId,
  });

  createdPlanIds.push(plan._id);

  await activateSubscriptionPlan({
    planId: plan._id,
    actorId,
  });

  const draft = await createDraftPlanVersion({
    planId: plan._id,
    configuration: makeConfiguration({ amount }),
    actorId,
  });

  const version = await publishPlanVersion({
    planId: plan._id,
    versionId: draft._id,
    actorId,
  });

  return { plan, version, actorId };
};

const createSubscriptionForVersion = async ({
  instituteId,
  version,
  plan,
  amount,
}) => {
  // The Subscription model restricts `plan` to a fixed enum
  // (FREE / BASIC / PRO / ENTERPRISE). Test plans use
  // dynamically generated codes, so we bypass Mongoose
  // validation using the raw collection. The financial
  // integrity assertions below do not depend on
  // plan.code === subscription.plan.
  const subscriptionId = new mongoose.Types.ObjectId();

  await Subscription.collection.insertOne({
    _id: subscriptionId,
    instituteId,
    subscriptionType: "STANDARD",
    plan: plan.code,
    planVersion: version.version,
    planVersionId: version._id,
    amount: amount ?? version.amount,
    currency: version.currency,
    paymentRequired: version.paymentRequired,
    durationDays: version.durationDays,
    features: version.features,
    limits: version.limits,
    status: "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdSubscriptionIds.push(subscriptionId);

  return await Subscription.findById(subscriptionId);
};

const createVerifiedPayment = async ({
  instituteId,
  subscription,
  amount,
  currency,
  actorId,
  status = "VERIFIED",
  paymentType = "INSTITUTE_SUBSCRIPTION",
}) => {
  const payment = await Payment.create({
    instituteId,
    subscriptionId: subscription._id,
    paymentType,
    amount: amount ?? subscription.amount,
    currency: currency ?? subscription.currency,
    method: "ONLINE_GATEWAY",
    gateway: "RAZORPAY",
    transactionId: `TXN_${new mongoose.Types.ObjectId().toString()}`,
    status,
    verifiedAt: status === "VERIFIED" ? new Date() : null,
    verifiedBy: status === "VERIFIED" ? actorId : null,
  });

  createdPaymentIds.push(payment._id);

  return payment;
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // A. hasVerifiedPayment baseline behavior
    // =====================================================

    await test(
      "hasVerifiedPayment returns the matching VERIFIED payment",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const payment = await hasVerifiedPayment(subscription);
        assert(payment, "Expected a verified payment");
        assert(
          payment.amount === 999,
          "Verified payment amount should be 999"
        );
      }
    );

    await test(
      "hasVerifiedPayment returns null when payment is PENDING",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
          status: "PENDING",
        });

        const payment = await hasVerifiedPayment(subscription);
        assert(
          payment === null,
          "PENDING payment must not count as verified"
        );
      }
    );

    await test(
      "hasVerifiedPayment rejects amount mismatch",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
          amount: 1,
        });

        const payment = await hasVerifiedPayment(subscription);
        assert(
          payment === null,
          "Mismatched amount must not verify"
        );
      }
    );

    await test(
      "hasVerifiedPayment rejects currency mismatch",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
          currency: "USD",
        });

        const payment = await hasVerifiedPayment(subscription);
        assert(
          payment === null,
          "Mismatched currency must not verify"
        );
      }
    );

    await test(
      "hasVerifiedPayment rejects wrong subscription",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscriptionA = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const subscriptionB = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription: subscriptionA,
          actorId,
        });

        const payment = await hasVerifiedPayment(subscriptionB);
        assert(
          payment === null,
          "Payment for another subscription must not verify"
        );
      }
    );

    await test(
      "hasVerifiedPayment rejects wrong paymentType",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
          paymentType: "STUDENT_COURSE",
        });

        const payment = await hasVerifiedPayment(subscription);
        assert(
          payment === null,
          "Non-institute-subscription payment must not verify"
        );
      }
    );

    // =====================================================
    // B. Regression: plan price change must not break
    //    an existing subscription's verified payment
    // =====================================================

    await test(
      "Regression: after v4 publish, v3 subscription still verifies",
      async () => {
        const instituteId = await createTestInstitute();

        const { plan, version: v3, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });

        const subscription = await createSubscriptionForVersion({
          instituteId,
          version: v3,
          plan,
        });

        await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        // Baseline check.
        const beforePayment = await hasVerifiedPayment(subscription);
        assert(beforePayment, "Baseline: payment should verify");

        // Publish v4 with a new price.
        const v4Draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration({ amount: 1999 }),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: v4Draft._id,
          actorId,
        });

        // Re-verify.
        const afterPayment = await hasVerifiedPayment(subscription);
        assert(
          afterPayment,
          "Regression: v3 payment must still verify after v4 publish"
        );

        // Subscription snapshot must still point at v3 and 999.
        const reloaded =
          await Subscription.findById(subscription._id);
        assert(
          reloaded.planVersionId.toString() === v3._id.toString(),
          "Subscription must still reference v3"
        );
        assert(
          reloaded.amount === 999,
          "Subscription amount must still be 999"
        );

        // v3 must be RETIRED, not deleted or mutated.
        const reloadedV3 = await SubscriptionPlanVersion.findById(
          v3._id
        );
        assert(
          reloadedV3.status === "RETIRED",
          "v3 must be RETIRED"
        );
        assert(
          reloadedV3.amount === 999,
          "v3 amount must remain 999"
        );
      }
    );

    // =====================================================
    // C. Pure verification service behavior
    // =====================================================

    await test(
      "verifyFinancialIntegrity accepts a fully consistent triplet",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const ok = verifyFinancialIntegrity({
          payment,
          subscription,
          planVersion: version,
        });
        assert(ok === true, "Expected verification to succeed");
      }
    );

    await test(
      "verifyFinancialIntegrity rejects amount mismatch",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        await expectReject(
          () =>
            verifyFinancialIntegrity({
              payment,
              subscription,
              planVersion: { ...version.toObject(), amount: 1999 },
            }),
          "amount"
        );
      }
    );

    await test(
      "verifyFinancialIntegrity rejects currency mismatch",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        await expectReject(
          () =>
            verifyFinancialIntegrity({
              payment,
              subscription,
              planVersion: {
                ...version.toObject(),
                currency: "USD",
              },
            }),
          "currency"
        );
      }
    );

    await test(
      "verifyFinancialIntegrity rejects planVersion reference mismatch",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        await expectReject(
          () =>
            verifyFinancialIntegrity({
              payment,
              subscription,
              planVersion: {
                ...version.toObject(),
                _id: new mongoose.Types.ObjectId(),
              },
            }),
          "reference"
        );
      }
    );

    await test(
      "verifySubscriptionFinancials validates subscription vs version",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version } = await createPublishedPlanWithVersion({
          amount: 999,
        });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });

        const ok = verifySubscriptionFinancials(
          subscription,
          version
        );
        assert(ok === true, "Expected subscription verification to pass");
      }
    );

    // =====================================================
    // D. Payment immutability after verification
    // =====================================================

    await test(
      "Verified payment: save with amount change is rejected",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.amount = 1;

        await expectReject(
          () => reloaded.save(),
          "immutable"
        );

        const stored = await Payment.findById(payment._id);
        assert(
          stored.amount === 999,
          "Stored amount must remain 999"
        );
      }
    );

    await test(
      "Verified payment: save with currency change is rejected",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.currency = "USD";

        await expectReject(
          () => reloaded.save(),
          "immutable"
        );

        const stored = await Payment.findById(payment._id);
        assert(
          stored.currency === "INR",
          "Stored currency must remain INR"
        );
      }
    );

    await test(
      "Verified payment: save with verifiedBy change is rejected",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.verifiedBy = new mongoose.Types.ObjectId();

        await expectReject(
          () => reloaded.save(),
          "immutable"
        );
      }
    );

    await test(
      "Verified payment: updateOne with amount change is rejected",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        await expectReject(
          () =>
            Payment.updateOne(
              { _id: payment._id },
              { $set: { amount: 1 } }
            ),
          "cannot be modified"
        );

        const stored = await Payment.findById(payment._id);
        assert(
          stored.amount === 999,
          "Stored amount must remain 999"
        );
      }
    );

    await test(
      "Verified payment: notes may still be updated",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.notes = "Finance department confirmed";
        await reloaded.save();

        const stored = await Payment.findById(payment._id);
        assert(
          stored.notes === "Finance department confirmed",
          "Notes update must succeed"
        );
      }
    );

    // =====================================================
    // E. Status transitions
    // =====================================================

    await test(
      "PENDING -> VERIFIED transition is allowed and freezes financials",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
          status: "PENDING",
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.status = "VERIFIED";
        reloaded.verifiedAt = new Date();
        reloaded.verifiedBy = actorId;
        await reloaded.save();

        const stored = await Payment.findById(payment._id);
        assert(
          stored.status === "VERIFIED",
          "Payment should be VERIFIED"
        );

        // Attempting to tamper now must fail.
        const tampered = await Payment.findById(payment._id);
        tampered.amount = 1;

        await expectReject(() => tampered.save(), "immutable");
      }
    );

    await test(
      "VERIFIED -> REFUNDED transition is allowed",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.status = "REFUNDED";
        await reloaded.save();

        const stored = await Payment.findById(payment._id);
        assert(
          stored.status === "REFUNDED",
          "Payment should be REFUNDED"
        );
      }
    );

    await test(
      "VERIFIED -> PENDING transition is rejected",
      async () => {
        const instituteId = await createTestInstitute();
        const { plan, version, actorId } =
          await createPublishedPlanWithVersion({ amount: 999 });
        const subscription = await createSubscriptionForVersion({
          instituteId,
          version,
          plan,
        });
        const payment = await createVerifiedPayment({
          instituteId,
          subscription,
          actorId,
        });

        const reloaded = await Payment.findById(payment._id);
        reloaded.status = "PENDING";

        await expectReject(
          () => reloaded.save(),
          "Invalid payment status transition"
        );
      }
    );

    console.log(
      "\nAll financial integrity tests executed."
    );
  } finally {
    console.log("\nCleaning up test-created records...");

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

    if (createdPlanIds.length > 0) {
      await SubscriptionPlanVersion.collection.deleteMany({
        planId: { $in: createdPlanIds },
      });

      const { AuditLog } = require("../../models/AuditLog");
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

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});