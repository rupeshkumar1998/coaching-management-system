const { body, param } = require("express-validator");

// =========================================================
// 32.16.15.15 — Trial Offer Admin Validators
//
// Express-validator chains for 7 admin endpoints.
// Uses the same patterns as
// validators/subscriptionPlanVersionValidator.js.
//
// Business-level validation (plan existence, version
// published-ness, etc.) lives in the service layer.
// These validators only enforce HTTP-body shape.
// =========================================================

// ---------------------------------------------------------
// Shared field validators
// ---------------------------------------------------------

const offerIdParam = [
  param("offerId")
    .trim()
    .notEmpty()
    .withMessage("Offer ID is required")
    .bail()
    .isMongoId()
    .withMessage("Offer ID must be a valid Mongo ID"),
];

const planIdField = body("planId")
  .exists()
  .withMessage("planId is required")
  .bail()
  .isString()
  .withMessage("planId must be a string")
  .bail()
  .trim()
  .isMongoId()
  .withMessage("planId must be a valid Mongo ID");

const planVersionIdField = body("planVersionId")
  .exists()
  .withMessage("planVersionId is required")
  .bail()
  .isString()
  .withMessage("planVersionId must be a string")
  .bail()
  .trim()
  .isMongoId()
  .withMessage("planVersionId must be a valid Mongo ID");

const durationDaysField = body("durationDays")
  .exists()
  .withMessage("durationDays is required")
  .bail()
  .isInt({ min: 1 })
  .withMessage("durationDays must be a positive integer");

const eligibilityField = body("eligibility")
  .optional()
  .isString()
  .withMessage("eligibility must be a string")
  .bail()
  .isIn(["NEW_INSTITUTES_ONLY"])
  .withMessage("eligibility must be NEW_INSTITUTES_ONLY");

// ---------------------------------------------------------
// 1. Create draft
// ---------------------------------------------------------

const createTrialOfferValidator = [
  planIdField,
  planVersionIdField,
  durationDaysField,
  eligibilityField,
];

// ---------------------------------------------------------
// 2. Update draft
//
// At least one of the allowed fields must be present.
// planId and planVersionId must be supplied together.
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = [
  "planId",
  "planVersionId",
  "durationDays",
  "eligibility",
];

const updateTrialOfferValidator = [
  ...offerIdParam,
  body().custom((value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error("Request body must be an object");
    }

    const keys = Object.keys(value);

    if (keys.length === 0) {
      throw new Error("At least one field is required");
    }

    const unknown = keys.filter(
      (k) => !ALLOWED_UPDATE_FIELDS.includes(k)
    );

    if (unknown.length > 0) {
      throw new Error(
        `Unsupported fields: ${unknown.join(", ")}`
      );
    }

    const hasPlanId = Object.prototype.hasOwnProperty.call(
      value,
      "planId"
    );
    const hasVersionId = Object.prototype.hasOwnProperty.call(
      value,
      "planVersionId"
    );

    if (hasPlanId !== hasVersionId) {
      throw new Error(
        "planId and planVersionId must be provided together"
      );
    }

    return true;
  }),
  body("planId")
    .optional()
    .isString()
    .withMessage("planId must be a string")
    .bail()
    .trim()
    .isMongoId()
    .withMessage("planId must be a valid Mongo ID"),
  body("planVersionId")
    .optional()
    .isString()
    .withMessage("planVersionId must be a string")
    .bail()
    .trim()
    .isMongoId()
    .withMessage("planVersionId must be a valid Mongo ID"),
  body("durationDays")
    .optional()
    .isInt({ min: 1 })
    .withMessage("durationDays must be a positive integer"),
  body("eligibility")
    .optional()
    .isString()
    .withMessage("eligibility must be a string")
    .bail()
    .isIn(["NEW_INSTITUTES_ONLY"])
    .withMessage("eligibility must be NEW_INSTITUTES_ONLY"),
];

// ---------------------------------------------------------
// 3. Publish
// ---------------------------------------------------------

const publishTrialOfferValidator = [...offerIdParam];

// ---------------------------------------------------------
// 4. Toggle enabled
// ---------------------------------------------------------

const toggleTrialOfferValidator = [
  ...offerIdParam,
  body("enabled")
    .exists()
    .withMessage("enabled is required")
    .bail()
    .isBoolean()
    .withMessage("enabled must be a boolean"),
];

// ---------------------------------------------------------
// 5. Retire
// ---------------------------------------------------------

const retireTrialOfferValidator = [...offerIdParam];

module.exports = {
  createTrialOfferValidator,
  updateTrialOfferValidator,
  publishTrialOfferValidator,
  toggleTrialOfferValidator,
  retireTrialOfferValidator,
};