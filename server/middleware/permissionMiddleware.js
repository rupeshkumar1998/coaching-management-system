const mongoose = require("mongoose");

const Permission = require("../models/Permission");
const UserPermission = require("../models/UserPermission");

const requirePermission = (permissionKey) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      if (!permissionKey || typeof permissionKey !== "string") {
        return res.status(500).json({
          success: false,
          message: "Permission configuration error",
        });
      }

      /*
       * SUPER_ADMIN
       *
       * Platform owner does not depend on institute-level
       * UserPermission assignments.
       */
      if (req.user.role === "SUPER_ADMIN") {
        return next();
      }

      /*
       * Every institute-level authorization must have
       * a valid instituteId.
       */
      if (!req.user.instituteId) {
        return res.status(403).json({
          success: false,
          message: "Institute context is required",
        });
      }

      /*
       * Validate the user's institute ObjectId.
       */
      if (!mongoose.Types.ObjectId.isValid(req.user.instituteId)) {
        return res.status(403).json({
          success: false,
          message: "Invalid institute context",
        });
      }

      /*
       * Find the requested active permission.
       */
      const permission = await Permission.findOne({
        permissionKey: permissionKey.toUpperCase(),
        isActive: true,
      });

      if (!permission) {
        return res.status(403).json({
          success: false,
          message: "Permission is not available",
        });
      }

      /*
       * PLATFORM permissions are never granted through
       * institute-level authorization.
       *
       * Examples:
       * DOMAIN_VERIFY
       * DOMAIN_ASSIGN
       * DOMAIN_APPROVE
       */
      if (permission.category === "PLATFORM") {
        return res.status(403).json({
          success: false,
          message: "Platform permission required",
        });
      }

      /*
       * INSTITUTE_OWNER
       *
       * Owner has operational authority over their own
       * institute and therefore does not require an
       * individual UserPermission assignment.
       *
       * Platform permissions were already blocked above.
       */
      if (req.user.role === "INSTITUTE_OWNER") {
        if (
          req.user.accountStatus !== "ACTIVE" ||
          !req.user.isActive ||
          req.user.isDeleted
        ) {
          return res.status(403).json({
            success: false,
            message: "Account is not active",
          });
        }

        /*
         * If tenant middleware has already established
         * req.tenantId, ensure it matches the authenticated
         * user's institute.
         */
        if (
          req.tenantId &&
          String(req.tenantId) !== String(req.user.instituteId)
        ) {
          return res.status(403).json({
            success: false,
            message: "Institute access denied",
          });
        }

        return next();
      }

      /*
       * INSTITUTE_ADMIN
       *
       * Admin access is explicitly assignment-based.
       */
      if (req.user.role !== "INSTITUTE_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Role is not authorized for this permission",
        });
      }

      /*
       * Optional tenant consistency check.
       */
      if (
        req.tenantId &&
        String(req.tenantId) !== String(req.user.instituteId)
      ) {
        return res.status(403).json({
          success: false,
          message: "Institute access denied",
        });
      }

      /*
       * Check whether this Admin has the requested
       * permission in the same institute.
       */
      const assignment = await UserPermission.findOne({
        userId: req.user._id,
        instituteId: req.user.instituteId,
        permissionId: permission._id,
        isActive: true,
      });

      if (!assignment) {
        return res.status(403).json({
          success: false,
          message: "You do not have the required permission",
        });
      }

      /*
       * Permission successfully verified.
       */
      req.permission = permission;

      return next();
    } catch (error) {
      console.error(
        "Permission middleware error:",
        error.message
      );

      return res.status(500).json({
        success: false,
        message: "Permission authorization failed",
      });
    }
  };
};

module.exports = requirePermission;