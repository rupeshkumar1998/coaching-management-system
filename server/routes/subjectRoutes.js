// const express = require("express");

// const protect = require("../middleware/authMiddleware");
// const requireRole = require("../middleware/roleMiddleware");
// const tenantIsolation = require("../middleware/tenantMiddleware");

// const {
//   createSubject,
//   getSubjects,
// } = require("../controllers/subjectController");

// const router = express.Router();

// // Institute Admin creates a subject
// router.post(
//   "/",
//   protect,
//   requireRole("INSTITUTE_ADMIN"),
//   tenantIsolation,
//   createSubject
// );

// // Institute Admin views subjects
// router.get(
//   "/",
//   protect,
//   requireRole("INSTITUTE_ADMIN"),
//   tenantIsolation,
//   getSubjects
// );

// module.exports = router;
const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");

const {
  createSubject,
  getSubjects,
  getSubjectById,
  updateSubject,
  activateSubject,
  deactivateSubject,
  deleteSubject,
} = require("../controllers/subjectController");

const router = express.Router();

// Create subject
router.post(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  createSubject
);

// Get all active subjects
router.get(
  "/",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getSubjects
);

// Get single subject
router.get(
  "/:subjectId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  getSubjectById
);

// Update subject
router.patch(
  "/:subjectId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  updateSubject
);

// Activate subject
router.patch(
  "/:subjectId/activate",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  activateSubject
);

// Deactivate subject
router.patch(
  "/:subjectId/deactivate",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  deactivateSubject
);

// Soft delete subject
router.delete(
  "/:subjectId",
  protect,
  requireRole("INSTITUTE_ADMIN"),
  tenantIsolation,
  deleteSubject
);

module.exports = router;
