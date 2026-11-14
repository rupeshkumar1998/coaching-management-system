const express = require("express");
const { query } = require("express-validator");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const requirePasswordChanged = require("../middleware/requirePasswordChanged");
const validateRequest = require("../middleware/validateRequest");

const { listValidator } = require("../validators/studentAttendanceValidator");

const {
  getMyProfileHandler,
  listMyAttendanceHandler,
  mySummaryHandler,
} = require("../controllers/studentProfileController");

// =========================================================
// 32.16.18a ΓÇö Student Profile Routes
//
// Mounted at /api/student in app.js.
//
// /me bypasses requirePasswordChanged (frontend needs
// the flag to decide whether to redirect to the
// change-password page).
// =========================================================

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ownSummaryValidator = [
  query("from")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("from must be YYYY-MM-DD"),
  query("to")
    .optional()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("to must be YYYY-MM-DD"),
];

const router = express.Router();

router.use(protect);
router.use(tenantIsolation);
router.use(requireRole("STUDENT"));

// Profile ΓÇö bypasses password gate
router.get("/me", getMyProfileHandler);

// Gated routes (must change password first)
router.get(
  "/attendance/summary",
  requirePasswordChanged,
  ownSummaryValidator,
  validateRequest,
  mySummaryHandler
);

router.get(
  "/attendance",
  requirePasswordChanged,
  listValidator,
  validateRequest,
  listMyAttendanceHandler
);

module.exports = router;