const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

//////////// need to check it    
    const user = await User.findOne({
      _id: decoded.userId,
      isDeleted: false,
    });
/////////////

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    // if (!user.isActive) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Account is inactive",
    //   });
    // }

    if (user.isDeleted) {
  return res.status(403).json({
    success: false,
    message: "Account is no longer available",
  });
}

if (user.accountStatus === "PENDING") {
  return res.status(403).json({
    success: false,
    message: "Account is awaiting approval",
  });
}

if (user.accountStatus === "REJECTED") {
  return res.status(403).json({
    success: false,
    message: "Account has been rejected",
  });
}

if (user.accountStatus === "SUSPENDED") {
  return res.status(403).json({
    success: false,
    message: "Account is suspended",
  });
}

if (!user.isActive || user.accountStatus !== "ACTIVE") {
  return res.status(403).json({
    success: false,
    message: "Account is inactive",
  });
}






    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = protect;