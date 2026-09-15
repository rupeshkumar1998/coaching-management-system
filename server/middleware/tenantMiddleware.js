const tenantIsolation = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  // Super Admin is platform-level user
  if (req.user.role === "SUPER_ADMIN") {
    req.tenantId = null;
    return next();
  }

  // Every institute user must have an instituteId
  if (!req.user.instituteId) {
    return res.status(403).json({
      success: false,
      message: "Institute association is missing",
    });
  }

  // Server decides the tenant.
  // Never trust instituteId coming from the client.
  req.tenantId = req.user.instituteId;

  next();
};

module.exports = tenantIsolation;