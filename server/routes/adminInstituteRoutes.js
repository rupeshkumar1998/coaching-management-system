const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  getPendingInstitutes,
  approveInstitute,
} = require("../controllers/adminInstituteController");

const {
  createInstituteOwner,
} = require("../controllers/instituteOwnerController");

const {
  createInstituteOwnerValidator,
} = require("../validators/instituteOwnerValidator");

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

// ==========================================
// Create Institute Owner
// ==========================================

router.post(
  "/:instituteId/owner",
  protect,
  requireRole("SUPER_ADMIN"),
  createInstituteOwnerValidator,
  validateRequest,
  createInstituteOwner
);

module.exports = router;