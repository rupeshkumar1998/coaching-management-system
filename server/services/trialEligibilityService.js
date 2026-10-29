
const mongoose = require("mongoose");

const Institute = require("../models/Institute");
const Subscription = require("../models/Subscription");
const TrialEligibilityClaim = require("../models/TrialEligibilityClaim");
const PlatformTrialOffer = require("../models/PlatformTrialOffer");
const SubscriptionPlan = require("../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

function createTrialEligibilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateInstituteId(instituteId) {
  if (
    !instituteId ||
    !mongoose.isValidObjectId(instituteId)
  ) {
    throw createTrialEligibilityError(
      "INVALID_INSTITUTE_ID",
      "A valid Institute ID is required to check trial eligibility"
    );
  }
}

function applySession(query, session) {
  return session ? query.session(session) : query;
}

/**
 * Checks whether an Institute may claim the current platform trial.
 *
 * This is an eligibility check only. It does not create a subscription
 * or a lifetime claim. Those records must be created together inside
 * a MongoDB transaction by the registration/grant workflow.
 *
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.instituteId
 * @param {mongoose.ClientSession|null} options.session
 * @returns {Promise<Object>} Eligibility result and immutable snapshots
 */


/**
 * Loads and validates the currently available platform trial configuration.
 *
 * This function does not check Institute history and does not create records.
 * It allows registration to determine the correct plan before creating
 * the Institute. Eligibility is rechecked inside the creation transaction.
 */
async function getAvailableTrialConfiguration({ session = null } = {}) {
  const offerQuery = PlatformTrialOffer.findOne({
    status: "PUBLISHED",
  });

  const offer = await applySession(offerQuery, session);

  if (!offer || offer.enabled !== true) {
    throw createTrialEligibilityError(
      "TRIAL_OFFER_UNAVAILABLE",
      "No enabled published platform trial offer is currently available"
    );
  }

  if (
    !Number.isSafeInteger(offer.version) ||
    offer.version < 1 ||
    !offer.planId ||
    !offer.planVersionId ||
    !Number.isSafeInteger(offer.durationDays) ||
    offer.durationDays < 1 ||
    offer.eligibility !== "NEW_INSTITUTES_ONLY"
  ) {
    throw createTrialEligibilityError(
      "TRIAL_CONFIGURATION_INVALID",
      "The published platform trial offer has an invalid configuration"
    );
  }

  const planQuery = SubscriptionPlan.findById(offer.planId);
  const plan = await applySession(planQuery, session);

  if (!plan || plan.isActive !== true) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The plan attached to the trial offer is unavailable"
    );
  }

  if (
    !plan.currentPublishedVersion ||
    String(plan.currentPublishedVersion) !==
      String(offer.planVersionId)
  ) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The trial offer does not reference the plan's current published version"
    );
  }

  const versionQuery = SubscriptionPlanVersion.findOne({
    _id: offer.planVersionId,
    planId: offer.planId,
    status: "PUBLISHED",
  });

  const planVersion = await applySession(versionQuery, session);

  if (!planVersion) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The trial offer's published plan version could not be verified"
    );
  }

  if (
    planVersion.paymentRequired !== false ||
    planVersion.amount !== 0
  ) {
    throw createTrialEligibilityError(
      "TRIAL_CONFIGURATION_INVALID",
      "The configured trial plan must have zero cost and require no payment"
    );
  }

  return {
    offer: {
      offerId: offer._id,
      version: offer.version,
      planId: offer.planId,
      planVersionId: offer.planVersionId,
      durationDays: offer.durationDays,
      eligibility: offer.eligibility,
    },
    plan: {
      planId: plan._id,
      code: plan.code,
    },
    planVersion: {
      planVersionId: planVersion._id,
      version: planVersion.version,
      amount: planVersion.amount,
      currency: planVersion.currency,
      paymentRequired: planVersion.paymentRequired,
      features: planVersion.features,
      limits: planVersion.limits,
    },
  };
}

