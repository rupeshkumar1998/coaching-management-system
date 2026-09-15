const express = require("express");

const protect = require("../middleware/authMiddleware");
const requireRole = require("../middleware/roleMiddleware");
const tenantIsolation = require("../middleware/tenantMiddleware");

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

module.exports = router;