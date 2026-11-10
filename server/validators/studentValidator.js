const { body, param, query } = require("express-validator");

// =========================================================
// 32.16.16 Sprint 3 — Student Validators
// =========================================================

const studentIdParam = [
  param("studentId")
    .trim()
    .notEmpty()
    .withMessage("Student ID is required")
    .bail()
    .isMongoId()
    .withMessage("Student ID must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// 1. Create
// ---------------------------------------------------------

const createStudentValidator = [
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
  body("classId")
    .exists()
    .withMessage("classId is required")
    .bail()
    .isMongoId()
    .withMessage("classId must be a valid Mongo ID"),
  body("batchId")
    .exists()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// 2. List
// ---------------------------------------------------------

const listStudentsValidator = [
  query("classId")
    .optional()
    .isMongoId()
    .withMessage("classId must be a valid Mongo ID"),
  query("batchId")
    .optional()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// 3. Get single
// ---------------------------------------------------------

const getStudentValidator = [...studentIdParam];

// ---------------------------------------------------------
// 4. Update
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["name", "phone"];

const updateStudentValidator = [
  ...studentIdParam,
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
      if (trimmed === "") return true; // empty string → null in service
      if (trimmed.length < 7 || trimmed.length > 20) {
        throw new Error("phone must be 7-20 characters");
      }
      return true;
    }),
];

// ---------------------------------------------------------
// 5. Assign batch
// ---------------------------------------------------------

const assignBatchValidator = [
  ...studentIdParam,
  body("batchId")
    .exists()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// 6. Remove batch
// ---------------------------------------------------------

const removeBatchValidator = [...studentIdParam];

module.exports = {
  createStudentValidator,
  listStudentsValidator,
  getStudentValidator,
  updateStudentValidator,
  assignBatchValidator,
  removeBatchValidator,
};