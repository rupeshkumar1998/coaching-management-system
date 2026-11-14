const User = require("../models/User");
// const { comparePassword } = require("../services/authService");
const {
  comparePassword,
  hashPassword,
} = require("../services/authService");

const generateToken = require("../utils/generateToken");

// Login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }
//////////need to check it 
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      isDeleted: false,
    }).select("+password");
////////////
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
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

if (user.accountStatus !== "ACTIVE" || !user.isActive) {
  return res.status(403).json({
    success: false,
    message: "Account is inactive",
  });
}






    const isPasswordValid = await comparePassword(
      password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = generateToken(user._id);

    res.cookie("accessToken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        instituteId: user.instituteId,
        mustChangePassword: user.mustChangePassword === true,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

// Logout
const logout = async (req, res) => {
  res.clearCookie("accessToken");

  res.status(200).json({
    success: true,
    message: "Logout successful",
  });
};

// Get currently logged-in user
const getMe = async (req, res) => {
  try {
    const user = req.user;

    res.status(200).json({
      success: true,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        instituteId: user.instituteId,
        profileImage: user.profileImage,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get current user",
    });
  }
};

// Change own password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
    }

    // Get password because User model has select: false
    const user = await User.findById(req.user._id).select("+password");

    if (!user || user.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "User account not found",
      });
    }

    if (user.accountStatus !== "ACTIVE" || !user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    const isCurrentPasswordValid = await comparePassword(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    const hashedPassword = await hashPassword(newPassword);

    user.password = hashedPassword;
    user.mustChangePassword = false;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to change password",
    });
  }
};






module.exports = {
  login,
  logout,
  getMe,
  changePassword,
};