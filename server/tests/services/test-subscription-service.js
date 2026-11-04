const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");

const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const User = require("../../models/User");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

const {
  activateSubscription,
  transitionSubscriptionStatus,
  getEffectiveSubscription,
  validatePlanSnapshot
} = require("../../services/subscriptionService");

const {
  SUBSCRIPTION_STATUS,
} = require("../../constants/subscriptionStatuses");


const TEST_PREFIX = "SUB_SERVICE_TEST_";

const results = [];

const createdPlanIds = [];
const createdVersionIds = [];
const createdSubscriptionIds = [];

const pass = (name) => {
  results.push({
    test: name,
    status: "PASS",
  });
  console.log(`PASS: ${name}`);
};

const fail = (name, error) => {
  results.push({
    test: name,
    status: "FAIL",
    error: error.message,
  });
  console.error(`FAIL: ${name}`);
  console.error(`     ${error.message}`);
};

const expectErrorCode = async (
  name,
  fn,
  expectedCode
) => {
  try {
    await fn();

    fail(
      name,
      new Error(
        `Expected error code ${expectedCode}, but operation succeeded`
      )
    );
  } catch (error) {
    if (error.code !== expectedCode) {
      fail(
        name,
        new Error(
          `Expected ${expectedCode}, received ${error.code || "NO_CODE"}: ${error.message}`
        )
      );
      return;
    }

    pass(name);
  }
};

const createTestInstitute = async (suffix) => {
  return Institute.create({
    name: `${TEST_PREFIX}${suffix}`,
    //   code: `${TEST_PREFIX}${suffix}_${Date.now()}`,
    code: `SUBT_${suffix}_${Date.now()}`,
    approvalStatus: "APPROVED",
    isActive: true,
    subscriptionStatus: "PENDING",
    subscriptionPlan: "FREE",
  });
};

const createSubscription = async ({
  instituteId,
  subscriptionType = "STANDARD",
  plan = "BASIC",
  amount = 999,
  paymentRequired = true,
  durationDays = 30,
  trialGrantedBy = null,
}) => {
  return Subscription.create({
    instituteId,
    subscriptionType,
    plan,
    planVersion: 1,
    amount,
    currency: "INR",
    paymentRequired,
    durationDays,
    status: SUBSCRIPTION_STATUS.PENDING,
    autoRenew: false,
    trialGrantedBy,
  });
};

const createPayment = async ({
  instituteId,
  subscriptionId,
  status = "PENDING",
}) => {
  return Payment.create({
    instituteId,
    subscriptionId,
    paymentType: "INSTITUTE_SUBSCRIPTION",
    amount: 999,
    currency: "INR",
    method: "MANUAL_UPI",
    gateway: "NONE",
    transactionId: `${TEST_PREFIX}TXN_${Date.now()}_${Math.random()}`,
    status,
    verifiedAt:
      status === "VERIFIED"
        ? new Date()
        : null,
  });
};

