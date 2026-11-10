const {
  getAllLimitStatuses,
} = require("../services/limitService");

// =========================================================
// 32.16.16 Sprint 5B — Subscription Usage Dashboard
//
// Exposes the current usage vs limit status for all plan
// limits for the authenticated institute.
//
// Uses the existing limitService.getAllLimitStatuses() which
// already handles:
//   - Tenant-scoped queries (via instituteId)
//   - Missing / inactive subscription
//   - Not-configured limits (marked as implemented: false)
//   - Unregistered counters (RESOURCE_NOT_IMPLEMENTED)
//   - Corrupted snapshots (fail closed)
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,

  SUBSCRIPTION_INACTIVE: 403,
  ENTITLEMENT_SNAPSHOT_MISSING: 500,
  ENTITLEMENT_CONFIGURATION_INVALID: 500,
  INTERNAL_ERROR: 500,
});

const resolveStatus = (error) => {
  if (error && typeof error.status === "number") return error.status;
  if (error && typeof error.code === "string") {
    return ERROR_STATUS_MAP[error.code] || 500;
  }
  return 500;
};

const handleControllerError = (res, error, operation) => {
  const status = resolveStatus(error);

  if (status === 500) {
    console.error(
      `[subscriptionUsageController] ${operation} failed:`,
      error
    );
  }

  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while fetching subscription usage"
        : error.message,
  });
};

// ---------------------------------------------------------
// GET /api/owner/subscription-usage
//
// Response:
//   {
//     success: true,
//     message: "...",
//     data: {
//       subscription: { id, plan, planVersion, status, endDate },
//       limits: [
//         {
//           limitKey, limit, current, remaining,
//           unlimited, implemented, period, error
//         }
//       ]
//     }
//   }
// ---------------------------------------------------------
const getSubscriptionUsageHandler = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        code: "INSTITUTE_CONTEXT_REQUIRED",
        message: "Verified institute context is required",
      });
    }

    const usage = await getAllLimitStatuses({
      instituteId: req.tenantId,
    });

    return res.status(200).json({
      success: true,
      message: "Subscription usage fetched successfully",
      data: {
        subscription: usage.subscription,
        limits: usage.limits,
      },
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "getSubscriptionUsage"
    );
  }
};

module.exports = {
  getSubscriptionUsageHandler,
};