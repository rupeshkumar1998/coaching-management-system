
const mongoose = require("mongoose");
const User = require("../models/User");
const { hashPassword } = require("../services/authService");
const { reserveLimit } = require("../services/limitService");

// ==========================================
// 32.16.9 — Owner Creates Institute Admin
// ==========================================

const createOwnerAdmin = async (req, res) => {
  try {
    // 1. Verified Owner context required
    if (!req.user || !req.institute || !req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Verified institute ownership required",
      });
    }

    // 2. Institute must be approved and active
    if (
      req.institute.approvalStatus !== "APPROVED" ||
      !req.institute.isActive
    ) {
      return res.status(403).json({
        success: false,
        message: "Institute is not approved or active",
      });
    }


    // --------------------------------
// Strict request field validation
// --------------------------------

const allowedFields = new Set([
  "name",
  "email",
  "phone",
  "password",
]);

if (
  !req.body ||
  typeof req.body !== "object" ||
  Array.isArray(req.body)
) {
  return res.status(400).json({
    success: false,
    message: "Invalid request body",
  });
}

const unexpectedFields = Object.keys(req.body).filter(
  (field) => !allowedFields.has(field)
);

if (unexpectedFields.length > 0) {
  return res.status(400).json({
    success: false,
    message: "Unexpected fields are not allowed",
  });
}






    const { name, email, phone, password } = req.body;

    // 3. Validate required fields
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid name, email and password are required",
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (
      normalizedName.length < 2 ||
      normalizedName.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid name, email or password",
      });
    }

    // 4. Validate optional phone
    let normalizedPhone = null;

    if (phone !== undefined && phone !== null) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a string",
        });
      }

      normalizedPhone = phone.trim() || null;

      if (
        normalizedPhone &&
        (normalizedPhone.length < 7 ||
          normalizedPhone.length > 20)
      ) {
        return res.status(400).json({
          success: false,
          message: "Phone must be between 7 and 20 characters",
        });
      }
    }

    // 5. Check duplicate email
    const existingUser = await User.exists({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    // 6. Hash password
    const hashedPassword = await hashPassword(password);

    // 7. 32.16.16 Sprint 4B — Atomic transaction with MAX_ADMINS limit
    const session = await mongoose.startSession();
    let admin = null;

    try {
      await session.withTransaction(async () => {
        // Reserve limit slot (atomic, race-safe)
        await reserveLimit({
          instituteId: req.tenantId,
          limitKey: "MAX_ADMINS",
          incrementBy: 1,
          session,
        });

        [admin] = await User.create(
          [
            {
              instituteId: req.tenantId,
              name: normalizedName,
              email: normalizedEmail,
              phone: normalizedPhone,
              password: hashedPassword,
              role: "INSTITUTE_ADMIN",
              accountStatus: "ACTIVE",
              isActive: true,
            },
          ],
          { session }
        );
      });
    } catch (error) {
      // Transaction auto-rolled back
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "Email already exists",
        });
      }
      if (
        error.code === "LIMIT_REACHED" ||
        error.code === "FEATURE_DISABLED" ||
        error.code === "SUBSCRIPTION_INACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    } finally {
      await session.endSession();
    }

    // 8. Safe response
    return res.status(201).json({
      success: true,
      message: "Institute Admin created successfully",
      data: {
        admin: {
          id: admin._id,
          instituteId: admin.instituteId,
          name: admin.name,
          email: admin.email,
          phone: admin.phone,
          role: admin.role,
          accountStatus: admin.accountStatus,
          isActive: admin.isActive,
        },
      },
    });
  } catch (error) {
    console.error("Owner Admin Creation Error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create Institute Admin",
    });
  }
};



const getOwnerAdmins = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Verified institute ownership required",
      });
    }

    const admins = await User.find({
      instituteId: req.tenantId,
      role: "INSTITUTE_ADMIN",
      isDeleted: false,
    })
      .select(
        "_id name email phone role instituteId accountStatus isActive lastLogin createdAt"
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Institute Admins fetched successfully",
      count: admins.length,
      data: {
        admins,
      },
    });
  } catch (error) {
    console.error("Get Owner Admins Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Institute Admins",
    });
  }
};




