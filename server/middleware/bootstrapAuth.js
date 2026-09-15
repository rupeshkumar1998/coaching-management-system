const bootstrapAuth = (req, res, next) => {
  const secret = req.headers["x-bootstrap-secret"];

  if (!secret || secret !== process.env.BOOTSTRAP_SECRET) {
    return res.status(403).json({
      success: false,
      message: "Invalid bootstrap secret",
    });
  }

  next();
};

module.exports = bootstrapAuth;