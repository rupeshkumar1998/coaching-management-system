const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  exportStudentsValidator,
  exportFeesValidator,
  exportAttendanceValidator,
} = require("../validators/csvExportValidator");

const {
  exportStudentsHandler,
  exportFeesHandler,
  exportAttendanceHandler,
} = require("../controllers/csvExportController");

const router = express.Router();

// =========================================================
// 32.16.19 ΓÇö CSV Export Routes
//
// Mounted at /api/owner/reports/export in app.js.
//
// Permission: REPORT_EXPORT
//   - OWNER : automatic (middleware bypass)
//   - ADMIN : explicit REPORT_EXPORT assignment required
//   - others: 403
//
// Response: text/csv with Content-Disposition: attachment
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.get(
  "/students.csv",
  requirePermission("REPORT_EXPORT"),
  exportStudentsValidator,
  validateRequest,
  exportStudentsHandler
);

router.get(
  "/fees.csv",
  requirePermission("REPORT_EXPORT"),
  exportFeesValidator,
  validateRequest,
  exportFeesHandler
);

router.get(
  "/attendance.csv",
  requirePermission("REPORT_EXPORT"),
  exportAttendanceValidator,
  validateRequest,
  exportAttendanceHandler
);

module.exports = router;