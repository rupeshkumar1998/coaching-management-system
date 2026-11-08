const mongoose = require("mongoose");

const Subscription = require("../models/Subscription");
const Institute = require("../models/Institute");
const Payment = require("../models/Payment");



const SubscriptionPlan = require("../models/SubscriptionPlan");

const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

const {
  getSubscriptionPlan,
} = require("../constants/subscriptionPlans");

const {
  SUBSCRIPTION_STATUS,
  canTransitionSubscription,
} = require("../constants/subscriptionStatuses");

// ---------------------------------------------------------
// Error helper
// ---------------------------------------------------------

const createSubscriptionError = (
  message,
  code = "SUBSCRIPTION_ERROR"
) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// ObjectId validation
// ---------------------------------------------------------

const validateObjectId = (value, fieldName = "ID") => {
  if (!value || !mongoose.Types.ObjectId.isValid(value)) {
    throw createSubscriptionError(
      `Invalid ${fieldName}`,
      "INVALID_ID"
    );
  }

  return new mongoose.Types.ObjectId(value);
};

// ---------------------------------------------------------
// Get current ACTIVE subscription
// ---------------------------------------------------------

const getCurrentSubscription = async (
  instituteId,
  session = null
) => {
  const validInstituteId = validateObjectId(
    instituteId,
    "institute ID"
  );

  let query = Subscription.findOne({
    instituteId: validInstituteId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
  }).sort({
    startDate: -1,
    createdAt: -1,
  });

  if (session) {
    query = query.session(session);
  }

  return query;
};

// ---------------------------------------------------------
// Effective ACTIVE subscription
//
// ACTIVE alone is not enough.
// Date validity must also be checked.
// ---------------------------------------------------------

const isSubscriptionCurrentlyEffective = (
  subscription,
  now = new Date()
) => {
  if (!subscription) {
    return false;
  }

  if (subscription.status !== SUBSCRIPTION_STATUS.ACTIVE) {
    return false;
  }

  if (
    !subscription.startDate ||
    subscription.startDate > now
  ) {
    return false;
  }

  if (
    subscription.endDate &&
    now >= subscription.endDate
  ) {
    return false;
  }

  return true;
};




