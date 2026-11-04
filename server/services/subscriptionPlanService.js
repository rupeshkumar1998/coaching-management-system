
const mongoose = require("mongoose");

const SubscriptionPlan = require("../models/SubscriptionPlan");

const createServiceError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const validateObjectId = (value, fieldName) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw createServiceError(
      `INVALID_${fieldName.toUpperCase()}`,
      `A valid ${fieldName} is required`
    );
  }
};

const normalizePlanCode = (code) => {
  if (typeof code !== "string" || !code.trim()) {
    throw createServiceError(
      "INVALID_PLAN_CODE",
      "A valid plan code is required"
    );
  }

  const normalized = code.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(normalized)) {
    throw createServiceError(
      "INVALID_PLAN_CODE",
      "Plan code must be 2-50 characters, start with a letter, and contain only letters, numbers, or underscores"
    );
  }

  return normalized;
};

const validatePlanInput = ({ code, name, description = "" }) => {
  const normalizedCode = normalizePlanCode(code);

  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    throw createServiceError(
      "INVALID_PLAN_NAME",
      "Plan name must contain between 2 and 100 characters"
    );
  }

  if (
    typeof description !== "string" ||
    description.length > 1000
  ) {
    throw createServiceError(
      "INVALID_PLAN_DESCRIPTION",
      "Plan description must be a string of at most 1000 characters"
    );
  }

  return {
    code: normalizedCode,
    name: name.trim(),
    description: description.trim(),
  };
};

// --------------------------------------------------
// 1. CREATE LOGICAL SUBSCRIPTION PLAN
// New plans always start INACTIVE.
// --------------------------------------------------

const createSubscriptionPlan = async ({
  code,
  name,
  description = "",
  actorId,
}) => {
  validateObjectId(actorId, "actorId");

  const input = validatePlanInput({
    code,
    name,
    description,
  });

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const existingPlan = await SubscriptionPlan.findOne({
        code: input.code,
      }).session(session);

      if (existingPlan) {
        throw createServiceError(
          "PLAN_CODE_ALREADY_EXISTS",
          "A subscription plan with this code already exists",
          409
        );
      }

      const plan = new SubscriptionPlan({
        ...input,
        isActive: false,
        currentPublishedVersion: null,
        createdBy: actorId,
        updatedBy: actorId,
      });

      await plan.save({ session });

      result = plan;
    });

    return result;
  } catch (error) {
    if (error.code === 11000) {
      throw createServiceError(
        "PLAN_CODE_ALREADY_EXISTS",
        "A subscription plan with this code already exists",
        409
      );
    }

    throw error;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 2. ACTIVATE LOGICAL SUBSCRIPTION PLAN
// A published version is NOT required here.
// --------------------------------------------------

const activateSubscriptionPlan = async ({
  planId,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const plan = await SubscriptionPlan.findById(planId)
        .session(session);

      if (!plan) {
        throw createServiceError(
          "PLAN_NOT_FOUND",
          "Subscription plan not found",
          404
        );
      }

      if (plan.isActive === true) {
        throw createServiceError(
          "PLAN_ALREADY_ACTIVE",
          "Subscription plan is already active",
          409
        );
      }

      plan.isActive = true;
      plan.updatedBy = actorId;

      await plan.save({ session });

      result = plan;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 3. DEACTIVATE LOGICAL SUBSCRIPTION PLAN
// Existing subscriptions remain untouched.
// --------------------------------------------------

const deactivateSubscriptionPlan = async ({
  planId,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const plan = await SubscriptionPlan.findById(planId)
        .session(session);

      if (!plan) {
        throw createServiceError(
          "PLAN_NOT_FOUND",
          "Subscription plan not found",
          404
        );
      }

      if (plan.isActive !== true) {
        throw createServiceError(
          "PLAN_ALREADY_INACTIVE",
          "Subscription plan is already inactive",
          409
        );
      }

      plan.isActive = false;
      plan.updatedBy = actorId;

      await plan.save({ session });

      result = plan;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 4. GET PLAN BY ID
// --------------------------------------------------

const getSubscriptionPlanById = async ({ planId }) => {
  validateObjectId(planId, "planId");

  const plan = await SubscriptionPlan.findById(planId).lean();

  if (!plan) {
    throw createServiceError(
      "PLAN_NOT_FOUND",
      "Subscription plan not found",
      404
    );
  }

  return plan;
};

// --------------------------------------------------
// 5. GET PLAN BY CODE
// --------------------------------------------------

const getSubscriptionPlanByCode = async ({ code }) => {
  const normalizedCode = normalizePlanCode(code);

  const plan = await SubscriptionPlan.findOne({
    code: normalizedCode,
  }).lean();

  if (!plan) {
    throw createServiceError(
      "PLAN_NOT_FOUND",
      "Subscription plan not found",
      404
    );
  }

  return plan;
};

module.exports = {
  createSubscriptionPlan,
  activateSubscriptionPlan,
  deactivateSubscriptionPlan,
  getSubscriptionPlanById,
  getSubscriptionPlanByCode,
};
