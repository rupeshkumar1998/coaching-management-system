const { body, param, query } = require("express-validator");

// =========================================================
// 32.16.17 ΓÇö Student Attendance Validators
// =========================================================

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "HALF_DAY",
];

// ---------------------------------------------------------
// Param validators
// ---------------------------------------------------------

const attendanceIdParam = [
  param("attendanceId")
    .trim()
    .notEmpty()
    .withMessage("attendanceId is required")
    .bail()
    .isMongoId()
    .withMessage("attendanceId must be a valid Mongo ID"),
];

const studentIdParam = [
  param("studentId")
    .trim()
    .notEmpty()
    .withMessage("studentId is required")
    .bail()
    .isMongoId()
    .withMessage("studentId must be a valid Mongo ID"),
];

const batchIdParam = [
  param("batchId")
    .trim()
    .notEmpty()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// Reusable field chains
// ---------------------------------------------------------

const attendanceDateField = body("attendanceDate")
  .exists()
  .withMessage("attendanceDate is required")
  .bail()
  .isString()
  .withMessage("attendanceDate must be a string")
  .bail()
  .matches(DATE_ONLY_PATTERN)
  .withMessage("attendanceDate must be YYYY-MM-DD");

const statusField = body("status")
  .exists()
  .withMessage("status is required")
  .bail()
  .isString()
  .withMessage("status must be a string")
  .bail()
  .isIn(ATTENDANCE_STATUSES)
  .withMessage(`status must be one of ${ATTENDANCE_STATUSES.join(", ")}`);

const remarksField = body("remarks")
  .optional({ nullable: true })
  .custom((value) => {
    if (value === null) return true;
    if (typeof value !== "string") {
      throw new Error("remarks must be a string or null");
    }
    if (value.trim().length > 500) {
      throw new Error("remarks cannot exceed 500 characters");
    }
    return true;
  });

// ---------------------------------------------------------
// 1. Mark single
// ---------------------------------------------------------

const markValidator = [
  body("studentId")
    .exists()
    .withMessage("studentId is required")
    .bail()
    .isMongoId()
    .withMessage("studentId must be a valid Mongo ID"),
  statusField,
  attendanceDateField,
  remarksField,
];

// ---------------------------------------------------------
// 2. Bulk mark
// ---------------------------------------------------------

const bulkMarkValidator = [
  body("batchId")
    .exists()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  attendanceDateField,
  body("entries")
    .exists()
    .withMessage("entries is required")
    .bail()
    .isArray({ min: 1 })
    .withMessage("entries must be a non-empty array"),
  body("entries.*.studentId")
    .exists()
    .withMessage("entries[].studentId is required")
    .bail()
    .isMongoId()
    .withMessage("entries[].studentId must be a valid Mongo ID"),
  body("entries.*.status")
    .exists()
    .withMessage("entries[].status is required")
    .bail()
    .isIn(ATTENDANCE_STATUSES)
    .withMessage(
      `entries[].status must be one of ${ATTENDANCE_STATUSES.join(", ")}`
    ),
  body("entries.*.remarks")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (typeof value !== "string") {
        throw new Error("entries[].remarks must be a string or null");
      }
      if (value.trim().length > 500) {
        throw new Error("entries[].remarks cannot exceed 500 characters");
      }
      return true;
    }),
];

// ---------------------------------------------------------
// 3. List (query)
// ---------------------------------------------------------

const listValidator = [
  query("studentId")
    .optional()
    .isMongoId()
    .withMessage("studentId must be a valid Mongo ID"),
  query("batchId")
    .optional()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  query("from")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("from must be YYYY-MM-DD"),
  query("to")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("to must be YYYY-MM-DD"),
  query("status")
    .optional()
    .isIn(ATTENDANCE_STATUSES)
    .withMessage(
      `status must be one of ${ATTENDANCE_STATUSES.join(", ")}`
    ),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page must be >= 1"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit must be 1-200"),
];

// ---------------------------------------------------------
// 4. Get single
// ---------------------------------------------------------

const getValidator = [...attendanceIdParam];

// ---------------------------------------------------------
// 5. Update
// ---------------------------------------------------------

const UPDATE_FIELDS = ["status", "remarks"];

const updateValidator = [
  ...attendanceIdParam,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      throw new Error("At least one field is required");
    }
    const unknown = keys.filter((k) => !UPDATE_FIELDS.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `Only status and remarks can be updated. Unsupported: ${unknown.join(", ")}`
      );
    }
    return true;
  }),
  body("status")
    .optional()
    .isIn(ATTENDANCE_STATUSES)
    .withMessage(
      `status must be one of ${ATTENDANCE_STATUSES.join(", ")}`
    ),
  body("remarks")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (typeof value !== "string") {
        throw new Error("remarks must be a string or null");
      }
      if (value.trim().length > 500) {
        throw new Error("remarks cannot exceed 500 characters");
      }
      return true;
    }),
];

// ---------------------------------------------------------
// 6. Delete
// ---------------------------------------------------------

const deleteValidator = [
  ...attendanceIdParam,
  body("reason")
    .optional({ nullable: true })
    .custom((value) => {
      if (value === null) return true;
      if (typeof value !== "string") {
        throw new Error("reason must be a string or null");
      }
      if (value.trim().length > 500) {
        throw new Error("reason cannot exceed 500 characters");
      }
      return true;
    }),
];

// ---------------------------------------------------------
// 7. Student summary
// ---------------------------------------------------------

const studentSummaryValidator = [
  ...studentIdParam,
  query("from")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("from must be YYYY-MM-DD"),
  query("to")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("to must be YYYY-MM-DD"),
];

// ---------------------------------------------------------
// 8. Batch summary
// ---------------------------------------------------------

const batchSummaryValidator = [
  ...batchIdParam,
  query("date")
    .exists()
    .withMessage("date is required")
    .bail()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("date must be YYYY-MM-DD"),
];

module.exports = {
  markValidator,
  bulkMarkValidator,
  listValidator,
  getValidator,
  updateValidator,
  deleteValidator,
  studentSummaryValidator,
  batchSummaryValidator,
};