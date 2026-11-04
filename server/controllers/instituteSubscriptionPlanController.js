const SubscriptionPlan = require("../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

const {
  getPublishedSubscriptionPlan,
} = require("../services/publishedSubscriptionPlanService");

// ==========================================
// 32.16.15.9.13 — Institute Read-Only Plan Access
//
// Institute Owner / Admin can only READ published plans.
// No create / update / publish / retire is possible here.
// ==========================================

// Remove audit fields and internal identifiers from the
// version payload before sending it to institute users.
const sanitizePlanVersion = (version) => {
  if (!version) {
    return null;
  }

  return {
    version: version.version,
    amount: version.amount,
    currency: version.currency,
    durationDays: version.durationDays,
    paymentRequired: version.paymentRequired,
    features: version.features,
    limits: version.limits,
    publishedAt: version.publishedAt,
  };
};

const sanitizePlan = (plan) => {
  if (!plan) {
    return null;
  }

  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    isActive: plan.isActive,
  };
};

// List all active plans that have a current published version.
const getAvailablePlans = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Verified institute context required",
      });
    }

    const plans = await SubscriptionPlan.find({
      isActive: true,
      currentPublishedVersion: { $ne: null },
    })
      .select("code name description isActive currentPublishedVersion")
      .sort({ name: 1 })
      .lean();

    if (plans.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No available subscription plans",
        count: 0,
        data: { plans: [] },
      });
    }

    const versionIds = plans.map((plan) => plan.currentPublishedVersion);

    const versions = await SubscriptionPlanVersion.find({
      _id: { $in: versionIds },
      status: "PUBLISHED",
    })
      .select(
        "planId version amount currency durationDays paymentRequired features limits publishedAt"
      )
      .lean();

    const versionByPlanId = new Map();
    for (const version of versions) {
      versionByPlanId.set(String(version.planId), version);
    }

    const safePlans = plans
      .map((plan) => {
        const version = versionByPlanId.get(String(plan._id));

        // Skip inconsistent plans whose published version is missing.
        if (!version) {
          return null;
        }

        return {
          plan: sanitizePlan(plan),
          version: sanitizePlanVersion(version),
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      message: "Available subscription plans fetched successfully",
      count: safePlans.length,
      data: { plans: safePlans },
    });
  } catch (error) {
    console.error("Get Available Plans Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch available subscription plans",
    });
  }
};

// Read-only details for a single published plan.
const getPlanDetails = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Verified institute context required",
      });
    }

    const { planCode } = req.params;

    if (typeof planCode !== "string" || !planCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid plan code is required",
      });
    }

    let result;

    try {
      result = await getPublishedSubscriptionPlan(planCode);
    } catch (serviceError) {
      if (serviceError.status === 404) {
        return res.status(404).json({
          success: false,
          message: "Subscription plan not found",
        });
      }

      if (serviceError.status === 409) {
        return res.status(409).json({
          success: false,
          message: "Subscription plan is not available",
        });
      }

      if (serviceError.status === 400) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan code",
        });
      }

      throw serviceError;
    }

    return res.status(200).json({
      success: true,
      message: "Subscription plan fetched successfully",
      data: {
        plan: sanitizePlan(result.plan),
        version: sanitizePlanVersion(result.version),
      },
    });
  } catch (error) {
    console.error("Get Plan Details Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription plan",
    });
  }
};

module.exports = {
  getAvailablePlans,
  getPlanDetails,
};