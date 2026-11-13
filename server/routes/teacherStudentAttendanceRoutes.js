const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireTeacherProfile = require("../middleware/requireTeacherProfile");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  bulkMarkValidator,
  listValidator,
  patchRemarksValidator,
  deleteValidator,
  batchSummaryValidator,
} = require("../validators/teacherStudentAttendanceValidator");

const {
  bulkMarkHandler,
  listHandler,
  patchRemarksHandler,
  deleteHandler,
  batchSummaryHandler,
} = require("../controllers/teacherStudentAttendanceController");

const router = express.Router();

// =========================================================
// 32.16.17 ΓÇö Teacher Student Attendance Routes
//
// Mounted at /api/teacher/student-attendance in app.js.
//
// Middleware chain (order matters):
//   protect             ΓåÆ req.user
//   tenantIsolation     ΓåÆ req.tenantId
//   requireTeacherProfile ΓåÆ req.teacher (403 if no profile/inactive)
//   requirePermission   ΓåÆ ATTENDANCE-only (via .17.4 domain guard)
//
// Permission map:
//   ATTENDANCE_MARK    ΓåÆ bulk mark, delete (delete+re-mark workflow)
//   ATTENDANCE_READ    ΓåÆ list, batch summary
//   ATTENDANCE_UPDATE  ΓåÆ patch remarks only
// =========================================================

router.use(protect);
router.use(tenantIsolation);
router.use(requireTeacherProfile);

// Specific routes BEFORE dynamic /:attendanceId

router.post(
  "/bulk",
  requirePermission("ATTENDANCE_MARK"),
  bulkMarkValidator,
  validateRequest,
  bulkMarkHandler
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

router.patch(
  "/:attendanceId",
  requirePermission("ATTENDANCE_UPDATE"),
  patchRemarksValidator,
  validateRequest,
  patchRemarksHandler
);

router.delete(
  "/:attendanceId",
  requirePermission("ATTENDANCE_MARK"),
  deleteValidator,
  validateRequest,
  deleteHandler
);

module.exports = router;