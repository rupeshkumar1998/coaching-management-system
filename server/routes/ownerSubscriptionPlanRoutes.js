const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireInstituteOwner = require("../middleware/requireInstituteOwner");

const {
  getAvailablePlans,
  getPlanDetails,
} = require("../controllers/instituteSubscriptionPlanController");

const router = express.Router();

// ==========================================
// 32.16.15.9.13 — Owner Read-Only Plan Access
//
// Institute Owner can only READ published plans.
// All write operations remain SUPER_ADMIN-only.
// ==========================================

router.get(
  "/",
  protect,
  requireInstituteOwner,
  getAvailablePlans
);

router.get(
  "/:planCode",
  protect,
  requireInstituteOwner,
  getPlanDetails
);

module.exports = router;