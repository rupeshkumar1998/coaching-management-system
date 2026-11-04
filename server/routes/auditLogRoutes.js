const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const { getAuditLogs } = require("../controllers/auditLogController");

const router = express.Router();

// All audit-log routes are SUPER_ADMIN-only.
router.use(protect);
router.use(requireRole("SUPER_ADMIN"));

// GET /api/admin/audit-logs
router.get("/", getAuditLogs);

module.exports = router;