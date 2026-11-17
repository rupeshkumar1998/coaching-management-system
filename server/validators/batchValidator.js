const { body, param, query } = require("express-validator");

// =========================================================
// 32.16.16 — Batch Validators
// =========================================================

const VALID_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const batchIdParam = [
  param("batchId")
    .trim()
    .notEmpty()
    .withMessage("Batch ID is required")
    .bail()
    .isMongoId()
    .withMessage("Batch ID must be a valid Mongo ID"),
];

const nameField = body("name")
  .optional()
  .isString()
  .withMessage("name must be a string")
  .bail()
  .trim()
  .isLength({ min: 2, max: 100 })
  .withMessage("name must be 2-100 characters");

const classIdField = body("classId")
  .exists()
  .withMessage("classId is required")
  .bail()
  .isMongoId()
  .withMessage("classId must be a valid Mongo ID");

const teachersField = body("teachers")
  .optional()
  .isArray()
  .withMessage("teachers must be an array");

const scheduleField = body("schedule")
  .optional({ nullable: true })
  .custom((value) => {
    if (value === null) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("schedule must be an object or null");
    }
    const { days, startTime, endTime } = value;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) {
      throw new Error("schedule.days must have 1-7 entries");
    }
    for (const day of days) {
      if (!VALID_DAYS.includes(day)) {
        throw new Error(`Invalid day: ${day}`);
      }
    }
    if (typeof startTime !== "string" || !TIME_REGEX.test(startTime)) {
      throw new Error("schedule.startTime must be HH:MM");
    }
    if (typeof endTime !== "string" || !TIME_REGEX.test(endTime)) {
      throw new Error("schedule.endTime must be HH:MM");
    }
    if (startTime >= endTime) {
      throw new Error("schedule.startTime must be before endTime");
    }
    return true;
  });

const statusField = body("status")
  .optional()
  .isIn(["ACTIVE", "INACTIVE"])
  .withMessage("status must be ACTIVE or INACTIVE");

// ---------------------------------------------------------
// 1. Create
// ---------------------------------------------------------

const createBatchValidator = [
  classIdField,
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
  teachersField,
  scheduleField,
];

// ---------------------------------------------------------
// 2. List
// ---------------------------------------------------------

const listBatchValidator = [
  query("classId")
    .optional()
    .isMongoId()
    .withMessage("classId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// 3. Get single
// ---------------------------------------------------------

const getBatchValidator = [...batchIdParam];

// ---------------------------------------------------------
// 4. Update
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["name", "teachers", "schedule", "status"];

const updateBatchValidator = [
  ...batchIdParam,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }
    if (Object.prototype.hasOwnProperty.call(value, "classId")) {
      throw new Error("classId cannot be changed");
    }
    if (Object.prototype.hasOwnProperty.call(value, "instituteId")) {
      throw new Error("instituteId cannot be changed");
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      throw new Error("At least one field is required");
    }
    const unknown = keys.filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
    if (unknown.length > 0) {
      throw new Error(`Unsupported fields: ${unknown.join(", ")}`);
    }
    return true;
  }),
  nameField,
  teachersField,
  scheduleField,
  statusField,
];

const deleteBatchValidator = [
  param("batchId")
    .trim()
    .notEmpty()
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
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
  createBatchValidator,
  listBatchValidator,
  getBatchValidator,
  updateBatchValidator,
  deleteBatchValidator,
};