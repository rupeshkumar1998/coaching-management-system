const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");

// const {
//   createTeacher,
// } = require("../controllers/adminTeacherController");
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

// Get teachers of logged-in institute
router.get(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getTeachers
);

router.get(
  "/:teacherId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getTeacherById
);

router.patch(
  "/:teacherId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  updateTeacher
);

router.patch(
  "/:teacherId/status",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  toggleTeacherStatus
);


router.delete(
  "/:teacherId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  deleteTeacher
);


// Institute Admin resets Teacher password
router.patch(
  "/:teacherId/reset-password",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  resetTeacherPassword
);



// Institute Admin creates Teacher
router.post(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  createTeacher
);

module.exports = router;