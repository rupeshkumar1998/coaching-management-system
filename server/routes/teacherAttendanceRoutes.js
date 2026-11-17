const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const {
  markTeacherAttendance,
  getTeacherAttendance,
  getAttendanceByTeacher,
  getAttendanceByDate,
  updateTeacherAttendance,
  deleteTeacherAttendance,
  getTeacherAttendanceSummary,
} = require("../controllers/teacherAttendanceController");

const router = express.Router();

// =========================================================
// 32.16.19 ΓÇö Teacher Attendance Routes (permission-guarded)
//
// Mounted at /api/admin/teacher-attendance in app.js.
//
// Middleware chain:
//   protect            ΓåÆ req.user
//   tenantIsolation    ΓåÆ req.tenantId
//   requirePermission  ΓåÆ OWNER bypass; ADMIN requires assignment;
//                        TEACHER blocked by ATTENDANCE-only guard (but
//                        these are admin routes, not teacher self-service
//                        routes); STUDENT/PARENT blocked
//
// Permission map:
//   ATTENDANCE_MARK     ΓåÆ mark
//   ATTENDANCE_READ     ΓåÆ list, get by teacher, get by date, summary
//   ATTENDANCE_UPDATE   ΓåÆ patch (status/remarks edits)
//   ATTENDANCE_CORRECT  ΓåÆ soft delete (SENSITIVE ΓÇö historical corrections)
// =========================================================

router.use(protect);
router.use(tenantIsolation);

// POST mark
router.post(
  "/",
  requirePermission("ATTENDANCE_MARK"),
  markTeacherAttendance
);

// GET list (with filters)
router.get(
  "/",
  requirePermission("ATTENDANCE_READ"),
  getTeacherAttendance
);

// GET summary for one teacher
router.get(
  "/teacher/:teacherId/summary",
  requirePermission("ATTENDANCE_READ"),
  getTeacherAttendanceSummary
);

// GET all attendance of one teacher
router.get(
  "/teacher/:teacherId",
  requirePermission("ATTENDANCE_READ"),
  getAttendanceByTeacher
);

// GET by date
router.get(
  "/date/:date",
  requirePermission("ATTENDANCE_READ"),
  getAttendanceByDate
);

// PATCH update (status / remarks)
router.patch(
  "/:attendanceId",
  requirePermission("ATTENDANCE_UPDATE"),
  updateTeacherAttendance
);

// DELETE soft (SENSITIVE ΓÇö corrections)
router.delete(
  "/:attendanceId",
  requirePermission("ATTENDANCE_CORRECT"),
  deleteTeacherAttendance
);

module.exports = router;