const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");
const requireInstituteOwner = require("../middleware/requireInstituteOwner");

const router = express.Router();

// Super Admin only
router.get(
  "/super-admin",
  protect,
  requireRole("SUPER_ADMIN"),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Super Admin access granted",
      user: {
        name: req.user.name,
        role: req.user.role,
      },
    });
  }
);

// Super Admin + Institute Admin
router.get(
  "/admin",
  protect,
  requireRole("SUPER_ADMIN", "INSTITUTE_ADMIN"),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Admin access granted",
      user: {
        name: req.user.name,
        role: req.user.role,
      },
    });
  }
);

// Teacher only
router.get(
  "/teacher",
  protect,
  requireRole("TEACHER"),
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Teacher access granted",
      user: {
        name: req.user.name,
        role: req.user.role,
      },
    });
  }
);


// Institute Owner only + ownership verification
router.get(
  "/institute-owner",
  protect,
  requireInstituteOwner,
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Institute Owner access granted",
      user: {
        name: req.user.name,
        role: req.user.role,
        instituteId: req.user.instituteId,
      },
      institute: {
        id: req.institute._id,
        name: req.institute.name,
        code: req.institute.code,
        ownerId: req.institute.ownerId,
      },
      tenantId: req.tenantId,
    });
  }
);


// Tenant test
router.get(
  "/tenant",
  protect,
  tenantIsolation,
  (req, res) => {
    res.status(200).json({
      success: true,
      message: "Tenant isolation middleware passed",
      data: {
        userId: req.user._id,
        role: req.user.role,
        instituteId: req.user.instituteId,
        tenantId: req.tenantId,
      },
    });
  }
);


// ==========================================
// 32.16.7 — Owner Tenant Isolation Test
// ==========================================

router.get(
  "/owner-tenant/:instituteId",
  protect,
  requireInstituteOwner,
  (req, res) => {
    const requestedInstituteId = req.params.instituteId;

    // Never trust an institute ID supplied by the client.
    // Compare it against the verified Owner's tenant.
    if (
      requestedInstituteId !==
      String(req.tenantId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Cross-institute access denied",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Owner tenant isolation verified",
      data: {
        ownerId: req.user._id,
        instituteId: req.institute._id,
        instituteName: req.institute.name,
        tenantId: req.tenantId,
      },
    });
  }
);


module.exports = router;