const makePlanVersionConfiguration = (overrides = {}) => ({
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

const createHistoricalTestPlan = async () => {
  const actorId = new mongoose.Types.ObjectId();

  const plan = await SubscriptionPlan.create({
    code: "BASIC",
    name: `${TEST_PREFIX}HISTORICAL_BASIC`,
    description: "Historical snapshot regression test",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });

  createdPlanIds.push(plan._id);

  return { plan, actorId };
};

const createHistoricalDraft = async (
  planId,
  actorId,
  configuration
) => {
  const draft = await createDraftPlanVersion({
    planId,
    actorId,
    configuration,
  });

  createdVersionIds.push(draft._id);

  return draft;
};

const run = async () => {
  let testInstitute = null;
  let trialInstitute = null;
  let paymentInstitute = null;
  let suspensionInstitute = null;

  try {
    await connectTestDB();

    console.log(
      "\nConnected to MongoDB for subscription service regression.\n"
    );

    // -----------------------------------------------------
    // HISTORICAL SNAPSHOT REGRESSION
    // Existing subscription must remain valid after its
    // referenced published version becomes RETIRED.
    // -----------------------------------------------------

    await (async () => {
      const testName =
        "Existing subscription remains valid against its retired plan version";

      try {
        const { plan, actorId } =
          await createHistoricalTestPlan();

        // Publish version 1.
        const firstDraft =
          await createHistoricalDraft(
            plan._id,
            actorId,
            makePlanVersionConfiguration({
              amount: 999,
            })
          );

        const firstPublished =
          await publishPlanVersion({
            planId: plan._id,
            versionId: firstDraft._id,
            actorId,
          });

        // Create an institute for this subscription.
        const historicalInstitute =
          await createTestInstitute("HISTORICAL");

        // Capture the exact version 1 snapshot.
        const historicalSubscription =
          await Subscription.create({
            instituteId: historicalInstitute._id,
            subscriptionType: "STANDARD",
            plan: "BASIC",
            planVersion: firstPublished.version,
            planVersionId: firstPublished._id,
            amount: firstPublished.amount,
            currency: firstPublished.currency,
            paymentRequired: firstPublished.paymentRequired,
            durationDays: firstPublished.durationDays,
            features: firstPublished.features,
            limits: firstPublished.limits,
            status: SUBSCRIPTION_STATUS.PENDING,
            autoRenew: false,
          });

        createdSubscriptionIds.push(
          historicalSubscription._id
        );

        // Publish version 2 with a different price.
        const secondDraft =
          await createHistoricalDraft(
            plan._id,
            actorId,
            makePlanVersionConfiguration({
              amount: 1499,
            })
          );

        await publishPlanVersion({
          planId: plan._id,
          versionId: secondDraft._id,
          actorId,
        });

        // Reload all relevant records.
        const storedFirstVersion =
          await SubscriptionPlanVersion.findById(
            firstPublished._id
          );

        const storedSecondVersion =
          await SubscriptionPlanVersion.findById(
            secondDraft._id
          );

        const storedSubscription =
          await Subscription.findById(
            historicalSubscription._id
          );

        // Version 1 must now be RETIRED.
        if (storedFirstVersion.status !== "RETIRED") {
          throw new Error(
            "Version 1 was not retired after publishing version 2"
          );
        }

        if (storedSecondVersion.status !== "PUBLISHED") {
          throw new Error(
            "Version 2 is not PUBLISHED"
          );
        }

        // Existing subscription must still reference version 1.
        if (
          storedSubscription.planVersionId.toString() !==
          storedFirstVersion._id.toString()
        ) {
          throw new Error(
            "Existing subscription reference changed"
          );
        }

        // Validate the historical snapshot.
        const validatedPlan =
          await validatePlanSnapshot(
            storedSubscription
          );

        if (
          validatedPlan._id.toString() !==
          plan._id.toString()
        ) {
          throw new Error(
            "Historical subscription resolved to the wrong logical plan"
          );
        }

        // Verify commercial snapshot did not change.
        if (
          storedSubscription.amount !== 999 ||
          storedSubscription.currency !== "INR" ||
          storedSubscription.paymentRequired !== true ||
          storedSubscription.durationDays !== 30 ||
          storedSubscription.planVersion !== 1
        ) {
          throw new Error(
            "Historical commercial snapshot changed"
          );
        }

        // Verify entitlement snapshot remains unchanged.
        const normalizedFeatures = (items = []) =>
          items
            .map(({ key, enabled }) => ({
              key,
              enabled,
            }))
            .sort((a, b) => a.key.localeCompare(b.key));

        const normalizedLimits = (items = []) =>
          items
            .map(({ key, value }) => ({
              key,
              value: value ?? null,
            }))
            .sort((a, b) => a.key.localeCompare(b.key));

        if (
          JSON.stringify(
            normalizedFeatures(storedSubscription.features)
          ) !==
          JSON.stringify(
            normalizedFeatures(firstPublished.features)
          )
        ) {
          throw new Error(
            "Historical feature snapshot changed"
          );
        }

        if (
          JSON.stringify(
            normalizedLimits(storedSubscription.limits)
          ) !==
          JSON.stringify(
            normalizedLimits(firstPublished.limits)
          )
        ) {
          throw new Error(
            "Historical limit snapshot changed"
          );
        }

        pass(testName);
      } catch (error) {
        fail(testName, error);
      }
    })();

    // -----------------------------------------------------
    // TEST 1
    // FREE subscription should not require payment
    // -----------------------------------------------------

    testInstitute =
      await createTestInstitute("FREE");

    const freeSubscription =
      await createSubscription({
        instituteId: testInstitute._id,
        plan: "FREE",
        amount: 0,
        paymentRequired: false,
        durationDays: null,
      });

    await activateSubscription({
      subscriptionId:
        freeSubscription._id,
    });

    const freeActivated =
      await Subscription.findById(
        freeSubscription._id
      );

    if (
      freeActivated.status ===
      SUBSCRIPTION_STATUS.ACTIVE &&
      freeActivated.startDate &&
      freeActivated.endDate === null
    ) {
      pass("FREE subscription activates without payment");
    } else {
      fail(
        "FREE subscription activates without payment",
        new Error(
          "FREE subscription did not receive expected ACTIVE state"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 2
    // TRIAL subscription should not require payment
    // -----------------------------------------------------

    trialInstitute =
      await createTestInstitute("TRIAL");

    const trialUser =
      await User.findOne({
        role: "SUPER_ADMIN",
        isDeleted: false,
      }).select("_id");

    if (!trialUser) {
      throw new Error(
        "Existing SUPER_ADMIN required for trial regression test"
      );
    }

    const trialSubscription =
      await createSubscription({
        instituteId: trialInstitute._id,
        subscriptionType: "TRIAL",
        plan: "PRO",
        amount: 0,
        paymentRequired: false,
        durationDays: 30,
        trialGrantedBy: trialUser._id,
      });

    await activateSubscription({
      subscriptionId:
        trialSubscription._id,
      activatedBy: trialUser._id,
    });

    const trialActivated =
      await Subscription.findById(
        trialSubscription._id
      );

    if (
      trialActivated.status ===
      SUBSCRIPTION_STATUS.ACTIVE &&
      trialActivated.startDate &&
      trialActivated.endDate
    ) {
      pass("TRIAL subscription activates without payment");
    } else {
      fail(
        "TRIAL subscription activates without payment",
        new Error(
          "TRIAL subscription did not activate correctly"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 3
    // Trial activation is blocked for an unapproved institute
    // -----------------------------------------------------

    const unapprovedTrialInstitute =
      await Institute.create({
        name: `${TEST_PREFIX}TRIAL_UNAPPROVED`,
        //code: `SUBT_TRIAL_UNAPPROVED_${Date.now()}`,
        code: `TRUN_${Date.now()}`,
        approvalStatus: "PENDING",
        isActive: false,
        subscriptionStatus: "PENDING",
        subscriptionPlan: "FREE",
      });

    const unapprovedTrialSubscription =
      await createSubscription({
        instituteId: unapprovedTrialInstitute._id,
        subscriptionType: "TRIAL",
        plan: "PRO",
        amount: 0,
        paymentRequired: false,
        durationDays: 30,
        trialGrantedBy: trialUser._id,
      });

    await expectErrorCode(
      "Trial activation is blocked for an unapproved institute",
      () =>
        activateSubscription({
          subscriptionId:
            unapprovedTrialSubscription._id,
          activatedBy: trialUser._id,
        }),
      "INSTITUTE_NOT_ACTIVE"
    );

    const unapprovedTrialAfterAttempt =
      await Subscription.findById(
        unapprovedTrialSubscription._id
      );

    const unapprovedInstituteAfterAttempt =
      await Institute.findById(
        unapprovedTrialInstitute._id
      );

    if (
      unapprovedTrialAfterAttempt &&
      unapprovedTrialAfterAttempt.status ===
      SUBSCRIPTION_STATUS.PENDING &&
      !unapprovedTrialAfterAttempt.startDate &&
      !unapprovedTrialAfterAttempt.endDate &&
      !unapprovedTrialAfterAttempt.activatedAt &&
      unapprovedInstituteAfterAttempt &&
      unapprovedInstituteAfterAttempt.subscriptionStatus ===
      "PENDING"
    ) {
      pass(
        "Rejected trial activation leaves subscription and institute unchanged"
      );
    } else {
      fail(
        "Rejected trial activation leaves subscription and institute unchanged",
        new Error(
          "Activation attempt changed the trial or institute state"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 4
    // Paid subscription without verified payment
    // must be blocked.
    // -----------------------------------------------------

    paymentInstitute =
      await createTestInstitute("PAYMENT");

    const unpaidSubscription =
      await createSubscription({
        instituteId: paymentInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await expectErrorCode(
      "Paid subscription without verified payment is blocked",
      () =>
        activateSubscription({
          subscriptionId:
            unpaidSubscription._id,
        }),
      "PAYMENT_NOT_VERIFIED"
    );

    // -----------------------------------------------------
    // TEST 5
    // Verified payment allows activation
    // -----------------------------------------------------

    await createPayment({
      instituteId:
        paymentInstitute._id,
      subscriptionId:
        unpaidSubscription._id,
      status: "VERIFIED",
    });

    await activateSubscription({
      subscriptionId:
        unpaidSubscription._id,
    });

    const paidActivated =
      await Subscription.findById(
        unpaidSubscription._id
      );

    if (
      paidActivated.status ===
      SUBSCRIPTION_STATUS.ACTIVE
    ) {
      pass(
        "Paid subscription with verified payment activates"
      );
    } else {
      fail(
        "Paid subscription with verified payment activates",
        new Error(
          "Subscription did not become ACTIVE"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 6
    // Second ACTIVE subscription blocked
    // -----------------------------------------------------

    const duplicateSubscription =
      await createSubscription({
        instituteId:
          paymentInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await createPayment({
      instituteId:
        paymentInstitute._id,
      subscriptionId:
        duplicateSubscription._id,
      status: "VERIFIED",
    });

    await expectErrorCode(
      "Second ACTIVE subscription is blocked",
      () =>
        activateSubscription({
          subscriptionId:
            duplicateSubscription._id,
        }),
      "ACTIVE_SUBSCRIPTION_EXISTS"
    );

    // -----------------------------------------------------
    // TEST 7
    // Invalid lifecycle transition
    // PENDING -> EXPIRED
    // -----------------------------------------------------

    const invalidTransitionSubscription =
      await createSubscription({
        instituteId:
          paymentInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await expectErrorCode(
      "Invalid PENDING to EXPIRED transition is blocked",
      () =>
        transitionSubscriptionStatus({
          subscriptionId:
            invalidTransitionSubscription._id,
          targetStatus:
            SUBSCRIPTION_STATUS.EXPIRED,
        }),
      "INVALID_STATUS_TRANSITION"
    );

    // -----------------------------------------------------
    // TEST 8
    // Institute summary synchronization
    // -----------------------------------------------------

    const instituteAfterActivation =
      await Institute.findById(
        paymentInstitute._id
      );

    if (
      instituteAfterActivation.subscriptionPlan ===
      "BASIC" &&
      instituteAfterActivation.subscriptionStatus ===
      "ACTIVE"
    ) {
      pass(
        "Institute subscription summary is synchronized"
      );
    } else {
      fail(
        "Institute subscription summary is synchronized",
        new Error(
          `Unexpected summary: plan=${instituteAfterActivation.subscriptionPlan}, status=${instituteAfterActivation.subscriptionStatus}`
        )
      );
    }

    // -----------------------------------------------------
    // TEST 9
    // ACTIVE -> SUSPENDED
    // -----------------------------------------------------

    await transitionSubscriptionStatus({
      subscriptionId:
        unpaidSubscription._id,
      targetStatus:
        SUBSCRIPTION_STATUS.SUSPENDED,
      reason: "Regression test suspension",
    });

    const suspended =
      await Subscription.findById(
        unpaidSubscription._id
      );

    if (
      suspended.status ===
      SUBSCRIPTION_STATUS.SUSPENDED &&
      suspended.suspendedAt
    ) {
      pass(
        "ACTIVE to SUSPENDED transition works"
      );
    } else {
      fail(
        "ACTIVE to SUSPENDED transition works",
        new Error(
          "Subscription was not correctly suspended"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 11
    // SUSPENDED -> ACTIVE
    // -----------------------------------------------------

    await transitionSubscriptionStatus({
      subscriptionId:
        unpaidSubscription._id,
      targetStatus:
        SUBSCRIPTION_STATUS.ACTIVE,
      reason: "Regression test resume",
    });

    const resumed =
      await Subscription.findById(
        unpaidSubscription._id
      );

    if (
      resumed.status ===
      SUBSCRIPTION_STATUS.ACTIVE
    ) {
      pass(
        "SUSPENDED to ACTIVE transition works"
      );
    } else {
      fail(
        "SUSPENDED to ACTIVE transition works",
        new Error(
          "Subscription was not correctly resumed"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 10
    // Effective subscription check
    // -----------------------------------------------------

    const effective =
      await getEffectiveSubscription(
        paymentInstitute._id
      );

    if (
      effective &&
      effective.status ===
      SUBSCRIPTION_STATUS.ACTIVE
    ) {
      pass(
        "Effective ACTIVE subscription is returned"
      );
    } else {
      fail(
        "Effective ACTIVE subscription is returned",
        new Error(
          "Effective subscription was not returned"
        )
      );
    }

    // -----------------------------------------------------
    // TEST 12
    // Expired subscription cannot resume
    // -----------------------------------------------------

    suspensionInstitute =
      await createTestInstitute("EXPIRY");

    const expiredSubscription =
      await createSubscription({
        instituteId:
          suspensionInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await createPayment({
      instituteId:
        suspensionInstitute._id,
      subscriptionId:
        expiredSubscription._id,
      status: "VERIFIED",
    });

    await activateSubscription({
      subscriptionId:
        expiredSubscription._id,
    });

    await Subscription.updateOne(
      {
        _id:
          expiredSubscription._id,
      },
      {
        $set: {
          endDate: new Date(
            Date.now() - 86400000
          ),
          status:
            SUBSCRIPTION_STATUS.SUSPENDED,
        },
      }
    );

    await expectErrorCode(
      "Expired SUSPENDED subscription cannot resume",
      () =>
        transitionSubscriptionStatus({
          subscriptionId:
            expiredSubscription._id,
          targetStatus:
            SUBSCRIPTION_STATUS.ACTIVE,
        }),
      "SUBSCRIPTION_EXPIRED"
    );

    // -----------------------------------------------------
    // Summary
    // -----------------------------------------------------

    console.log(
      "\n----------------------------------------"
    );

    const passed = results.filter(
      (item) => item.status === "PASS"
    ).length;

    const failed = results.filter(
      (item) => item.status === "FAIL"
    ).length;

    console.log(
      `Subscription Service Regression: ${passed} PASS / ${failed} FAIL`
    );

    console.log(
      "----------------------------------------\n"
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      "\nREGRESSION RUN FAILED:"
    );
    console.error(error);
    process.exitCode = 1;
  } finally {
    // -----------------------------------------------------
    // Cleanup ONLY our test institutes/data
    // Existing project data is untouched.
    // -----------------------------------------------------

    try {
      const testInstitutes =
        await Institute.find({
          name: {
            $regex: `^${TEST_PREFIX}`,
          },
        }).select("_id");

      const instituteIds =
        testInstitutes.map(
          (item) => item._id
        );

      if (instituteIds.length > 0) {
        await Payment.deleteMany({
          instituteId: {
            $in: instituteIds,
          },
        });

        await Subscription.deleteMany({
          instituteId: {
            $in: instituteIds,
          },
        });

        await Institute.deleteMany({
          _id: {
            $in: instituteIds,
          },
        });
      }


      if (createdSubscriptionIds.length > 0) {
        await Subscription.deleteMany({
          _id: {
            $in: createdSubscriptionIds,
          },
        });
      }

      if (createdVersionIds.length > 0) {
        await SubscriptionPlanVersion.collection.deleteMany({
          _id: {
            $in: createdVersionIds,
          },
        });
      }

      if (createdPlanIds.length > 0) {
        await SubscriptionPlan.collection.deleteMany({
          _id: {
            $in: createdPlanIds,
          },
        });
      }


      console.log(
        "Test data cleanup completed."
      );
    } catch (cleanupError) {
      console.error(
        "Test cleanup failed:",
        cleanupError.message
      );
      process.exitCode = 1;
    }

    await mongoose.disconnect();
  }
};

run();