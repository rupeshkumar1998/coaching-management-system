
const mongoose = require("mongoose");

const Subscription = require("../models/Subscription");
const TrialEligibilityClaim = require("../models/TrialEligibilityClaim");

const {
  createTrialEligibilityError,
  checkTrialEligibility,
} = require("./trialEligibilityService");

function validateInstituteId(instituteId) {
  if (!instituteId || !mongoose.isValidObjectId(instituteId)) {
    throw createTrialEligibilityError(
      "INVALID_INSTITUTE_ID",
      "A valid Institute ID is required to create a platform trial"
    );
  }
}

function cloneSnapshotArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    if (item && typeof item.toObject === "function") {
      return item.toObject();
    }

    return { ...item };
  });
}

function isLifetimeClaimDuplicate(error) {
  if (error?.code !== 11000) {
    return false;
  }

  const message = String(error.message || "");

  return (
    message.includes("unique_lifetime_trial_claim_per_institute") ||
    error.keyPattern?.instituteId === 1
  );
}

/**
 * Creates a PENDING platform-trial subscription and its lifetime claim
 * within a caller-owned MongoDB transaction.
 *
 * The caller must create the Institute in the same transaction if it is
 * a new Institute. No approval, activation, dates, or payment are handled
 * by this function.
 */
async function createPlatformTrialSubscriptionInTransaction({
  instituteId,
  session,
} = {}) {
  validateInstituteId(instituteId);

  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    !session.inTransaction()
  ) {
    throw createTrialEligibilityError(
      "ACTIVE_TRANSACTION_REQUIRED",
      "An active MongoDB transaction is required"
    );
  }

  const eligibility = await checkTrialEligibility({
    instituteId,
    session,
  });

  const planCode = String(eligibility.plan.code || "").toUpperCase();

  const subscription = new Subscription({
    instituteId: eligibility.instituteId,
    subscriptionType: "TRIAL",
    plan: planCode,

    // Snapshot the exact published plan configuration.
    planVersion: eligibility.planVersion.version,
    planVersionId: eligibility.planVersion.planVersionId,

    amount: 0,
    currency: eligibility.planVersion.currency,
    paymentRequired: false,
    durationDays: eligibility.offer.durationDays,

    features: cloneSnapshotArray(
      eligibility.planVersion.features
    ),
    limits: cloneSnapshotArray(
      eligibility.planVersion.limits
    ),

    status: "PENDING",

    // Trial time starts only after approval and activation.
    startDate: null,
    endDate: null,
    activatedAt: null,
    activatedBy: null,

    autoRenew: false,

    trialSource: "PLATFORM_OFFER",
    platformTrialOfferId: eligibility.offer.offerId,
    platformTrialOfferVersion: eligibility.offer.version,
    trialGrantedBy: null,
    trialReason: null,
  });

  // First write: pending subscription.
  await subscription.save({ session });

  const claim = new TrialEligibilityClaim({
    instituteId: eligibility.instituteId,
    subscriptionId: subscription._id,
    source: "PLATFORM_OFFER",

    platformTrialOfferId: eligibility.offer.offerId,
    platformTrialOfferVersion: eligibility.offer.version,

    planId: eligibility.plan.planId,
    planVersionId: eligibility.planVersion.planVersionId,
    planVersion: eligibility.planVersion.version,

    trialGrantedBy: null,
    trialReason: null,
    claimedAt: new Date(),
  });

  // Second write: permanent lifetime claim.
  // If this write fails, the caller's transaction must abort,
  // rolling back the subscription as well.
  await claim.save({ session });

  return {
    subscription,
    claim,
    eligibility,
  };
}

/**
 * Standalone entry point for workflows where the Institute already
 * exists and is committed. Both trial records are created atomically.
 */
async function createPlatformTrialSubscription({
  instituteId,
} = {}) {
  validateInstituteId(instituteId);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(
      async () => {
        result = await createPlatformTrialSubscriptionInTransaction({
          instituteId,
          session,
        });
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );

    if (!result) {
      throw createTrialEligibilityError(
        "TRIAL_CREATION_FAILED",
        "The platform trial transaction did not produce a result"
      );
    }

    return result;
  } catch (error) {
    if (isLifetimeClaimDuplicate(error)) {
      throw createTrialEligibilityError(
        "TRIAL_ALREADY_USED",
        "This Institute has already claimed its lifetime trial"
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  createPlatformTrialSubscription,
  createPlatformTrialSubscriptionInTransaction,
};
