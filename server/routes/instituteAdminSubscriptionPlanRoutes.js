const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireRole = require("../middleware/roleMiddleware");

const {
  getAvailablePlans,
  getPlanDetails,
} = require("../controllers/instituteSubscriptionPlanController");

const router = express.Router();

// ==========================================
// 32.16.15.9.13 — Institute Admin Read-Only Plan Access
//
// Institute Admin can only READ published plans.
// No write operation is possible here.
// ==========================================

router.get(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getAvailablePlans
);

router.get(
  "/:planCode",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getPlanDetails
);

module.exports = router;