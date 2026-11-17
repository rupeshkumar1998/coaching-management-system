const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const {
  createTeacher,
  getTeachers,
  getTeacherById,
  updateTeacher,
  toggleTeacherStatus,
  deleteTeacher,
  resetTeacherPassword,
} = require("../controllers/adminTeacherController");

const router = express.Router();

// =========================================================
// 32.16.19 ΓÇö Admin Teacher Routes (permission-guarded)
//
// Mounted at /api/admin/teachers in app.js.
//
// Middleware chain:
//   protect            → req.user
//   tenantIsolation    → req.tenantId (from req.user.instituteId)
//   requirePermission  → OWNER bypass, ADMIN requires assignment,
//                        TEACHER blocked (ATTENDANCE-only domain guard),
//                        STUDENT / PARENT blocked
//
// Permission map:
//   TEACHER_READ            → list, get single
//   TEACHER_CREATE          → create
//   TEACHER_UPDATE          → update, toggle status (interim; split into
//                              TEACHER_ACTIVATE / TEACHER_DEACTIVATE in a
//                              future sprint ΓÇö see FUTURE_WORK.md)
//   TEACHER_RESET_PASSWORD  → reset password
//   TEACHER_DELETE          → soft delete
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.get(
  "/",
  requirePermission("TEACHER_READ"),
  getTeachers
);

router.get(
  "/:teacherId",
  requirePermission("TEACHER_READ"),
  getTeacherById
);

router.patch(
  "/:teacherId",
  requirePermission("TEACHER_UPDATE"),
  updateTeacher
);

router.patch(
  "/:teacherId/status",
  requirePermission("TEACHER_UPDATE"),
  toggleTeacherStatus
);

router.patch(
  "/:teacherId/reset-password",
  requirePermission("TEACHER_RESET_PASSWORD"),
  resetTeacherPassword
);

router.delete(
  "/:teacherId",
  requirePermission("TEACHER_DELETE"),
  deleteTeacher
);

router.post(
  "/",
  requirePermission("TEACHER_CREATE"),
  createTeacher
);

module.exports = router;