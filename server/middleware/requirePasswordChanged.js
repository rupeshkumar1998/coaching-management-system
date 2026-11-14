// =========================================================
// 32.16.18a ΓÇö requirePasswordChanged
//
// Blocks access when the user has mustChangePassword=true.
// Must run AFTER authMiddleware (protect).
//
// Exempted routes (like GET /api/student/me) MUST NOT
// include this middleware so the frontend can detect the
// flag and redirect to the change-password page.
// =========================================================

const requirePasswordChanged = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (req.user.mustChangePassword === true) {
    return res.status(403).json({
      success: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      message:
        "You must change your password before accessing this resource",
    });
  }

  return next();
};

module.exports = requirePasswordChanged;