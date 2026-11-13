const { body, param } = require("express-validator");

const {
  bulkMarkValidator,
  listValidator,
  deleteValidator,
  batchSummaryValidator,
} = require("./studentAttendanceValidator");

// =========================================================
// 32.16.17 ΓÇö Teacher Student Attendance Validators
//
// Reuses admin validators where behavior is identical.
// Only PATCH is teacher-specific (remarks only, no status).
// =========================================================

const patchRemarksValidator = [
  param("attendanceId")
    .trim()
    .notEmpty()
    .withMessage("attendanceId is required")
    .bail()
    .isMongoId()
    .withMessage("attendanceId must be a valid Mongo ID"),
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }
    if (Object.prototype.hasOwnProperty.call(value, "status")) {
      throw new Error(
        "Teachers cannot update status directly; delete and re-mark instead"
      );
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      throw new Error("remarks is required");
    }
    const unknown = keys.filter((k) => k !== "remarks");
    if (unknown.length > 0) {
      throw new Error(
        `Only remarks can be updated. Unsupported: ${unknown.join(", ")}`
      );
    }
    return true;
  }),
  body("remarks")
    .exists()
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

module.exports = {
  bulkMarkValidator,
  listValidator,
  patchRemarksValidator,
  deleteValidator,
  batchSummaryValidator,
};