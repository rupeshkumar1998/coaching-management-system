
const SubscriptionPlan = require("../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

const createPlanLookupError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const getPublishedSubscriptionPlan = async (planCode) => {
  if (typeof planCode !== "string" || !planCode.trim()) {
    throw createPlanLookupError(
      "INVALID_PLAN_CODE",
      "A valid subscription plan code is required"
    );
  }

  const normalizedCode = planCode.trim().toUpperCase();

  const plan = await SubscriptionPlan.findOne({
    code: normalizedCode,
  }).lean();

  if (!plan) {
    throw createPlanLookupError(
      "PLAN_NOT_FOUND",
      `Subscription plan ${normalizedCode} was not found`,
      404
    );
  }

  if (plan.isActive !== true) {
    throw createPlanLookupError(
      "PLAN_INACTIVE",
      `Subscription plan ${normalizedCode} is not available for new subscriptions`,
      409
    );
  }

  if (!plan.currentPublishedVersion) {
    throw createPlanLookupError(
      "PUBLISHED_VERSION_NOT_FOUND",
      `Subscription plan ${normalizedCode} has no current published version`,
      409
    );
  }

  const version = await SubscriptionPlanVersion.findOne({
    _id: plan.currentPublishedVersion,
    planId: plan._id,
    status: "PUBLISHED",
  }).lean();

  if (!version) {
    throw createPlanLookupError(
      "PUBLISHED_VERSION_INCONSISTENT",
      `Subscription plan ${normalizedCode} has an inconsistent published version reference`,
      409
    );
  }

  return {
    plan,
    version,
  };
};

module.exports = {
  getPublishedSubscriptionPlan,
};
