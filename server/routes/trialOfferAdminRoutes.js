const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createTrialOfferValidator,
  updateTrialOfferValidator,
  publishTrialOfferValidator,
  toggleTrialOfferValidator,
  retireTrialOfferValidator,
} = require("../validators/trialOfferAdminValidator");

const {
  createTrialOffer,
  updateTrialOffer,
  publishTrialOfferHandler,
  toggleTrialOffer,
  retireTrialOfferHandler,
  getCurrentTrialOffer,
  listTrialOffersHandler,
} = require("../controllers/trialOfferAdminController");

const router = express.Router();

// =========================================================
// 32.16.15.15 — Trial Offer Admin Routes
//
// All routes require SUPER_ADMIN.
// No write endpoint is exposed to any other role.
// =========================================================

router.use(protect);
router.use(requireRole("SUPER_ADMIN"));

// ---------------------------------------------------------
// GET routes — MUST come before POST/PATCH :offerId
// to avoid "history" being interpreted as an offerId.
// ---------------------------------------------------------

// Get current published offer (or null)
router.get("/", getCurrentTrialOffer);

// List all offers (newest version first)
router.get("/history", listTrialOffersHandler);

// ---------------------------------------------------------
// Write routes
// ---------------------------------------------------------

// Create a new DRAFT offer version
router.post(
  "/",
  createTrialOfferValidator,
  validateRequest,
  createTrialOffer
);

// Update a DRAFT offer
router.patch(
  "/:offerId",
  updateTrialOfferValidator,
  validateRequest,
  updateTrialOffer
);

// Publish a DRAFT offer
router.post(
  "/:offerId/publish",
  publishTrialOfferValidator,
  validateRequest,
  publishTrialOfferHandler
);

// Toggle the ENABLED flag on the currently PUBLISHED offer
router.patch(
  "/:offerId/toggle",
  toggleTrialOfferValidator,
  validateRequest,
  toggleTrialOffer
);

// Retire the PUBLISHED offer
router.post(
  "/:offerId/retire",
  retireTrialOfferValidator,
  validateRequest,
  retireTrialOfferHandler
);

module.exports = router;