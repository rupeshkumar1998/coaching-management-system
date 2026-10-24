
const mongoose = require("mongoose");

const SubscriptionPlan = require("../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

const createValidationError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const validateDraftTrialOfferConfiguration = async ({
  planId,
  planVersionId,
  durationDays,
  eligibility,
  enabled = false,
}) => {
  if (
    typeof planId !== "string" ||
    !mongoose.isValidObjectId(planId)
  ) {
    throw createValidationError(
      "INVALID_TRIAL_PLAN_ID",
      "A valid subscription plan ID is required"
    );
  }

  if (
    typeof planVersionId !== "string" ||
    !mongoose.isValidObjectId(planVersionId)
  ) {
    throw createValidationError(
      "INVALID_TRIAL_PLAN_VERSION_ID",
      "A valid subscription plan version ID is required"
    );
  }

  if (
    !Number.isSafeInteger(durationDays) ||
    durationDays < 1
  ) {
    throw createValidationError(
      "INVALID_TRIAL_DURATION",
      "Trial duration must be a positive safe integer"
    );
  }

  if (eligibility !== "NEW_INSTITUTES_ONLY") {
    throw createValidationError(
      "INVALID_TRIAL_ELIGIBILITY",
      "Eligibility must be NEW_INSTITUTES_ONLY"
    );
  }

  if (enabled !== false) {
    throw createValidationError(
      "TRIAL_DRAFT_MUST_BE_DISABLED",
      "A draft trial offer must remain disabled"
    );
  }

  const normalizedPlanId = new mongoose.Types.ObjectId(planId);
  const normalizedVersionId = new mongoose.Types.ObjectId(
    planVersionId
  );

  const plan = await SubscriptionPlan.findById(
    normalizedPlanId
  ).lean();

  if (!plan) {
    throw createValidationError(
      "TRIAL_PLAN_NOT_FOUND",
      "The selected subscription plan was not found",
      404
    );
  }

  if (plan.isActive !== true) {
    throw createValidationError(
      "TRIAL_PLAN_INACTIVE",
      "The selected subscription plan is inactive",
      409
    );
  }

if (!plan.currentPublishedVersion) {
  throw createValidationError(
    "OUTDATED_PLAN_VERSION",
    "The selected version is no longer current. Select the latest published version.",
    400
  );
}

if (
  String(plan.currentPublishedVersion) !==
  String(normalizedVersionId)
) {
  throw createValidationError(
    "OUTDATED_PLAN_VERSION",
    "The selected version is outdated. Select the latest published version.",
    400
  );
}

  const planVersion = await SubscriptionPlanVersion.findOne({
    _id: normalizedVersionId,
    planId: normalizedPlanId,
    status: "PUBLISHED",
  }).lean();

  if (
    !planVersion ||
    String(planVersion._id) !== String(normalizedVersionId) ||
    String(planVersion.planId) !== String(normalizedPlanId) ||
    planVersion.status !== "PUBLISHED"
  ) {
    throw createValidationError(
      "TRIAL_PLAN_VERSION_INVALID",
      "The selected version must be published and belong to the selected plan",
      409
    );
  }

  return {
    plan,
    planVersion,
    configuration: {
      planId: plan._id,
      planVersionId: planVersion._id,
      durationDays,
      eligibility,
      enabled: false,
    },
  };
};

module.exports = {
  validateDraftTrialOfferConfiguration,
};
