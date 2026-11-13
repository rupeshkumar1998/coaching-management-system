const Teacher = require("../models/Teacher");

// =========================================================
// 32.16.17 ΓÇö requireTeacherProfile
//
// For TEACHER-only routes. Resolves the Teacher profile
// from the authenticated user and attaches req.teacher.
//
// Must run AFTER authMiddleware (protect).
// Downstream controllers can rely on req.teacher._id.
//
// Rules:
//   - req.user must exist (401)
//   - req.user.role must be TEACHER (403)
//   - req.user.instituteId must exist (403)
//   - Teacher profile must exist, not soft-deleted (403)
//   - Teacher status must be ACTIVE (403)
// =========================================================

const requireTeacherProfile = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.user.role !== "TEACHER") {
      return res.status(403).json({
        success: false,
        message: "Teacher role required",
      });
    }

    if (!req.user.instituteId) {
      return res.status(403).json({
        success: false,
        message: "Institute context is required",
      });
    }

    const teacher = await Teacher.findOne({
      userId: req.user._id,
      instituteId: req.user.instituteId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(403).json({
        success: false,
        message: "Teacher profile not found or deleted",
      });
    }

    if (teacher.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Teacher account is not active",
      });
    }

    req.teacher = teacher;

    return next();
  } catch (error) {
    console.error("requireTeacherProfile error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Teacher profile resolution failed",
    });
  }
};

module.exports = requireTeacherProfile;