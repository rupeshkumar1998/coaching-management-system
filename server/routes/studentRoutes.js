const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createStudentValidator,
  listStudentsValidator,
  getStudentValidator,
  updateStudentValidator,
  assignBatchValidator,
  removeBatchValidator,
  deleteStudentValidator,
  resetStudentPasswordValidator,
} = require("../validators/studentValidator");

const {
  createStudentHandler,
  listStudentsHandler,
  getStudentHandler,
  updateStudentHandler,
  assignBatchHandler,
  removeBatchHandler,
  deleteStudentHandler,
  resetStudentPasswordHandler,
} = require("../controllers/studentController");

const router = express.Router();

// =========================================================
// 32.16.16 — Student Routes
//
// Mounted at /api/owner/students in app.js.
// =========================================================

router.use(protect);
router.use(tenantIsolation);

// Create student
router.post(
  "/",
  requirePermission("STUDENT_CREATE"),
  createStudentValidator,
  validateRequest,
  createStudentHandler
);

// List students (?classId=&batchId=)
router.get(
  "/",
  requirePermission("STUDENT_READ"),
  listStudentsValidator,
  validateRequest,
  listStudentsHandler
);

// Get single
router.get(
  "/:studentId",
  requirePermission("STUDENT_READ"),
  getStudentValidator,
  validateRequest,
  getStudentHandler
);

// Update (name/phone)
router.patch(
  "/:studentId",
  requirePermission("STUDENT_UPDATE"),
  updateStudentValidator,
  validateRequest,
  updateStudentHandler
);

// Assign batch
router.patch(
  "/:studentId/assign-batch",
  requirePermission("STUDENT_UPDATE"),
  assignBatchValidator,
  validateRequest,
  assignBatchHandler
);

// Remove batch
router.patch(
  "/:studentId/remove-batch",
  requirePermission("STUDENT_UPDATE"),
  removeBatchValidator,
  validateRequest,
  removeBatchHandler
);

// Soft delete student
router.delete(
  "/:studentId",
  requirePermission("STUDENT_DELETE"),
  deleteStudentValidator,
  validateRequest,
  deleteStudentHandler
);

// Reset student password (SENSITIVE)
router.patch(
  "/:studentId/reset-password",
  requirePermission("STUDENT_RESET_PASSWORD"),
  resetStudentPasswordValidator,
  validateRequest,
  resetStudentPasswordHandler
);
module.exports = router;