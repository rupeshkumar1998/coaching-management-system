const {
  createDraftTrialOffer,
  updateDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
  retireTrialOffer,
  getCurrentPublishedTrialOffer,
  listTrialOffers,
} = require("../services/platformTrialOfferService");

// =========================================================
// 32.16.15.15 — Trial Offer Admin Controller
//
// HTTP wrappers for the 7 admin endpoints.
//
// Responsibilities:
//   - Extract body/params
//   - Extract actorId from req.user (set by auth middleware)
//   - Call the appropriate service function
//   - Map service errors to HTTP statuses
//   - Return consistent JSON responses
//
// NOT responsible for:
//   - Business validation (service layer)
//   - Authentication (protect middleware)
//   - Authorization (requireRole middleware)
//   - Request body validation (validator middleware)
// =========================================================

// ---------------------------------------------------------
// Error code → HTTP status map
//
// Any code NOT listed here falls back to 500 (unexpected).
// Codes with an explicit `status` on the error object
// override this map.
// ---------------------------------------------------------
const ERROR_STATUS_MAP = Object.freeze({
  // 400 — bad request
  INVALID_OFFER_ID: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_TRIAL_OFFER_ENABLED_VALUE: 400,
  INVALID_TRIAL_CONFIGURATION: 400,
  EMPTY_TRIAL_CONFIGURATION: 400,
  UNSUPPORTED_TRIAL_CONFIGURATION_FIELDS: 400,
  PLAN_VERSION_SELECTION_INCOMPLETE: 400,
  INVALID_TRIAL_PLAN_ID: 400,
  INVALID_TRIAL_PLAN_VERSION_ID: 400,
  INVALID_TRIAL_DURATION: 400,
  INVALID_TRIAL_ELIGIBILITY: 400,
  OUTDATED_PLAN_VERSION: 400,
  TRIAL_DRAFT_MUST_BE_DISABLED: 400,

  // 404 — not found
  TRIAL_OFFER_NOT_FOUND: 404,
  TRIAL_PLAN_NOT_FOUND: 404,

  // 409 — conflict
  TRIAL_OFFER_NOT_DRAFT: 409,
  TRIAL_OFFER_NOT_PUBLISHED: 409,
  PUBLISHED_TRIAL_OFFER_EXISTS: 409,
  TRIAL_PLAN_INACTIVE: 409,
  TRIAL_PLAN_VERSION_INVALID: 409,
});

const resolveStatus = (error) => {
  if (error && typeof error.status === "number") {
    return error.status;
  }
  if (error && typeof error.code === "string") {
    return ERROR_STATUS_MAP[error.code] || 500;
  }
  return 500;
};

const handleControllerError = (res, error, operation) => {
  const status = resolveStatus(error);

  if (status === 500) {
    console.error(
      `[trialOfferAdminController] ${operation} failed:`,
      error
    );
  }

  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the trial offer"
        : error.message,
  });
};

// ---------------------------------------------------------
// Serialize offer for response
//
// The service returns Mongoose documents OR .lean() objects.
// This helper normalizes to a stable JSON shape.
// ---------------------------------------------------------
const serializeOffer = (offer) => {
  if (!offer) return null;

  return {
    id: String(offer._id),
    version: offer.version,
    status: offer.status,
    enabled: offer.enabled,
    planId: offer.planId ? String(offer.planId) : null,
    planVersionId: offer.planVersionId
      ? String(offer.planVersionId)
      : null,
    durationDays: offer.durationDays,
    eligibility: offer.eligibility,
    publishedAt: offer.publishedAt || null,
    publishedBy: offer.publishedBy
      ? String(offer.publishedBy)
      : null,
    retiredAt: offer.retiredAt || null,
    retiredBy: offer.retiredBy ? String(offer.retiredBy) : null,
    createdBy: offer.createdBy ? String(offer.createdBy) : null,
    updatedBy: offer.updatedBy ? String(offer.updatedBy) : null,
    createdAt: offer.createdAt || null,
    updatedAt: offer.updatedAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/admin/trial-offer
// ---------------------------------------------------------
const createTrialOffer = async (req, res) => {
  try {
    const { planId, planVersionId, durationDays, eligibility } =
      req.body;

    const offer = await createDraftTrialOffer({
      planId,
      planVersionId,
      durationDays,
      eligibility,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Trial offer draft created successfully",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(res, error, "createTrialOffer");
  }
};

// ---------------------------------------------------------
// PATCH /api/admin/trial-offer/:offerId
// ---------------------------------------------------------
const updateTrialOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    // Only forward the keys the validator allowed.
    const configuration = {};
    for (const field of [
      "planId",
      "planVersionId",
      "durationDays",
      "eligibility",
    ]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        configuration[field] = req.body[field];
      }
    }

    const offer = await updateDraftTrialOffer({
      offerId,
      configuration,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Trial offer draft updated successfully",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateTrialOffer");
  }
};

// ---------------------------------------------------------
// POST /api/admin/trial-offer/:offerId/publish
// ---------------------------------------------------------
const publishTrialOfferHandler = async (req, res) => {
  try {
    const { offerId } = req.params;

    const offer = await publishTrialOffer({
      offerId,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Trial offer published successfully",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "publishTrialOffer"
    );
  }
};

// ---------------------------------------------------------
// PATCH /api/admin/trial-offer/:offerId/toggle
// ---------------------------------------------------------
const toggleTrialOffer = async (req, res) => {
  try {
    const { offerId } = req.params;
    const { enabled } = req.body;

    const offer = await setTrialOfferEnabled({
      offerId,
      enabled,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: enabled
        ? "Trial offer enabled successfully"
        : "Trial offer disabled successfully",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(res, error, "toggleTrialOffer");
  }
};

// ---------------------------------------------------------
// POST /api/admin/trial-offer/:offerId/retire
// ---------------------------------------------------------
const retireTrialOfferHandler = async (req, res) => {
  try {
    const { offerId } = req.params;

    const offer = await retireTrialOffer({
      offerId,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Trial offer retired successfully",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "retireTrialOffer"
    );
  }
};

// ---------------------------------------------------------
// GET /api/admin/trial-offer
//
// Returns the currently PUBLISHED offer (or null).
// Missing offer is NOT an error — UI must be able to
// detect "no active trial offer" without an exception.
// ---------------------------------------------------------
const getCurrentTrialOffer = async (req, res) => {
  try {
    const offer = await getCurrentPublishedTrialOffer();

    return res.status(200).json({
      success: true,
      message: offer
        ? "Current trial offer fetched successfully"
        : "No published trial offer currently exists",
      data: { offer: serializeOffer(offer) },
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "getCurrentTrialOffer"
    );
  }
};

// ---------------------------------------------------------
// GET /api/admin/trial-offer/history
// ---------------------------------------------------------
const listTrialOffersHandler = async (req, res) => {
  try {
    const offers = await listTrialOffers();

    return res.status(200).json({
      success: true,
      message: "Trial offer history fetched successfully",
      count: offers.length,
      data: {
        offers: offers.map(serializeOffer),
      },
    });
  } catch (error) {
    return handleControllerError(
      res,
      error,
      "listTrialOffers"
    );
  }
};

module.exports = {
  createTrialOffer,
  updateTrialOffer,
  publishTrialOfferHandler,
  toggleTrialOffer,
  retireTrialOfferHandler,
  getCurrentTrialOffer,
  listTrialOffersHandler,
};