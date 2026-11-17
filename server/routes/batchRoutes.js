const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createBatchValidator,
  listBatchValidator,
  getBatchValidator,
  updateBatchValidator,
  deleteBatchValidator,
} = require("../validators/batchValidator");

const {
  createBatchHandler,
  listBatchesHandler,
  getBatchHandler,
  updateBatchHandler,
  deleteBatchHandler
} = require("../controllers/batchController");

const router = express.Router();

// =========================================================
// 32.16.16 — Batch Routes
//
// Mounted at /api/owner/batches in app.js.
//
// Access:
//   - INSTITUTE_OWNER : automatic
//   - INSTITUTE_ADMIN : requires BATCH_* permissions
// =========================================================

router.use(protect);
router.use(tenantIsolation);

// Create batch
router.post(
  "/",
  requirePermission("BATCH_CREATE"),
  createBatchValidator,
  validateRequest,
  createBatchHandler
);

// List batches (optional ?classId=)
router.get(
  "/",
  requirePermission("BATCH_READ"),
  listBatchValidator,
  validateRequest,
  listBatchesHandler
);

// Get single batch
router.get(
  "/:batchId",
  requirePermission("BATCH_READ"),
  getBatchValidator,
  validateRequest,
  getBatchHandler
);

// Update batch
router.patch(
  "/:batchId",
  requirePermission("BATCH_UPDATE"),
  updateBatchValidator,
  validateRequest,
  updateBatchHandler
);

router.delete(
  "/:batchId",
  requirePermission("BATCH_DELETE"),
  deleteBatchValidator,
  validateRequest,
  deleteBatchHandler
);

module.exports = router;