const getOwnerAdminById = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Verified institute ownership required",
      });
    }

    const { adminId } = req.params;

    if (!mongoose.isObjectIdOrHexString(adminId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Admin ID",
      });
    }

    const admin = await User.findOne({
      _id: adminId,
      instituteId: req.tenantId,
      role: "INSTITUTE_ADMIN",
      isDeleted: false,
    }).select(
      "_id name email phone role instituteId accountStatus isActive lastLogin createdAt"
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Institute Admin not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Institute Admin fetched successfully",
      data: { admin },
    });
  } catch (error) {
    console.error("Get Owner Admin By ID Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch Institute Admin",
    });
  }
};




const updateOwnerAdmin = async (req, res) => {
  try {
    if (!req.tenantId || !req.institute) {
      return res.status(403).json({
        success: false,
        message: "Verified institute ownership required",
      });
    }

    if (
      req.institute.approvalStatus !== "APPROVED" ||
      !req.institute.isActive
    ) {
      return res.status(403).json({
        success: false,
        message: "Institute is not approved or active",
      });
    }

    const { adminId } = req.params;

    if (!mongoose.isObjectIdOrHexString(adminId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Admin ID",
      });
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
      });
    }

    const allowedFields = new Set(["name", "phone"]);
    const fields = Object.keys(req.body);

    if (
      fields.length === 0 ||
      fields.some((field) => !allowedFields.has(field))
    ) {
      return res.status(400).json({
        success: false,
        message: "Only name and phone can be updated",
      });
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      if (typeof req.body.name !== "string") {
        return res.status(400).json({
          success: false,
          message: "Name must be a string",
        });
      }

      const name = req.body.name.trim();

      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({
          success: false,
          message: "Name must be between 2 and 100 characters",
        });
      }

      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const { phone } = req.body;

      if (phone !== null && typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a string or null",
        });
      }

      const normalizedPhone =
        phone === null ? null : phone.trim() || null;

      if (
        normalizedPhone !== null &&
        (normalizedPhone.length < 7 || normalizedPhone.length > 20)
      ) {
        return res.status(400).json({
          success: false,
          message: "Phone must be between 7 and 20 characters",
        });
      }

      updates.phone = normalizedPhone;
    }

    const admin = await User.findOneAndUpdate(
      {
        _id: adminId,
        instituteId: req.tenantId,
        role: "INSTITUTE_ADMIN",
        isDeleted: false,
      },
      { $set: updates },
      {
        returnDocument: "after",
        runValidators: true,
        projection: {
          _id: 1,
          instituteId: 1,
          name: 1,
          email: 1,
          phone: 1,
          role: 1,
          accountStatus: 1,
          isActive: 1,
          lastLogin: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Institute Admin not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Institute Admin profile updated successfully",
      data: { admin },
    });
  } catch (error) {
    console.error("Update Owner Admin Error:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: "Invalid Admin profile data",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update Institute Admin profile",
    });
  }
};



const updateOwnerAdminStatus = async (req, res) => {
  try {
    if (!req.tenantId || !req.institute) {
      return res.status(403).json({
        success: false,
        message: "Verified institute ownership required",
      });
    }

    if (
      req.institute.approvalStatus !== "APPROVED" ||
      !req.institute.isActive
    ) {
      return res.status(403).json({
        success: false,
        message: "Institute is not approved or active",
      });
    }

    const { adminId } = req.params;

    if (!mongoose.isObjectIdOrHexString(adminId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Admin ID",
      });
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 ||
      typeof req.body.isActive !== "boolean"
    ) {
      return res.status(400).json({
        success: false,
        message: "Only boolean isActive is allowed",
      });
    }

    const activate = req.body.isActive;

    const admin = await User.findOneAndUpdate(
      {
        _id: adminId,
        instituteId: req.tenantId,
        role: "INSTITUTE_ADMIN",
        isDeleted: false,
        accountStatus: { $in: ["ACTIVE", "SUSPENDED"] },
      },
      {
        $set: {
          isActive: activate,
          accountStatus: activate ? "ACTIVE" : "SUSPENDED",
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
        projection: {
          _id: 1,
          instituteId: 1,
          name: 1,
          email: 1,
          role: 1,
          isActive: 1,
          accountStatus: 1,
          updatedAt: 1,
        },
      }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Eligible Institute Admin not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: activate
        ? "Institute Admin activated successfully"
        : "Institute Admin deactivated successfully",
      data: { admin },
    });
  } catch (error) {
    console.error("Update Owner Admin Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update Institute Admin status",
    });
  }
};


module.exports = {
  createOwnerAdmin,
  getOwnerAdmins,
  getOwnerAdminById,
  updateOwnerAdmin,
  updateOwnerAdminStatus,
};
