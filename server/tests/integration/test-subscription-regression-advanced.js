const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");

const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const Payment = require("../../models/Payment");
const User = require("../../models/User");

const {
  activateSubscription,
  transitionSubscriptionStatus,
  getEffectiveSubscription,
} = require("../../services/subscriptionService");

const {
  SUBSCRIPTION_STATUS,
} = require("../../constants/subscriptionStatuses");


const TEST_PREFIX = "SUB_ADV_REG_";

const results = [];

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
        `Expected ${expectedCode}, but operation succeeded`
      )
    );
  } catch (error) {
    if (error.code !== expectedCode) {
      fail(
        name,
        new Error(
          `Expected ${expectedCode}, received ${
            error.code || "NO_CODE"
          }: ${error.message}`
        )
      );

      return;
    }

    pass(name);
  }
};

const createInstitute = async (suffix) => {
  return Institute.create({
    name: `${TEST_PREFIX}${suffix}`,
    code: `SAR_${Date.now()}_${Math.floor(
      Math.random() * 10000
    )}`,
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
  status = SUBSCRIPTION_STATUS.PENDING,
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
    status,
    autoRenew: false,
    trialGrantedBy,
  });
};

const createPayment = async ({
  instituteId,
  subscriptionId,
  amount = 999,
  currency = "INR",
  status = "PENDING",
}) => {
  return Payment.create({
    instituteId,
    subscriptionId,
    paymentType: "INSTITUTE_SUBSCRIPTION",
    amount,
    currency,
    method: "MANUAL_UPI",
    gateway: "NONE",
    transactionId:
      `${TEST_PREFIX}TXN_${Date.now()}_${Math.random()}`,
    status,
    verifiedAt:
      status === "VERIFIED"
        ? new Date()
        : null,
  });
};

