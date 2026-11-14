const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createFeeValidator,
  bulkCreateFeeValidator,
  listFeeValidator,
  getFeeValidator,
  updateFeeValidator,
  deleteFeeValidator,
  recordPaymentValidator,
  refundPaymentValidator,
} = require("../validators/feeValidator");

const {
  createFeeHandler,
  bulkCreateFeeHandler,
  listFeeHandler,
  summaryHandler,
  getFeeHandler,
  updateFeeHandler,
  deleteFeeHandler,
  recordPaymentHandler,
  refundPaymentHandler,
} = require("../controllers/feeController");

const router = express.Router();

// =========================================================
// 32.16.18 ΓÇö Fee Routes (Admin/Owner)
//
// Mounted at /api/owner/fees.
// Permissions:
//   FEE_CREATE  ΓåÆ create, bulk, record payment
//   FEE_READ    ΓåÆ list, get, summary
//   FEE_UPDATE  ΓåÆ patch
//   FEE_CORRECT ΓåÆ delete (SENSITIVE)
//   FEE_REFUND  ΓåÆ refund (SENSITIVE)
// =========================================================

router.use(protect);
router.use(requireRole("INSTITUTE_OWNER", "INSTITUTE_ADMIN"));
router.use(tenantIsolation);

// Specific routes BEFORE dynamic /:feeId

router.post(
  "/",
  requirePermission("FEE_CREATE"),
  createFeeValidator,
  validateRequest,
  createFeeHandler
);

router.post(
  "/bulk",
  requirePermission("FEE_CREATE"),
  bulkCreateFeeValidator,
  validateRequest,
  bulkCreateFeeHandler
);

router.get(
  "/summary",
  requirePermission("FEE_READ"),
  summaryHandler
);

router.post(
  "/payments/:paymentId/refund",
  requirePermission("FEE_REFUND"),
  refundPaymentValidator,
  validateRequest,
  refundPaymentHandler
);

router.get(
  "/",
  requirePermission("FEE_READ"),
  listFeeValidator,
  validateRequest,
  listFeeHandler
);

router.get(
  "/:feeId",
  requirePermission("FEE_READ"),
  getFeeValidator,
  validateRequest,
  getFeeHandler
);

router.patch(
  "/:feeId",
  requirePermission("FEE_UPDATE"),
  updateFeeValidator,
  validateRequest,
  updateFeeHandler
);

router.delete(
  "/:feeId",
  requirePermission("FEE_CORRECT"),
  deleteFeeValidator,
  validateRequest,
  deleteFeeHandler
);

router.post(
  "/:feeId/payments",
  requirePermission("FEE_CREATE"),
  recordPaymentValidator,
  validateRequest,
  recordPaymentHandler
);

module.exports = router;