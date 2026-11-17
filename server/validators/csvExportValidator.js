const { query } = require("express-validator");

// =========================================================
// 32.16.19 ΓÇö CSV Export Validators
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
// Students export
// ---------------------------------------------------------

const exportStudentsValidator = [
  query("classId")
    .optional()
    .isMongoId()
    .withMessage("classId must be a valid Mongo ID"),
  query("batchId")
    .optional()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  query("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage("status must be 'active' or 'inactive'"),
];

// ---------------------------------------------------------
// Fees export
// ---------------------------------------------------------

const exportFeesValidator = [
  query("studentId")
    .optional()
    .isMongoId()
    .withMessage("studentId must be a valid Mongo ID"),
  query("batchId")
    .optional()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  query("status")
    .optional()
    .isIn(["PENDING", "PARTIAL", "PAID", "CANCELLED"])
    .withMessage(
      "status must be PENDING|PARTIAL|PAID|CANCELLED"
    ),
  query("cycle").optional().isString().trim().isLength({ max: 20 }),
  query("overdue").optional().isIn(["true", "false"]),
  query("from").optional().isISO8601().withMessage("from must be ISO date"),
  query("to").optional().isISO8601().withMessage("to must be ISO date"),
];

// ---------------------------------------------------------
// Attendance export
// ---------------------------------------------------------

const exportAttendanceValidator = [
  query("batchId")
    .exists()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  query("from")
    .exists()
    .withMessage("from is required")
    .bail()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("from must be YYYY-MM-DD"),
  query("to")
    .exists()
    .withMessage("to is required")
    .bail()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("to must be YYYY-MM-DD"),
  query("status")
    .optional()
    .isIn(ATTENDANCE_STATUSES)
    .withMessage(
      `status must be one of ${ATTENDANCE_STATUSES.join(", ")}`
    ),
];

module.exports = {
  exportStudentsValidator,
  exportFeesValidator,
  exportAttendanceValidator,
};