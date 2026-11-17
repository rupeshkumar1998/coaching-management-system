const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

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

// =========================================================
// 32.16.19 ΓÇö Subject Routes (permission-guarded)
//
// Mounted at /api/admin/subjects in app.js.
//
// Middleware chain:
//   protect            ΓåÆ req.user
//   tenantIsolation    ΓåÆ req.tenantId
//   requirePermission  ΓåÆ OWNER bypass; ADMIN requires assignment;
//                        TEACHER blocked (ATTENDANCE-only);
//                        STUDENT / PARENT blocked
//
// Permission map:
//   SUBJECT_READ     ΓåÆ list, get single
//   SUBJECT_CREATE   ΓåÆ create
//   SUBJECT_UPDATE   ΓåÆ update, activate, deactivate (interim; split into
//                       SUBJECT_ACTIVATE / SUBJECT_DEACTIVATE in future)
//   SUBJECT_DELETE   ΓåÆ soft delete (SENSITIVE)
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.post(
  "/",
  requirePermission("SUBJECT_CREATE"),
  createSubject
);

router.get(
  "/",
  requirePermission("SUBJECT_READ"),
  getSubjects
);

router.get(
  "/:subjectId",
  requirePermission("SUBJECT_READ"),
  getSubjectById
);

router.patch(
  "/:subjectId",
  requirePermission("SUBJECT_UPDATE"),
  updateSubject
);

router.patch(
  "/:subjectId/activate",
  requirePermission("SUBJECT_UPDATE"),
  activateSubject
);

router.patch(
  "/:subjectId/deactivate",
  requirePermission("SUBJECT_UPDATE"),
  deactivateSubject
);

router.delete(
  "/:subjectId",
  requirePermission("SUBJECT_DELETE"),
  deleteSubject
);

module.exports = router;