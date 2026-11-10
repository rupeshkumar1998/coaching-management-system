const { body, param } = require("express-validator");

// =========================================================
// 32.16.16 Sprint 4C — Parent Validators
// =========================================================

const parentIdParam = [
  param("parentId")
    .trim()
    .notEmpty()
    .withMessage("Parent ID is required")
    .bail()
    .isMongoId()
    .withMessage("Parent ID must be a valid Mongo ID"),
];

const createParentValidator = [
  body("name")
    .exists()
    .withMessage("name is required")
    .bail()
    .isString()
    .withMessage("name must be a string")
    .bail()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("name must be 2-100 characters"),
  body("email")
    .exists()
    .withMessage("email is required")
    .bail()
    .isString()
    .withMessage("email must be a string")
    .bail()
    .trim()
    .isEmail()
    .withMessage("email must be a valid email")
    .bail()
    .normalizeEmail(),
  body("phone")
    .optional({ nullable: true })
    .isString()
    .withMessage("phone must be a string")
    .bail()
    .trim()
    .isLength({ min: 7, max: 20 })
    .withMessage("phone must be 7-20 characters"),
  body("password")
    .exists()
    .withMessage("password is required")
    .bail()
    .isString()
    .withMessage("password must be a string")
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage("password must be 8-128 characters"),
];

const listParentsValidator = [];

const getParentValidator = [...parentIdParam];

const ALLOWED_UPDATE_FIELDS = ["name", "phone"];

const updateParentValidator = [
  ...parentIdParam,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      throw new Error("At least one field is required");
    }
    const unknown = keys.filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `Only name and phone can be updated. Unsupported: ${unknown.join(", ")}`
      );
    }
    return true;
  }),
  body("name")
    .optional()
    .isString()
    .withMessage("name must be a string")
    .bail()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("name must be 2-100 characters"),
  body("phone")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (typeof value !== "string") {
        throw new Error("phone must be a string or null");
      }
      const trimmed = value.trim();
      if (trimmed === "") return true;
      if (trimmed.length < 7 || trimmed.length > 20) {
        throw new Error("phone must be 7-20 characters");
      }
      return true;
    }),
];

module.exports = {
  createParentValidator,
  listParentsValidator,
  getParentValidator,
  updateParentValidator,
};