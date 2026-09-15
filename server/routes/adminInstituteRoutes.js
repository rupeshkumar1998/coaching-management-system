const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const {
  getPendingInstitutes,
  approveInstitute,
} = require("../controllers/adminInstituteController");

const router = express.Router();

// ==========================================
// Get Pending Institutes
// ==========================================

router.get(
  "/pending",
  protect,
  requireRole("SUPER_ADMIN"),
  getPendingInstitutes
);

// ==========================================
// Approve Institute
// ==========================================

router.patch(
  "/:instituteId/approve",
  protect,
  requireRole("SUPER_ADMIN"),
  approveInstitute
);

module.exports = router;