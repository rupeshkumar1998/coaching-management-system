
const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createDraftPlanVersionValidator,
  updateDraftPlanVersionValidator,
  publishPlanVersionValidator,
  retirePlanVersionValidator,
} = require("../validators/subscriptionPlanVersionValidator");

const {
  createDraftPlanVersion,
  updateDraftPlanVersion,
  publishPlanVersion,
  retirePublishedPlanVersion,
} = require("../controllers/subscriptionPlanVersionController");

const router = express.Router();

// All routes require authenticated SUPER_ADMIN access.
router.use(protect);
router.use(requireRole("SUPER_ADMIN"));

// Create a new draft version.
router.post(
  "/:planId/versions",
  createDraftPlanVersionValidator,
  validateRequest,
  createDraftPlanVersion
);

// Update an existing draft version.
router.patch(
  "/:planId/versions/:versionId",
  updateDraftPlanVersionValidator,
  validateRequest,
  updateDraftPlanVersion
);

// Publish a draft version.
router.post(
  "/:planId/versions/:versionId/publish",
  publishPlanVersionValidator,
  validateRequest,
  publishPlanVersion
);

// Retire the currently published version.
router.post(
  "/:planId/versions/:versionId/retire",
  retirePlanVersionValidator,
  validateRequest,
  retirePublishedPlanVersion
);

module.exports = router;