const validatePlanSnapshot = async (
  subscription,
  session = null
) => {
  if (!subscription) {
    throw createSubscriptionError(
      "Subscription is required",
      "SUBSCRIPTION_REQUIRED"
    );
  }

  // -------------------------------------------------------
  // DATABASE-BACKED PLAN VERSION
  // -------------------------------------------------------

  if (subscription.planVersionId) {
    let versionQuery = SubscriptionPlanVersion.findById(
      subscription.planVersionId
    );

    if (session) {
      versionQuery = versionQuery.session(session);
    }

    const version = await versionQuery.lean();

    if (!version) {
      throw createSubscriptionError(
        "Referenced subscription plan version was not found",
        "PLAN_VERSION_NOT_FOUND"
      );
    }

    if (!["PUBLISHED", "RETIRED"].includes(version.status)) {
      throw createSubscriptionError(
        "Subscription references a plan version that was never published",
        "INVALID_PLAN_VERSION_STATUS"
      );
    }

    if (version.version !== subscription.planVersion) {
      throw createSubscriptionError(
        "Subscription version does not match its referenced plan version",
        "PLAN_VERSION_MISMATCH"
      );
    }

    let logicalPlanQuery = SubscriptionPlan.findById(
      version.planId
    );

    if (session) {
      logicalPlanQuery = logicalPlanQuery.session(session);
    }

    const logicalPlan = await logicalPlanQuery.lean();

    if (
      !logicalPlan ||
      logicalPlan.code !== subscription.plan
    ) {
      throw createSubscriptionError(
        "Subscription plan does not match its referenced plan version",
        "PLAN_REFERENCE_MISMATCH"
      );
    }

    // Compare entitlement snapshots without depending on array order.
    const normalizeFeatures = (items = []) =>
      items
        .map(({ key, enabled }) => ({
          key: String(key).trim().toUpperCase(),
          enabled,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const normalizeLimits = (items = []) =>
      items
        .map(({ key, value }) => ({
          key: String(key).trim().toUpperCase(),
          value: value ?? null,
        }))
        .sort((a, b) => a.key.localeCompare(b.key));

    if (
      JSON.stringify(normalizeFeatures(subscription.features)) !==
      JSON.stringify(normalizeFeatures(version.features))
    ) {
      throw createSubscriptionError(
        "Subscription feature snapshot does not match its plan version",
        "PLAN_FEATURES_MISMATCH"
      );
    }

    if (
      JSON.stringify(normalizeLimits(subscription.limits)) !==
      JSON.stringify(normalizeLimits(version.limits))
    ) {
      throw createSubscriptionError(
        "Subscription limits snapshot does not match its plan version",
        "PLAN_LIMITS_MISMATCH"
      );
    }

    // -----------------------------------------------------
    // TRIAL: free activation using the selected plan's
    // entitlements, with an independently granted duration.
    // -----------------------------------------------------

    if (subscription.subscriptionType === "TRIAL") {
      if (subscription.amount !== 0) {
        throw createSubscriptionError(
          "Trial subscription amount must be 0",
          "TRIAL_AMOUNT_INVALID"
        );
      }

      if (subscription.currency !== version.currency) {
        throw createSubscriptionError(
          "Trial subscription currency does not match its plan version",
          "PLAN_CURRENCY_MISMATCH"
        );
      }

      if (subscription.paymentRequired) {
        throw createSubscriptionError(
          "Trial subscription cannot require payment",
          "INVALID_TRIAL_PAYMENT_CONFIGURATION"
        );
      }

      if (
        !Number.isSafeInteger(subscription.durationDays) ||
        subscription.durationDays < 1
      ) {
        throw createSubscriptionError(
          "Trial subscription requires a valid duration",
          "TRIAL_DURATION_INVALID"
        );
      }

if (subscription.trialSource === "PLATFORM_OFFER") {
  // Platform trials are granted through a published offer.
  // They do not require a manual Super Admin grantor.

  if (
    !subscription.platformTrialOfferId ||
    !Number.isInteger(subscription.platformTrialOfferVersion) ||
    subscription.platformTrialOfferVersion < 1
  ) {
    throw createSubscriptionError(
      "Platform trial requires a valid offer snapshot",
      "PLATFORM_TRIAL_SNAPSHOT_INVALID"
    );
  }

  if (subscription.trialGrantedBy || subscription.trialReason) {
    throw createSubscriptionError(
      "Platform trial cannot contain manual-grant metadata",
      "PLATFORM_TRIAL_METADATA_INVALID"
    );
  }
} else {
  // Manual grants and legacy trials require a grantor.
  if (!subscription.trialGrantedBy) {
    throw createSubscriptionError(
      "Trial subscription requires trialGrantedBy",
      "TRIAL_GRANTER_REQUIRED"
    );
  }
}

return logicalPlan;
    }

    // -----------------------------------------------------
    // STANDARD: validate against the exact selected version.
    // -----------------------------------------------------

    if (subscription.subscriptionType !== "STANDARD") {
      throw createSubscriptionError(
        "Invalid subscription type",
        "INVALID_SUBSCRIPTION_TYPE"
      );
    }

    if (subscription.amount !== version.amount) {
      throw createSubscriptionError(
        "Subscription amount does not match its plan version",
        "PLAN_AMOUNT_MISMATCH"
      );
    }

    if (subscription.currency !== version.currency) {
      throw createSubscriptionError(
        "Subscription currency does not match its plan version",
        "PLAN_CURRENCY_MISMATCH"
      );
    }

    if (subscription.paymentRequired !== version.paymentRequired) {
      throw createSubscriptionError(
        "Subscription payment requirement does not match its plan version",
        "PAYMENT_REQUIREMENT_MISMATCH"
      );
    }

    if (
      (subscription.durationDays ?? null) !==
      (version.durationDays ?? null)
    ) {
      throw createSubscriptionError(
        "Subscription duration does not match its plan version",
        "PLAN_DURATION_MISMATCH"
      );
    }

    return logicalPlan;
  }

  // =========================================================
  // ⚠️ 32.16.15.13 — LEGACY COMPATIBILITY PATH — DO NOT REMOVE
  //
  // This fallback handles pre-.12 subscriptions that have
  // `planVersionId === null`. They were created before the
  // database-backed plan version architecture.
  //
  // Removing this code would BREAK all legacy subscriptions.
  //
  // Protected by tests:
  //   tests/services/test-legacy-subscription-compatibility.js
  //     (Group B: validatePlanSnapshot Legacy Fallback)
  //
  // See: CHANGELOG.md [32.16.15.13]
  // =========================================================

  // -------------------------------------------------------
  // LEGACY SUBSCRIPTIONS
  // Keep the existing validation for records without
  // planVersionId to preserve backward compatibility.
  // -------------------------------------------------------
  const plan = getSubscriptionPlan(subscription.plan);

  if (!plan) {
    throw createSubscriptionError(
      "Invalid subscription plan",
      "INVALID_PLAN"
    );
  }

  if (subscription.planVersion !== plan.version) {
    throw createSubscriptionError(
      "Subscription plan version does not match current plan configuration",
      "PLAN_VERSION_MISMATCH"
    );
  }

  if (subscription.subscriptionType === "TRIAL") {
    if (subscription.amount !== 0) {
      throw createSubscriptionError(
        "Trial subscription amount must be 0",
        "TRIAL_AMOUNT_INVALID"
      );
    }

    if (subscription.currency !== plan.currency) {
      throw createSubscriptionError(
        "Trial subscription currency does not match plan configuration",
        "PLAN_CURRENCY_MISMATCH"
      );
    }

    if (subscription.paymentRequired) {
      throw createSubscriptionError(
        "Trial subscription cannot require payment",
        "INVALID_TRIAL_PAYMENT_CONFIGURATION"
      );
    }

    if (
      !Number.isSafeInteger(subscription.durationDays) ||
      subscription.durationDays < 1
    ) {
      throw createSubscriptionError(
        "Trial subscription requires a valid duration",
        "TRIAL_DURATION_INVALID"
      );
    }

    if (!subscription.trialGrantedBy) {
      throw createSubscriptionError(
        "Trial subscription requires trialGrantedBy",
        "TRIAL_GRANTER_REQUIRED"
      );
    }

    return plan;
  }

  if (subscription.amount !== plan.amount) {
    throw createSubscriptionError(
      "Subscription amount does not match plan snapshot",
      "PLAN_AMOUNT_MISMATCH"
    );
  }

  if (subscription.currency !== plan.currency) {
    throw createSubscriptionError(
      "Subscription currency does not match plan configuration",
      "PLAN_CURRENCY_MISMATCH"
    );
  }

  if (subscription.paymentRequired !== plan.paymentRequired) {
    throw createSubscriptionError(
      "Subscription payment requirement does not match plan configuration",
      "PAYMENT_REQUIREMENT_MISMATCH"
    );
  }

  return plan;
};

// ---------------------------------------------------------
// Validate lifecycle transition
// ---------------------------------------------------------

const validateSubscriptionTransition = (
  currentStatus,
  targetStatus
) => {
  if (
    !canTransitionSubscription(
      currentStatus,
      targetStatus
    )
  ) {
    throw createSubscriptionError(
      `Invalid subscription transition: ${currentStatus} -> ${targetStatus}`,
      "INVALID_STATUS_TRANSITION"
    );
  }
};

// ---------------------------------------------------------
// Calculate end date
// ---------------------------------------------------------

const calculateEndDate = (
  startDate,
  durationDays
) => {
  if (!durationDays) {
    return null;
  }

  const endDate = new Date(startDate);

  endDate.setUTCDate(
    endDate.getUTCDate() + durationDays
  );

  return endDate;
};

// ---------------------------------------------------------
// Payment verification
//
// IMPORTANT:
// session is used so payment lookup participates in the
// same MongoDB transaction.
// ---------------------------------------------------------

// const hasVerifiedPayment = async (
//   subscriptionId,
//   session = null
// ) => {
//   const validSubscriptionId = validateObjectId(
//     subscriptionId,
//     "subscription ID"
//   );

//   let query = Payment.findOne({
//     subscriptionId: validSubscriptionId,
//     paymentType: "INSTITUTE_SUBSCRIPTION",
//     status: "VERIFIED",
//   }).sort({
//     verifiedAt: -1,
//     createdAt: -1,
//   });

//   if (session) {
//     query = query.session(session);
//   }

//   const payment = await query;

//   return Boolean(payment);
// };

const hasVerifiedPayment = async (
  subscription,
  session = null
) => {
  if (!subscription) {
    throw createSubscriptionError(
      "Subscription is required",
      "SUBSCRIPTION_REQUIRED"
    );
  }

  const validSubscriptionId =
    validateObjectId(
      subscription._id,
      "subscription ID"
    );

  const validInstituteId =
    validateObjectId(
      subscription.instituteId,
      "institute ID"
    );

  let query = Payment.findOne({
    subscriptionId: validSubscriptionId,
    instituteId: validInstituteId,
    paymentType: "INSTITUTE_SUBSCRIPTION",
    status: "VERIFIED",
    amount: subscription.amount,
    currency: subscription.currency,
  }).sort({
    verifiedAt: -1,
    createdAt: -1,
  });

  if (session) {
    query = query.session(session);
  }

  const payment = await query;

  return payment || null;
};


// ---------------------------------------------------------
// Sync denormalized Institute subscription summary
//
// Subscription collection remains source of truth.
// ---------------------------------------------------------

const syncInstituteSubscriptionSummary = async (
  instituteId,
  subscription,
  session = null
) => {
  if (!subscription) {
    throw createSubscriptionError(
      "Subscription is required",
      "SUBSCRIPTION_REQUIRED"
    );
  }

  const validInstituteId = validateObjectId(
    instituteId,
    "institute ID"
  );

  const update = {
    subscriptionPlan: subscription.plan,
    subscriptionStatus: subscription.status,
  };

  let query = Institute.updateOne(
    {
      _id: validInstituteId,
    },
    {
      $set: update,
    }
  );

  if (session) {
    query = query.session(session);
  }

  const result = await query;

  if (result.matchedCount !== 1) {
    throw createSubscriptionError(
      "Institute not found while synchronizing subscription",
      "INSTITUTE_NOT_FOUND"
    );
  }

  return result;
};

// ---------------------------------------------------------
// Activate subscription
// ---------------------------------------------------------

const activateSubscription = async ({
  subscriptionId,
  activatedBy = null,
  session = null,
}) => {
  const validSubscriptionId = validateObjectId(
    subscriptionId,
    "subscription ID"
  );

  const ownSession = !session;

  if (ownSession) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  try {
    const subscription = await Subscription.findOne({
      _id: validSubscriptionId,
    }).session(session);

    if (!subscription) {
      throw createSubscriptionError(
        "Subscription not found",
        "SUBSCRIPTION_NOT_FOUND"
      );
    }

    // -----------------------------------------------------
    // Only PENDING can be activated
    // -----------------------------------------------------

    validateSubscriptionTransition(
      subscription.status,
      SUBSCRIPTION_STATUS.ACTIVE
    );

    // -----------------------------------------------------
    // Validate plan snapshot
    // -----------------------------------------------------

    const plan = await validatePlanSnapshot(
    subscription,
    session
    );

    // -----------------------------------------------------
    // Validate institute
    // -----------------------------------------------------

    const institute = await Institute.findById(
      subscription.instituteId
    ).session(session);

    if (!institute) {
      throw createSubscriptionError(
        "Institute not found",
        "INSTITUTE_NOT_FOUND"
      );
    }

    if (
      institute.approvalStatus !== "APPROVED" ||
      !institute.isActive
    ) {
      throw createSubscriptionError(
        "Institute must be approved and active before subscription activation",
        "INSTITUTE_NOT_ACTIVE"
      );
    }

    // -----------------------------------------------------
    // Subscription must not already have started
    // -----------------------------------------------------

    if (subscription.startDate) {
      throw createSubscriptionError(
        "Subscription has already been started",
        "SUBSCRIPTION_ALREADY_STARTED"
      );
    }

    // -----------------------------------------------------
    // FREE / TRIAL
    // No payment required
    // -----------------------------------------------------

    if (
      subscription.subscriptionType === "TRIAL" &&
      subscription.paymentRequired
    ) {
      throw createSubscriptionError(
        "Trial subscription cannot require payment",
        "INVALID_TRIAL_PAYMENT_CONFIGURATION"
      );
    }

    // -----------------------------------------------------
    // Paid STANDARD subscription
    // -----------------------------------------------------

    if (
      subscription.subscriptionType === "STANDARD" &&
      subscription.paymentRequired
    ) {
      // const paymentVerified =
      //   await hasVerifiedPayment(
      //     subscription._id,
      //     session
      //   );

      // if (!paymentVerified) {
      //   throw createSubscriptionError(
      //     "Verified payment is required before activation",
      //     "PAYMENT_NOT_VERIFIED"
      //   );
      // }
      const verifiedPayment =
  await hasVerifiedPayment(
    subscription,
    session
  );

if (!verifiedPayment) {
  throw createSubscriptionError(
    "A verified payment matching the subscription amount, currency, institute, and subscription is required before activation",
    "PAYMENT_NOT_VERIFIED"
  );
}
    }

    // -----------------------------------------------------
    // Extra application-level protection.
    //
    // Database unique partial index remains the final
    // concurrency protection.
    // -----------------------------------------------------

    const activeSubscription =
      await Subscription.findOne({
        instituteId: subscription.instituteId,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        _id: {
          $ne: subscription._id,
        },
      }).session(session);

    if (activeSubscription) {
      throw createSubscriptionError(
        "Institute already has an active subscription",
        "ACTIVE_SUBSCRIPTION_EXISTS"
      );
    }

    // -----------------------------------------------------
    // Activation dates
    // -----------------------------------------------------

    const now = new Date();

    subscription.status =
      SUBSCRIPTION_STATUS.ACTIVE;

    subscription.startDate = now;

    subscription.endDate =
      calculateEndDate(
        now,
        subscription.durationDays
      );

    subscription.activatedAt = now;

    if (activatedBy) {
      subscription.activatedBy =
        validateObjectId(
          activatedBy,
          "activatedBy user ID"
        );
    }

    await subscription.save({
      session,
    });

    // -----------------------------------------------------
    // Sync Institute summary
    // -----------------------------------------------------

    await syncInstituteSubscriptionSummary(
      subscription.instituteId,
      subscription,
      session
    );

    if (ownSession) {
      await session.commitTransaction();
    }

    return subscription;
  } catch (error) {
    if (ownSession) {
      await session.abortTransaction();
    }

    // MongoDB duplicate-key protection
    if (error?.code === 11000) {
      throw createSubscriptionError(
        "Institute already has an active subscription",
        "ACTIVE_SUBSCRIPTION_EXISTS"
      );
    }

    throw error;
  } finally {
    if (ownSession) {
      await session.endSession();
    }
  }
};

// ---------------------------------------------------------
// Transition subscription status
// ---------------------------------------------------------

const transitionSubscriptionStatus = async ({
  subscriptionId,
  targetStatus,
  reason = "",
  actorId = null,
}) => {
  const validSubscriptionId = validateObjectId(
    subscriptionId,
    "subscription ID"
  );

  if (
    !Object.values(SUBSCRIPTION_STATUS).includes(
      targetStatus
    )
  ) {
    throw createSubscriptionError(
      "Invalid target subscription status",
      "INVALID_TARGET_STATUS"
    );
  }

  const session =
    await mongoose.startSession();

  try {
    session.startTransaction();

    const subscription =
      await Subscription.findOne({
        _id: validSubscriptionId,
      }).session(session);

    if (!subscription) {
      throw createSubscriptionError(
        "Subscription not found",
        "SUBSCRIPTION_NOT_FOUND"
      );
    }

    validateSubscriptionTransition(
      subscription.status,
      targetStatus
    );

    // -----------------------------------------------------
    // SUSPENDED -> ACTIVE
    //
    // Do not reactivate an already expired subscription.
    // -----------------------------------------------------

    if (
      targetStatus === SUBSCRIPTION_STATUS.ACTIVE &&
      subscription.endDate &&
      new Date() >= subscription.endDate
    ) {
      throw createSubscriptionError(
        "Subscription has already expired",
        "SUBSCRIPTION_EXPIRED"
      );
    }

    const now = new Date();

    subscription.status = targetStatus;

    subscription.statusReason =
      typeof reason === "string"
        ? reason.trim()
        : "";

    if (
      targetStatus ===
      SUBSCRIPTION_STATUS.SUSPENDED
    ) {
      subscription.suspendedAt = now;
    }

    if (
      targetStatus ===
      SUBSCRIPTION_STATUS.CANCELLED
    ) {
      subscription.cancelledAt = now;
    }

    if (
      targetStatus ===
      SUBSCRIPTION_STATUS.EXPIRED
    ) {
      subscription.expiredAt = now;
    }

    if (actorId) {
      subscription.statusChangedBy =
        validateObjectId(
          actorId,
          "actor ID"
        );
    }

    await subscription.save({
      session,
    });

    await syncInstituteSubscriptionSummary(
      subscription.instituteId,
      subscription,
      session
    );

    await session.commitTransaction();

    return subscription;
  } catch (error) {
    await session.abortTransaction();

    if (error?.code === 11000) {
      throw createSubscriptionError(
        "Institute already has an active subscription",
        "ACTIVE_SUBSCRIPTION_EXISTS"
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// Expire subscriptions whose endDate has passed
//
// This is useful for scheduled jobs later.
// It can also be called manually.
// ---------------------------------------------------------

const expireSubscriptionIfNeeded = async (
  subscriptionId
) => {
  const validSubscriptionId = validateObjectId(
    subscriptionId,
    "subscription ID"
  );

  const subscription =
    await Subscription.findOne({
      _id: validSubscriptionId,
      status: {
        $in: [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.SUSPENDED,
        ],
      },
    });

  if (!subscription) {
    return null;
  }

  if (
    !subscription.endDate ||
    new Date() < subscription.endDate
  ) {
    return subscription;
  }

  return transitionSubscriptionStatus({
    subscriptionId: subscription._id,
    targetStatus:
      SUBSCRIPTION_STATUS.EXPIRED,
    reason:
      "Subscription period ended",
  });
};

// ---------------------------------------------------------
// Get effective subscription
//
// Defensively checks date validity at request time.
// ---------------------------------------------------------

const getEffectiveSubscription = async (
  instituteId,
  session = null
) => {
  const subscription =
    await getCurrentSubscription(
      instituteId,
      session
    );

  if (!subscription) {
    return null;
  }

  if (
    isSubscriptionCurrentlyEffective(
      subscription
    )
  ) {
    return subscription;
  }

  // If ACTIVE but date expired, attempt lifecycle
  // correction. The request still does not treat it
  // as active until the transition succeeds.
  if (
    subscription.status ===
      SUBSCRIPTION_STATUS.ACTIVE &&
    subscription.endDate &&
    new Date() >= subscription.endDate
  ) {
    if (!session) {
      await expireSubscriptionIfNeeded(
        subscription._id
      );
    }

    return null;
  }

  return null;
};

module.exports = {
  createSubscriptionError,
  validateObjectId,
  getCurrentSubscription,
  isSubscriptionCurrentlyEffective,
  getEffectiveSubscription,
  validatePlanSnapshot,
  validateSubscriptionTransition,
  calculateEndDate,
  hasVerifiedPayment,
  syncInstituteSubscriptionSummary,
  activateSubscription,
  transitionSubscriptionStatus,
  expireSubscriptionIfNeeded,
};