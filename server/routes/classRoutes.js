const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createClassValidator,
  updateClassValidator,
} = require("../validators/classValidator");

const {
  createClassHandler,
  listClassesHandler,
  updateClassHandler,
} = require("../controllers/classController");

const router = express.Router();

// =========================================================
// 32.16.16 — Class Routes
//
// Mounted at /api/owner/classes in app.js.
//
// Access:
//   - INSTITUTE_OWNER : automatic (permission middleware bypasses owner)
//   - INSTITUTE_ADMIN : requires CLASS_CREATE / CLASS_READ / CLASS_UPDATE
//                       assigned by Owner
// =========================================================

router.use(protect);
router.use(tenantIsolation);

// Create a class (requires CLASS_CREATE)
router.post(
  "/",
  requirePermission("CLASS_CREATE"),
  createClassValidator,
  validateRequest,
  createClassHandler
);

// List classes (requires CLASS_READ)
router.get(
  "/",
  requirePermission("CLASS_READ"),
  listClassesHandler
);

// Update a class (requires CLASS_UPDATE)
router.patch(
  "/:classId",
  requirePermission("CLASS_UPDATE"),
  updateClassValidator,
  validateRequest,
  updateClassHandler
);

module.exports = router;