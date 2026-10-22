
const { body, param } = require("express-validator");

const ALLOWED_CONFIGURATION_FIELDS = [
  "amount",
  "currency",
  "durationDays",
  "paymentRequired",
  "features",
  "limits",
];

const validateConfiguration = ({ requireAmount = false } = {}) => [
  body("configuration")
    .exists()
    .withMessage("Configuration is required")
    .bail()
    .isObject()
    .withMessage("Configuration must be an object")
    .bail()
    .custom((configuration) => {
      const keys = Object.keys(configuration);

      if (keys.length === 0) {
        throw new Error("Configuration cannot be empty");
      }

      const unknownFields = keys.filter(
        (key) => !ALLOWED_CONFIGURATION_FIELDS.includes(key)
      );

      if (unknownFields.length > 0) {
        throw new Error(
          `Unsupported configuration fields: ${unknownFields.join(", ")}`
        );
      }

      if (requireAmount && !Object.hasOwn(configuration, "amount")) {
        throw new Error("Amount is required when creating a draft");
      }

      if (
        Object.hasOwn(configuration, "amount") &&
        (
          typeof configuration.amount !== "number" ||
          !Number.isFinite(configuration.amount) ||
          configuration.amount < 0
        )
      ) {
        throw new Error("Amount must be a non-negative number");
      }

      if (
        Object.hasOwn(configuration, "currency") &&
        (
          typeof configuration.currency !== "string" ||
          !/^[A-Z]{3}$/.test(configuration.currency)
        )
      ) {
        throw new Error(
          "Currency must be a 3-letter uppercase code, such as INR"
        );
      }

      if (
        Object.hasOwn(configuration, "durationDays") &&
        configuration.durationDays !== null &&
        (
          !Number.isInteger(configuration.durationDays) ||
          configuration.durationDays <= 0
        )
      ) {
        throw new Error(
          "Duration must be a positive integer or null"
        );
      }

      if (
        Object.hasOwn(configuration, "paymentRequired") &&
        typeof configuration.paymentRequired !== "boolean"
      ) {
        throw new Error("paymentRequired must be a boolean");
      }

      if (
        Object.hasOwn(configuration, "features") &&
        !Array.isArray(configuration.features)
      ) {
        throw new Error("Features must be an array");
      }

      if (
        Object.hasOwn(configuration, "limits") &&
        !Array.isArray(configuration.limits)
      ) {
        throw new Error("Limits must be an array");
      }

      return true;
    }),
];

const planIdValidator = [
  param("planId")
    .trim()
    .notEmpty()
    .withMessage("Plan ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid plan ID"),
];

const versionIdValidator = [
  param("versionId")
    .trim()
    .notEmpty()
    .withMessage("Version ID is required")
    .bail()
    .isMongoId()
    .withMessage("Invalid version ID"),
];

const createDraftPlanVersionValidator = [
  ...planIdValidator,
  ...validateConfiguration({ requireAmount: true }),
];

const updateDraftPlanVersionValidator = [
  ...planIdValidator,
  ...versionIdValidator,
  ...validateConfiguration(),
];

const publishPlanVersionValidator = [
  ...planIdValidator,
  ...versionIdValidator,
];

const retirePlanVersionValidator = [
  ...planIdValidator,
  ...versionIdValidator,
];

module.exports = {
  createDraftPlanVersionValidator,
  updateDraftPlanVersionValidator,
  publishPlanVersionValidator,
  retirePlanVersionValidator,
};
