const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const {
  getMyProfile,
  updateMyProfile,
  updateMyProfessionalProfile,
} = require("../controllers/teacherController");

const router = express.Router();

// Teacher gets own profile
router.get(
  "/me",
  protect,
  requireRole("TEACHER"),
  getMyProfile
);


// Teacher update own profile
router.patch(
  "/me",
  protect,
  requireRole("TEACHER"),
  updateMyProfile
);

// Teacher update own Professional Profile
router.patch(
  "/me/professional",
  protect,
  requireRole("TEACHER"),
  updateMyProfessionalProfile
);

module.exports = router;