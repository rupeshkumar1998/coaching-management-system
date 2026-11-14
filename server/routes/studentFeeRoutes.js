const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const requirePasswordChanged = require("../middleware/requirePasswordChanged");
const validateRequest = require("../middleware/validateRequest");

const {
  listMyFeesValidator,
  getMyFeeValidator,
} = require("../validators/studentFeeValidator");

const {
  listMyFeesHandler,
  getMyFeeHandler,
} = require("../controllers/studentFeeController");

const router = express.Router();

// =========================================================
// 32.16.18 ΓÇö Student Fee Routes
//
// Mounted at /api/student/fees.
// Requires:
//   protect + tenantIsolation + requireRole(STUDENT)
//   + requirePasswordChanged (temp password students blocked)
// =========================================================

router.use(protect);
router.use(tenantIsolation);
router.use(requireRole("STUDENT"));
router.use(requirePasswordChanged);

router.get(
  "/",
  listMyFeesValidator,
  validateRequest,
  listMyFeesHandler
);

router.get(
  "/:feeId",
  getMyFeeValidator,
  validateRequest,
  getMyFeeHandler
);

module.exports = router;