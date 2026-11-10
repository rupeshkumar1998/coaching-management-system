const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const {
  getSubscriptionUsageHandler,
} = require("../controllers/subscriptionUsageController");

const router = express.Router();

// =========================================================
// 32.16.16 Sprint 5B — Subscription Usage
//
// Mounted at /api/owner/subscription-usage in app.js.
//
// Access:
//   - INSTITUTE_OWNER : automatic (permission middleware bypass)
//   - INSTITUTE_ADMIN : requires DASHBOARD_READ permission
//   - Others          : 403
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.get(
  "/",
  requirePermission("DASHBOARD_READ"),
  getSubscriptionUsageHandler
);

module.exports = router;