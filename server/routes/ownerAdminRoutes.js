
const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireInstituteOwner = require("../middleware/requireInstituteOwner");

const {
  createOwnerAdmin,
  getOwnerAdmins,
  getOwnerAdminById,
  updateOwnerAdmin,
  updateOwnerAdminStatus,
  deleteOwnerAdmin,
  resetOwnerAdminPassword,
} = require("../controllers/ownerAdminController");

const router = express.Router();

// ==========================================
// 32.16.9 — Owner Admin Management
// ==========================================

// Only the verified Institute Owner can create Admins
// for their own institute.
router.post(
  "/",
  protect,
  requireInstituteOwner,
  createOwnerAdmin
);


// Owner lists Admins of their own institute
router.get(
  "/",
  protect,
  requireInstituteOwner,
  getOwnerAdmins
);

router.get(
  "/:adminId",
  protect,
  requireInstituteOwner,
  getOwnerAdminById
);


router.patch(
  "/:adminId",
  protect,
  requireInstituteOwner,
  updateOwnerAdmin
);

router.patch(
  "/:adminId/status",
  protect,
  requireInstituteOwner,
  updateOwnerAdminStatus
);


// Owner soft-deletes an Institute Admin
// Self-delete and last-admin protections are enforced
// in the controller. requireInstituteOwner sets
// req.institute + req.tenantId, which the controller
// depends on.
router.delete(
  "/:adminId",
  protect,
  requireInstituteOwner,
  deleteOwnerAdmin
);

// Owner resets an Institute Admin's password
// (owner-only; self-reset via /api/auth/change-password)
router.patch(
  "/:adminId/reset-password",
  protect,
  requireInstituteOwner,
  resetOwnerAdminPassword
);
module.exports = router;
