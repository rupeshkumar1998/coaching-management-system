const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");



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


// Institute Admin updates teacher attendance
router.patch(
  "/:attendanceId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  updateTeacherAttendance
);


// Institute Admin soft-deletes teacher attendance
router.delete(
  "/:attendanceId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  deleteTeacherAttendance
);


// Institute Admin gets attendance summary of one teacher
router.get(
  "/teacher/:teacherId/summary",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getTeacherAttendanceSummary
);


// Institute Admin gets attendance of one teacher
router.get(
  "/teacher/:teacherId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getAttendanceByTeacher
);


// Institute Admin gets attendance by date
router.get(
  "/date/:date",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getAttendanceByDate
);

// Institute Admin gets teacher attendance
router.get(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getTeacherAttendance
);


// Institute Admin marks attendance for a teacher
router.post(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  markTeacherAttendance
);

module.exports = router;
