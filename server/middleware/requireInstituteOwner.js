const mongoose = require("mongoose");
const Institute = require("../models/Institute");

const requireInstituteOwner = async (req, res, next) => {
  try {
    // Authentication required
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Only Institute Owner is allowed
    if (req.user.role !== "INSTITUTE_OWNER") {
      return res.status(403).json({
        success: false,
        message: "Institute Owner access required",
      });
    }

    // Owner must be linked to an institute
    if (!req.user.instituteId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    // Validate instituteId before querying MongoDB
    if (!mongoose.Types.ObjectId.isValid(req.user.instituteId)) {
      return res.status(403).json({
        success: false,
        message: "Invalid institute association",
      });
    }

    // Verify actual ownership from the database
    const institute = await Institute.findOne({
      _id: req.user.instituteId,
      ownerId: req.user._id,
    });

    if (!institute) {
      return res.status(403).json({
        success: false,
        message: "You are not the owner of this institute",
      });
    }

    // Make verified institute context available to later controllers
    req.institute = institute;
    req.tenantId = institute._id;

    next();
  } catch (error) {
    console.error("Institute owner authorization error:", error);

    return res.status(500).json({
      success: false,
      message: "Institute owner authorization failed",
    });
  }
};

module.exports = requireInstituteOwner;