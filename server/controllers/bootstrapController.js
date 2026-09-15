const User = require("../models/User");
const { hashPassword } = require("../services/authService");

const createSuperAdmin = async (req, res) => {
  try {
    const existingSuperAdmin = await User.findOne({
      role: "SUPER_ADMIN",
      isDeleted: false,
    });

    if (existingSuperAdmin) {
      return res.status(409).json({
        success: false,
        message: "Super Admin already exists",
      });
    }

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    const hashedPassword = await hashPassword(password);

    const superAdmin = await User.create({ 
  instituteId: null, 
  name, 
  email, 
  password: hashedPassword, 
  role: "SUPER_ADMIN",

  accountStatus: "ACTIVE",
  isActive: true,
});

    res.status(201).json({
      success: true,
      message: "Super Admin created successfully",
      data: {
        id: superAdmin._id,
        name: superAdmin.name,
        email: superAdmin.email,
        role: superAdmin.role,
      },
    });
  } catch (error) {
    console.error("Super Admin creation error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create Super Admin",
    });
  }
};

module.exports = {
  createSuperAdmin,
};