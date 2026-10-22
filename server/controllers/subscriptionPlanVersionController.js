
const subscriptionPlanVersionService = require("../services/subscriptionPlanVersionService");

const getErrorStatus = (error) => {
  if (error.code === 11000) {
    return 409;
  }

  if (
    error.name === "ValidationError" ||
    error.name === "CastError"
  ) {
    return 400;
  }

  const message = error.message || "";

  if (
    message.includes("not found") ||
    message.includes("not exist")
  ) {
    return 404;
  }

  if (
    message.includes("Only DRAFT versions") ||
    message.includes("Current published version pointer is inconsistent") ||
    message.includes("Version is not the plan's current published version") ||
    message.includes("Published version not found")
  ) {
    return 409;
  }

  if (
    message.includes("required") ||
    message.includes("Invalid ") ||
    message.includes("Valid ") ||
    message.includes("must be") ||
    message.includes("Unsupported configuration fields") ||
    message.includes("Duration") ||
    message.includes("Amount") ||
    message.includes("Currency") ||
    message.includes("Features") ||
    message.includes("Limits") ||
    message.includes("Unknown feature") ||
    message.includes("Unknown limit")
  ) {
    return 400;
  }

  return 500;
};

const handleControllerError = (res, error, operation) => {
  const status = getErrorStatus(error);

  if (status === 500) {
    console.error(
      `[SubscriptionPlanVersionController] ${operation} failed:`,
      error
    );
  }

  return res.status(status).json({
    success: false,
    message:
      status === 500
        ? "An unexpected error occurred while processing the subscription plan version"
        : error.message,
  });
};

// POST /api/admin/subscription-plans/:planId/versions
const createDraftPlanVersion = async (req, res) => {
  try {
    const result =
      await subscriptionPlanVersionService.createDraftPlanVersion({
        planId: req.params.planId,
        configuration: req.body.configuration,
        actorId: req.user._id,
      });

    return res.status(201).json({
      success: true,
      message: "Draft subscription plan version created successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "createDraftPlanVersion"
    );
  }
};

// PATCH /api/admin/subscription-plans/:planId/versions/:versionId
const updateDraftPlanVersion = async (req, res) => {
  try {
    const result =
      await subscriptionPlanVersionService.updateDraftPlanVersion({
        planId: req.params.planId,
        versionId: req.params.versionId,
        configuration: req.body.configuration,
        actorId: req.user._id,
      });

    return res.status(200).json({
      success: true,
      message: "Draft subscription plan version updated successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "updateDraftPlanVersion"
    );
  }
};

// POST /api/admin/subscription-plans/:planId/versions/:versionId/publish
const publishPlanVersion = async (req, res) => {
  try {
    const result =
      await subscriptionPlanVersionService.publishPlanVersion({
        planId: req.params.planId,
        versionId: req.params.versionId,
        actorId: req.user._id,
      });

    return res.status(200).json({
      success: true,
      message: "Subscription plan version published successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "publishPlanVersion"
    );
  }
};

// POST /api/admin/subscription-plans/:planId/versions/:versionId/retire
const retirePublishedPlanVersion = async (req, res) => {
  try {
    const result =
      await subscriptionPlanVersionService.retirePublishedPlanVersion({
        planId: req.params.planId,
        versionId: req.params.versionId,
        actorId: req.user._id,
      });

    return res.status(200).json({
      success: true,
      message: "Subscription plan version retired successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "retirePublishedPlanVersion"
    );
  }
};

module.exports = {
  createDraftPlanVersion,
  updateDraftPlanVersion,
  publishPlanVersion,
  retirePublishedPlanVersion,
};