async function checkTrialEligibility( {
  instituteId,
  session = null,
} = {}){
  validateInstituteId(instituteId);

  // 1. Verify the Institute exists.
  const instituteQuery = Institute.findById(instituteId).select("_id");
  const institute = await applySession(instituteQuery, session);

  if (!institute) {
    throw createTrialEligibilityError(
      "INSTITUTE_NOT_FOUND",
      "The requested Institute does not exist"
    );
  }

  // 2. A lifetime claim permanently blocks another platform trial.
  const claimQuery = TrialEligibilityClaim.findOne({
    instituteId,
  }).select("_id");

  const existingClaim = await applySession(claimQuery, session);

  if (existingClaim) {
    throw createTrialEligibilityError(
      "TRIAL_ALREADY_USED",
      "This Institute has already used or claimed its lifetime trial"
    );
  }

  // 3. Any subscription history makes the Institute ineligible.
  // Check specific statuses first so callers receive useful error codes.
  const activeQuery = Subscription.findOne({
    instituteId,
    status: "ACTIVE",
  }).select("_id");

  const activeSubscription = await applySession(activeQuery, session);

  if (activeSubscription) {
    throw createTrialEligibilityError(
      "ACTIVE_SUBSCRIPTION_EXISTS",
      "This Institute already has an active subscription"
    );
  }

  const pendingQuery = Subscription.findOne({
    instituteId,
    status: "PENDING",
  }).select("_id");

  const pendingSubscription = await applySession(pendingQuery, session);

  if (pendingSubscription) {
    throw createTrialEligibilityError(
      "PENDING_SUBSCRIPTION_EXISTS",
      "This Institute already has a pending subscription"
    );
  }

  // Includes SUSPENDED, EXPIRED, CANCELLED, and any other historical
  // subscription status represented by a Subscription document.
  const historyQuery = Subscription.findOne({
    instituteId,
  }).select("_id");

  const historicalSubscription = await applySession(
    historyQuery,
    session
  );

  if (historicalSubscription) {
    throw createTrialEligibilityError(
      "SUBSCRIPTION_HISTORY_EXISTS",
      "An Institute with existing subscription history cannot claim a platform trial"
    );
  }

  // 4. Find the current published offer. A disabled offer is not eligible.
  const offerQuery = PlatformTrialOffer.findOne({
    status: "PUBLISHED",
  });

  const offer = await applySession(offerQuery, session);

  if (!offer || offer.enabled !== true) {
    throw createTrialEligibilityError(
      "TRIAL_OFFER_UNAVAILABLE",
      "No enabled published platform trial offer is currently available"
    );
  }

  if (
    !Number.isSafeInteger(offer.version) ||
    offer.version < 1 ||
    !offer.planId ||
    !offer.planVersionId ||
    !Number.isSafeInteger(offer.durationDays) ||
    offer.durationDays < 1 ||
    offer.eligibility !== "NEW_INSTITUTES_ONLY"
  ) {
    throw createTrialEligibilityError(
      "TRIAL_CONFIGURATION_INVALID",
      "The published platform trial offer has an invalid configuration"
    );
  }

  // 5. Verify the plan remains active and points to the exact version
  // selected by the published offer.
  const planQuery = SubscriptionPlan.findById(offer.planId);
  const plan = await applySession(planQuery, session);

  if (!plan || plan.isActive !== true) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The plan attached to the trial offer is unavailable"
    );
  }

  if (
    !plan.currentPublishedVersion ||
    String(plan.currentPublishedVersion) !==
      String(offer.planVersionId)
  ) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The trial offer does not reference the plan's current published version"
    );
  }

  const versionQuery = SubscriptionPlanVersion.findOne({
    _id: offer.planVersionId,
    planId: offer.planId,
    status: "PUBLISHED",
  });

  const planVersion = await applySession(versionQuery, session);

  if (!planVersion) {
    throw createTrialEligibilityError(
      "TRIAL_PLAN_UNAVAILABLE",
      "The trial offer's published plan version could not be verified"
    );
  }

  // A trial plan must not charge the Institute.
  if (
    planVersion.paymentRequired !== false ||
    planVersion.amount !== 0
  ) {
    throw createTrialEligibilityError(
      "TRIAL_CONFIGURATION_INVALID",
      "The configured trial plan must have zero cost and require no payment"
    );
  }

  // Return verified snapshots for the transaction workflow.
  // The caller must still recheck eligibility and create the claim
  // and subscription in the same transaction.
  return {
    eligible: true,
    instituteId: institute._id,
    offer: {
      offerId: offer._id,
      version: offer.version,
      planId: offer.planId,
      planVersionId: offer.planVersionId,
      durationDays: offer.durationDays,
      eligibility: offer.eligibility,
    },
    plan: {
      planId: plan._id,
      code: plan.code,
    },
    planVersion: {
      planVersionId: planVersion._id,
      version: planVersion.version,
      amount: planVersion.amount,
      currency: planVersion.currency,
      paymentRequired: planVersion.paymentRequired,
      features: planVersion.features,
      limits: planVersion.limits,
    },
  };
}

module.exports = {
  createTrialEligibilityError,
  getAvailableTrialConfiguration,
  checkTrialEligibility,
};
