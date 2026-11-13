const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  markValidator,
  bulkMarkValidator,
  listValidator,
  getValidator,
  updateValidator,
  deleteValidator,
  studentSummaryValidator,
  batchSummaryValidator,
} = require("../validators/studentAttendanceValidator");

const {
  markHandler,
  bulkMarkHandler,
  listHandler,
  getHandler,
  updateHandler,
  deleteHandler,
  studentSummaryHandler,
  batchSummaryHandler,
} = require("../controllers/studentAttendanceController");

const router = express.Router();

// =========================================================
// 32.16.17 ΓÇö Student Attendance Routes (Admin/Owner)
//
// Mounted at /api/owner/student-attendance in app.js.
// Permission map:
//   ATTENDANCE_MARK    ΓåÆ mark, bulk
//   ATTENDANCE_READ    ΓåÆ list, get, summaries
//   ATTENDANCE_UPDATE  ΓåÆ patch
//   ATTENDANCE_CORRECT ΓåÆ delete (SENSITIVE)
// =========================================================

router.use(protect);
router.use(requireRole("INSTITUTE_OWNER", "INSTITUTE_ADMIN"));
router.use(tenantIsolation);

// Specific routes BEFORE dynamic /:attendanceId

router.post(
  "/",
  requirePermission("ATTENDANCE_MARK"),
  markValidator,
  validateRequest,
  markHandler
);

router.post(
  "/bulk",
  requirePermission("ATTENDANCE_MARK"),
  bulkMarkValidator,
  validateRequest,
  bulkMarkHandler
);

router.get(
  "/summary/student/:studentId",
  requirePermission("ATTENDANCE_READ"),
  studentSummaryValidator,
  validateRequest,
  studentSummaryHandler
);

router.get(
  "/summary/batch/:batchId",
  requirePermission("ATTENDANCE_READ"),
  batchSummaryValidator,
  validateRequest,
  batchSummaryHandler
);

router.get(
  "/",
  requirePermission("ATTENDANCE_READ"),
  listValidator,
  validateRequest,
  listHandler
);

router.get(
  "/:attendanceId",
  requirePermission("ATTENDANCE_READ"),
  getValidator,
  validateRequest,
  getHandler
);

router.patch(
  "/:attendanceId",
  requirePermission("ATTENDANCE_UPDATE"),
  updateValidator,
  validateRequest,
  updateHandler
);

router.delete(
  "/:attendanceId",
  requirePermission("ATTENDANCE_CORRECT"),
  deleteValidator,
  validateRequest,
  deleteHandler
);

module.exports = router;