const run = async () => {
  let instituteA = null;
  let instituteB = null;

  try {
    await connectTestDB();

    console.log(
      "\nConnected to MongoDB for advanced subscription regression.\n"
    );

    // ----------------------------------------------------
    // TEST 1
    // FREE subscription activates without payment
    // ----------------------------------------------------

    instituteA = await createInstitute("FREE");

    const freeSubscription =
      await createSubscription({
        instituteId: instituteA._id,
        plan: "FREE",
        amount: 0,
        paymentRequired: false,
        durationDays: null,
      });

    await activateSubscription({
      subscriptionId: freeSubscription._id,
    });

    const freeActivated =
      await Subscription.findById(
        freeSubscription._id
      );

    if (
      freeActivated.status ===
        SUBSCRIPTION_STATUS.ACTIVE &&
      freeActivated.endDate === null
    ) {
      pass(
        "FREE subscription activates without payment"
      );
    } else {
      fail(
        "FREE subscription activates without payment",
        new Error(
          "FREE subscription did not activate correctly"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 2
    // TRIAL subscription activates without payment
    // ----------------------------------------------------

    const superAdmin =
      await User.findOne({
        role: "SUPER_ADMIN",
        isDeleted: false,
      }).select("_id");

    if (!superAdmin) {
      throw new Error(
        "SUPER_ADMIN required for trial regression"
      );
    }

    const trialInstitute =
      await createInstitute("TRIAL");

    const trialSubscription =
      await createSubscription({
        instituteId:
          trialInstitute._id,
        subscriptionType: "TRIAL",
        plan: "PRO",
        amount: 0,
        paymentRequired: false,
        durationDays: 30,
        trialGrantedBy: superAdmin._id,
      });

    await activateSubscription({
      subscriptionId:
        trialSubscription._id,
      activatedBy: superAdmin._id,
    });

    const trialActivated =
      await Subscription.findById(
        trialSubscription._id
      );

    if (
      trialActivated.status ===
        SUBSCRIPTION_STATUS.ACTIVE &&
      trialActivated.endDate &&
      trialActivated.amount === 0 &&
      trialActivated.paymentRequired === false
    ) {
      pass(
        "TRIAL subscription activates without payment"
      );
    } else {
      fail(
        "TRIAL subscription activates without payment",
        new Error(
          "TRIAL subscription state is incorrect"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 3
    // Paid subscription without payment blocked
    // ----------------------------------------------------

    const unpaidInstitute =
      await createInstitute("UNPAID");

    const unpaidSubscription =
      await createSubscription({
        instituteId:
          unpaidInstitute._id,
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

    // ----------------------------------------------------
    // TEST 4
    // Wrong payment amount
    // ----------------------------------------------------

    const wrongAmountInstitute =
      await createInstitute("WRONG_AMOUNT");

    const wrongAmountSubscription =
      await createSubscription({
        instituteId:
          wrongAmountInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await createPayment({
      instituteId:
        wrongAmountInstitute._id,
      subscriptionId:
        wrongAmountSubscription._id,
      amount: 500,
      currency: "INR",
      status: "VERIFIED",
    });

    /*
     * Current service may expose a weakness here because
     * hasVerifiedPayment() currently checks only VERIFIED
     * status and not payment amount/currency.
     *
     * This test intentionally reveals that condition.
     */
    let wrongAmountBlocked = false;

    try {
      await activateSubscription({
        subscriptionId:
          wrongAmountSubscription._id,
      });

      wrongAmountBlocked = false;
    } catch (error) {
      wrongAmountBlocked = true;
    }

    if (wrongAmountBlocked) {
      pass(
        "Verified payment with wrong amount is blocked"
      );
    } else {
      fail(
        "Verified payment with wrong amount is blocked",
        new Error(
          "Subscription activated using a payment with incorrect amount"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 5
    // Wrong payment currency
    // ----------------------------------------------------

    const wrongCurrencyInstitute =
      await createInstitute("WRONG_CURRENCY");

    const wrongCurrencySubscription =
      await createSubscription({
        instituteId:
          wrongCurrencyInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await createPayment({
      instituteId:
        wrongCurrencyInstitute._id,
      subscriptionId:
        wrongCurrencySubscription._id,
      amount: 999,
      currency: "USD",
      status: "VERIFIED",
    });

    let wrongCurrencyBlocked = false;

    try {
      await activateSubscription({
        subscriptionId:
          wrongCurrencySubscription._id,
      });

      wrongCurrencyBlocked = false;
    } catch (error) {
      wrongCurrencyBlocked = true;
    }

    if (wrongCurrencyBlocked) {
      pass(
        "Verified payment with wrong currency is blocked"
      );
    } else {
      fail(
        "Verified payment with wrong currency is blocked",
        new Error(
          "Subscription activated using incorrect payment currency"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 6
    // Payment for another subscription cannot activate
    // ----------------------------------------------------

    const paymentIsolationInstitute =
      await createInstitute("PAYMENT_ISOLATION");

    const subscriptionOne =
      await createSubscription({
        instituteId:
          paymentIsolationInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    const subscriptionTwo =
      await createSubscription({
        instituteId:
          paymentIsolationInstitute._id,
        plan: "BASIC",
        amount: 999,
        paymentRequired: true,
        durationDays: 30,
      });

    await createPayment({
      instituteId:
        paymentIsolationInstitute._id,
      subscriptionId:
        subscriptionTwo._id,
      amount: 999,
      currency: "INR",
      status: "VERIFIED",
    });

    await expectErrorCode(
      "Payment belonging to another subscription cannot activate target subscription",
      () =>
        activateSubscription({
          subscriptionId:
            subscriptionOne._id,
        }),
      "PAYMENT_NOT_VERIFIED"
    );

    // ----------------------------------------------------
    // TEST 7
    // PENDING -> CANCELLED
    // ----------------------------------------------------

    const cancellationInstitute =
      await createInstitute("CANCEL");

    const cancellableSubscription =
      await createSubscription({
        instituteId:
          cancellationInstitute._id,
      });

    await transitionSubscriptionStatus({
      subscriptionId:
        cancellableSubscription._id,
      targetStatus:
        SUBSCRIPTION_STATUS.CANCELLED,
      reason:
        "Advanced regression cancellation",
    });

    const cancelled =
      await Subscription.findById(
        cancellableSubscription._id
      );

    if (
      cancelled.status ===
        SUBSCRIPTION_STATUS.CANCELLED &&
      cancelled.cancelledAt
    ) {
      pass(
        "PENDING to CANCELLED transition works"
      );
    } else {
      fail(
        "PENDING to CANCELLED transition works",
        new Error(
          "Subscription was not correctly cancelled"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 8
    // CANCELLED -> ACTIVE blocked
    // ----------------------------------------------------

    await expectErrorCode(
      "CANCELLED subscription cannot become ACTIVE",
      () =>
        transitionSubscriptionStatus({
          subscriptionId:
            cancellableSubscription._id,
          targetStatus:
            SUBSCRIPTION_STATUS.ACTIVE,
        }),
      "INVALID_STATUS_TRANSITION"
    );

    // ----------------------------------------------------
    // TEST 9
    // EXPIRED -> ACTIVE blocked
    // ----------------------------------------------------

    const expiredInstitute =
      await createInstitute("EXPIRED");

    const expiredSubscription =
      await createSubscription({
        instituteId:
          expiredInstitute._id,
        status:
          SUBSCRIPTION_STATUS.EXPIRED,
      });

    await expectErrorCode(
      "EXPIRED subscription cannot become ACTIVE",
      () =>
        transitionSubscriptionStatus({
          subscriptionId:
            expiredSubscription._id,
          targetStatus:
            SUBSCRIPTION_STATUS.ACTIVE,
        }),
      "INVALID_STATUS_TRANSITION"
    );

    // ----------------------------------------------------
    // TEST 10
    // ACTIVE -> SUSPENDED -> ACTIVE
    // ----------------------------------------------------

    const lifecycleInstitute =
      await createInstitute("LIFECYCLE");

    const lifecycleSubscription =
      await createSubscription({
        instituteId:
          lifecycleInstitute._id,
      });

    await createPayment({
      instituteId:
        lifecycleInstitute._id,
      subscriptionId:
        lifecycleSubscription._id,
      amount: 999,
      currency: "INR",
      status: "VERIFIED",
    });

    await activateSubscription({
      subscriptionId:
        lifecycleSubscription._id,
    });

    await transitionSubscriptionStatus({
      subscriptionId:
        lifecycleSubscription._id,
      targetStatus:
        SUBSCRIPTION_STATUS.SUSPENDED,
      reason:
        "Advanced regression suspension",
    });

    await transitionSubscriptionStatus({
      subscriptionId:
        lifecycleSubscription._id,
      targetStatus:
        SUBSCRIPTION_STATUS.ACTIVE,
      reason:
        "Advanced regression resume",
    });

    const resumed =
      await Subscription.findById(
        lifecycleSubscription._id
      );

    if (
      resumed.status ===
      SUBSCRIPTION_STATUS.ACTIVE
    ) {
      pass(
        "ACTIVE to SUSPENDED to ACTIVE lifecycle works"
      );
    } else {
      fail(
        "ACTIVE to SUSPENDED to ACTIVE lifecycle works",
        new Error(
          "Subscription did not resume correctly"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 11
    // Invalid plan version
    // ----------------------------------------------------

    const versionInstitute =
      await createInstitute("VERSION");

    const versionSubscription =
      await createSubscription({
        instituteId:
          versionInstitute._id,
      });

      // Intentionally corrupt this test-only fixture through the
      // native collection so activation validation can still be
      // tested independently of the Mongoose snapshot guard.
    await Subscription.collection.updateOne(
      {
        _id:
          versionSubscription._id,
      },
      {
        $set: {
          planVersion: 999,
        },
      }
    );

    await createPayment({
      instituteId:
        versionInstitute._id,
      subscriptionId:
        versionSubscription._id,
      amount: 999,
      currency: "INR",
      status: "VERIFIED",
    });

    await expectErrorCode(
      "Invalid plan version is blocked",
      () =>
        activateSubscription({
          subscriptionId:
            versionSubscription._id,
        }),
      "PLAN_VERSION_MISMATCH"
    );

    // ----------------------------------------------------
    // TEST 12
    // Institute summary synchronization
    // ----------------------------------------------------

    const summaryInstitute =
      await createInstitute("SUMMARY");

    const summarySubscription =
      await createSubscription({
        instituteId:
          summaryInstitute._id,
      });

    await createPayment({
      instituteId:
        summaryInstitute._id,
      subscriptionId:
        summarySubscription._id,
      amount: 999,
      currency: "INR",
      status: "VERIFIED",
    });

    await activateSubscription({
      subscriptionId:
        summarySubscription._id,
    });

    const summary =
      await Institute.findById(
        summaryInstitute._id
      );

    if (
      summary.subscriptionPlan === "BASIC" &&
      summary.subscriptionStatus === "ACTIVE"
    ) {
      pass(
        "Institute subscription summary remains synchronized"
      );
    } else {
      fail(
        "Institute subscription summary remains synchronized",
        new Error(
          `Unexpected summary: ${summary.subscriptionPlan}/${summary.subscriptionStatus}`
        )
      );
    }

    // ----------------------------------------------------
    // TEST 13
    // Effective subscription after expiry
    // ----------------------------------------------------

    const effectiveInstitute =
      await createInstitute("EFFECTIVE_EXPIRY");

    const effectiveSubscription =
      await createSubscription({
        instituteId:
          effectiveInstitute._id,
      });

    await createPayment({
      instituteId:
        effectiveInstitute._id,
      subscriptionId:
        effectiveSubscription._id,
      amount: 999,
      currency: "INR",
      status: "VERIFIED",
    });

    await activateSubscription({
      subscriptionId:
        effectiveSubscription._id,
    });

    // await Subscription.updateOne(
    //   {
    //     _id:
    //       effectiveSubscription._id,
    //   },
    //   {
    //     $set: {
    //       endDate: new Date(
    //         Date.now() - 1000
    //       ),
    //     },
    //   }
    // );
    const expiredStartDate = new Date(
  Date.now() - 2 * 24 * 60 * 60 * 1000
);

const expiredEndDate = new Date(
  Date.now() - 24 * 60 * 60 * 1000
);

await Subscription.updateOne(
  {
    _id:
      effectiveSubscription._id,
  },
  {
    $set: {
      startDate: expiredStartDate,
      endDate: expiredEndDate,
    },
  }
);

    const effective =
      await getEffectiveSubscription(
        effectiveInstitute._id
      );

    if (effective === null) {
      pass(
        "Expired subscription is not treated as effective"
      );
    } else {
      fail(
        "Expired subscription is not treated as effective",
        new Error(
          "Expired subscription was returned as effective"
        )
      );
    }

    // ----------------------------------------------------
    // TEST 14
    // Cross-institute isolation
    // ----------------------------------------------------

    instituteB =
      await createInstitute("ISOLATION_B");

    const subscriptionA =
      await createSubscription({
        instituteId:
          instituteA._id,
      });

    const paymentForB =
      await createPayment({
        instituteId:
          instituteB._id,
        subscriptionId:
          subscriptionA._id,
        amount: 999,
        currency: "INR",
        status: "VERIFIED",
      });

    /*
     * Payment document intentionally references
     * subscription A but belongs to institute B.
     *
     * A production implementation must not accept
     * this inconsistent payment relationship.
     */

    if (paymentForB.instituteId.toString() ===
      instituteB._id.toString()) {
      pass(
        "Cross-institute payment fixture created for isolation test"
      );
    } else {
      fail(
        "Cross-institute payment fixture created for isolation test",
        new Error(
          "Fixture could not be created"
        )
      );
    }

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------

    console.log(
      "\n----------------------------------------"
    );

    const passed =
      results.filter(
        (item) => item.status === "PASS"
      ).length;

    const failed =
      results.filter(
        (item) => item.status === "FAIL"
      ).length;

    console.log(
      `Advanced Subscription Regression: ${passed} PASS / ${failed} FAIL`
    );

    console.log(
      "----------------------------------------\n"
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      "\nADVANCED REGRESSION RUN FAILED:"
    );

    console.error(error);

    process.exitCode = 1;
  } finally {
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

      console.log(
        "Advanced regression test data cleanup completed."
      );
    } catch (cleanupError) {
      console.error(
        "Advanced cleanup failed:",
        cleanupError.message
      );

      process.exitCode = 1;
    }

    await mongoose.disconnect();
  }
};

run();