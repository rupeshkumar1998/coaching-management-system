const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const { summaryHandler } = require("../controllers/dashboardController");

const router = express.Router();

// =========================================================
// 32.16.19 ΓÇö Dashboard Routes
//
// Mounted at /api/owner/dashboard in app.js.
//
// Permission: DASHBOARD_READ
//   - OWNER : automatic (middleware bypass)
//   - ADMIN : explicit DASHBOARD_READ assignment required
//   - others: 403
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.get(
  "/summary",
  requirePermission("DASHBOARD_READ"),
  summaryHandler
);

module.exports = router;