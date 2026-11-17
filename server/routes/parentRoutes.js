const express = require("express");

const protect = require("../middleware/authMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");
const validateRequest = require("../middleware/validateRequest");

const {
  createParentValidator,
  listParentsValidator,
  getParentValidator,
  updateParentValidator,
  deleteParentValidator,
} = require("../validators/parentValidator");

const {
  createParentHandler,
  listParentsHandler,
  getParentHandler,
  updateParentHandler,
  deleteParentHandler,
} = require("../controllers/parentController");

const router = express.Router();

// =========================================================
// 32.16.16 Sprint 4C — Parent Routes
// Mounted at /api/owner/parents
// =========================================================

router.use(protect);
router.use(tenantIsolation);

router.post(
  "/",
  requirePermission("PARENT_CREATE"),
  createParentValidator,
  validateRequest,
  createParentHandler
);

router.get(
  "/",
  requirePermission("PARENT_READ"),
  listParentsValidator,
  validateRequest,
  listParentsHandler
);

router.get(
  "/:parentId",
  requirePermission("PARENT_READ"),
  getParentValidator,
  validateRequest,
  getParentHandler
);

router.patch(
  "/:parentId",
  requirePermission("PARENT_UPDATE"),
  updateParentValidator,
  validateRequest,
  updateParentHandler
);

router.delete(
  "/:parentId",
  requirePermission("PARENT_DELETE"),
  deleteParentValidator,
  validateRequest,
  deleteParentHandler
);
module.exports = router;