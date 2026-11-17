const { body, param } = require("express-validator");

// =========================================================
// 32.16.16 — Class Validators
// =========================================================

const classIdParam = [
  param("classId")
    .trim()
    .notEmpty()
    .withMessage("Class ID is required")
    .bail()
    .isMongoId()
    .withMessage("Class ID must be a valid Mongo ID"),
];

const classTeacherIdField = body("classTeacherId")
  .optional({ nullable: true })
  .custom((value) => {
    if (value === null) return true;
    if (typeof value !== "string") {
      throw new Error("classTeacherId must be a string or null");
    }
    if (!/^[0-9a-fA-F]{24}$/.test(value)) {
      throw new Error("classTeacherId must be a valid Mongo ID");
    }
    return true;
  });

const capacityField = body("capacity")
  .optional({ nullable: true })
  .custom((value) => {
    if (value === null) return true;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      throw new Error("capacity must be a positive integer or null");
    }
    return true;
  });

const sortOrderField = body("sortOrder")
  .optional()
  .isInt()
  .withMessage("sortOrder must be an integer");

// ---------------------------------------------------------
// 1. Create
// ---------------------------------------------------------

const createClassValidator = [
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
  body("description")
    .optional()
    .isString()
    .withMessage("description must be a string")
    .bail()
    .isLength({ max: 500 })
    .withMessage("description cannot exceed 500 characters"),
  classTeacherIdField,
  capacityField,
  sortOrderField,
];

// ---------------------------------------------------------
// 2. Update
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = [
  "name",
  "description",
  "classTeacherId",
  "capacity",
  "sortOrder",
  "isActive",
];

const updateClassValidator = [
  ...classIdParam,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
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
      throw new Error(`Unsupported fields: ${unknown.join(", ")}`);
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
  body("description")
    .optional()
    .isString()
    .withMessage("description must be a string")
    .bail()
    .isLength({ max: 500 })
    .withMessage("description cannot exceed 500 characters"),
  classTeacherIdField,
  capacityField,
  sortOrderField,
  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),
];

// ---------------------------------------------------------
// 3. Get single (for future use)
// ---------------------------------------------------------

const getClassValidator = [...classIdParam];


const deleteClassValidator = [
  param("classId")
    .trim()
    .notEmpty()
    .bail()
    .isMongoId()
    .withMessage("classId must be a valid Mongo ID"),
  body("reason")
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null) return true;
      if (typeof v !== "string") {
        throw new Error("reason must be a string or null");
      }
      if (v.trim().length > 500) {
        throw new Error("reason cannot exceed 500 characters");
      }
      return true;
    }),
];

module.exports = {
  createClassValidator,
  updateClassValidator,
  getClassValidator,
  deleteClassValidator,
};