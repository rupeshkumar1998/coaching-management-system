// const User = require("../models/User");
// const Institute = require("../models/Institute");
// const { hashPassword } = require("../services/authService");

// // ==========================================
// // Create Institute Owner
// // ==========================================

// const createInstituteOwner = async (req, res) => {
//   try {
//     const { instituteId } = req.params;
//     const {
//       name,
//       email,
//       phone,
//       password,
//     } = req.body;

//     // --------------------------------
//     // 1. Validate required fields
//     // --------------------------------

//     if (!instituteId) {
//       return res.status(400).json({
//         success: false,
//         message: "Institute ID is required",
//       });
//     }

//     if (!name || !email || !password) {
//       return res.status(400).json({
//         success: false,
//         message: "Name, email and password are required",
//       });
//     }

//     // --------------------------------
//     // 2. Validate password
//     // --------------------------------

//     if (password.length < 8) {
//       return res.status(400).json({
//         success: false,
//         message: "Password must be at least 8 characters long",
//       });
//     }

//     // --------------------------------
//     // 3. Find approved and active institute
//     // --------------------------------

//     const institute = await Institute.findOne({
//       _id: instituteId,
//       approvalStatus: "APPROVED",
//       isActive: true,
//     });

//     if (!institute) {
//       return res.status(404).json({
//         success: false,
//         message: "Approved and active institute not found",
//       });
//     }

//     // --------------------------------
//     // 4. Prevent multiple owners
//     // --------------------------------

//     if (institute.ownerId) {
//       return res.status(409).json({
//         success: false,
//         message: "Institute already has an owner",
//       });
//     }

//     // --------------------------------
//     // 5. Normalize owner details
//     // --------------------------------

//     const normalizedName = name.trim();
//     const normalizedEmail = email.trim().toLowerCase();

//     if (!normalizedName) {
//       return res.status(400).json({
//         success: false,
//         message: "Name cannot be empty",
//       });
//     }

//     if (!normalizedEmail) {
//       return res.status(400).json({
//         success: false,
//         message: "Email cannot be empty",
//       });
//     }

//     // --------------------------------
//     // 6. Prevent duplicate email
//     // --------------------------------

//     const existingUser = await User.findOne({
//       email: normalizedEmail,
//     });

//     if (existingUser) {
//       return res.status(409).json({
//         success: false,
//         message: "Email already exists",
//       });
//     }

//     // --------------------------------
//     // 7. Hash password
//     // --------------------------------

//     const hashedPassword = await hashPassword(password);

//     // --------------------------------
//     // 8. Create Owner User account
//     // --------------------------------

//     const ownerUser = await User.create({
//       instituteId: institute._id,
//       name: normalizedName,
//       email: normalizedEmail,
//       phone: phone ? phone.trim() : null,
//       password: hashedPassword,
//       role: "INSTITUTE_OWNER",
//       accountStatus: "ACTIVE",
//       isActive: true,
//     });

//     // --------------------------------
//     // 9. Link Owner to Institute
//     // --------------------------------

//     try {
//       institute.ownerId = ownerUser._id;

//       await institute.save();
//     } catch (error) {
//       // Rollback Owner account if Institute linking fails
//       await User.findByIdAndDelete(ownerUser._id);

//       throw error;
//     }

//     // --------------------------------
//     // 10. Success response
//     // --------------------------------

//     return res.status(201).json({
//       success: true,
//       message: "Institute Owner created successfully",
//       data: {
//         owner: {
//           id: ownerUser._id,
//           name: ownerUser.name,
//           email: ownerUser.email,
//           phone: ownerUser.phone,
//           role: ownerUser.role,
//           instituteId: ownerUser.instituteId,
//           accountStatus: ownerUser.accountStatus,
//           isActive: ownerUser.isActive,
//         },

//         institute: {
//           id: institute._id,
//           name: institute.name,
//           code: institute.code,
//           ownerId: institute.ownerId,
//           approvalStatus: institute.approvalStatus,
//           isActive: institute.isActive,
//         },
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Create Institute Owner Error:",
//       error
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Failed to create institute owner",
//     });
//   }
// };

// module.exports = {
//   createInstituteOwner,
// };


const mongoose = require("mongoose");
const User = require("../models/User");
const Institute = require("../models/Institute");
const { hashPassword } = require("../services/authService");

// ==========================================
// Create Institute Owner
// ==========================================

const createInstituteOwner = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { instituteId } = req.params;
    const {
      name,
      email,
      phone,
      password,
    } = req.body;

    // --------------------------------
    // 1. Validate required fields
    // --------------------------------

    if (!instituteId) {
      return res.status(400).json({
        success: false,
        message: "Institute ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(instituteId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid institute ID",
      });
    }

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    // --------------------------------
    // 2. Validate password
    // --------------------------------

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    ) {
      return res.status(400).json({
        success: false,
        message: "Password must be between 8 and 128 characters long",
      });
    }

    // --------------------------------
    // 3. Normalize owner details
    // --------------------------------

    if (typeof name !== "string" || typeof email !== "string") {
      return res.status(400).json({
        success: false,
        message: "Name and email must be valid text values",
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedName) {
      return res.status(400).json({
        success: false,
        message: "Name cannot be empty",
      });
    }

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: "Email cannot be empty",
      });
    }

    // --------------------------------
    // 4. Normalize phone
    // --------------------------------

    let normalizedPhone = null;

    if (phone !== undefined && phone !== null) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a valid text value",
        });
      }

      normalizedPhone = phone.trim() || null;
    }

    // --------------------------------
    // 5. Start transaction
    // --------------------------------

    let ownerUser;
    let updatedInstitute;

    await session.withTransaction(async () => {
      // --------------------------------
      // 6. Find approved and active institute
      // --------------------------------

      const institute = await Institute.findOne({
        _id: instituteId,
        approvalStatus: "APPROVED",
        isActive: true,
      }).session(session);

      if (!institute) {
        const error = new Error(
          "Approved and active institute not found"
        );

        error.statusCode = 404;

        throw error;
      }

      // --------------------------------
      // 7. Prevent multiple owners
      // --------------------------------

      if (institute.ownerId) {
        const error = new Error(
          "Institute already has an owner"
        );

        error.statusCode = 409;

        throw error;
      }

      // --------------------------------
      // 8. Prevent duplicate email
      // --------------------------------

      const existingUser = await User.findOne({
        email: normalizedEmail,
      }).session(session);

      if (existingUser) {
        const error = new Error(
          "Email already exists"
        );

        error.statusCode = 409;

        throw error;
      }

      // --------------------------------
      // 9. Hash password
      // --------------------------------

      const hashedPassword = await hashPassword(password);

      // --------------------------------
      // 10. Create Owner User
      // --------------------------------

      const createdUsers = await User.create(
        [
          {
            instituteId: institute._id,
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            password: hashedPassword,
            role: "INSTITUTE_OWNER",
            accountStatus: "ACTIVE",
            isActive: true,
          },
        ],
        { session }
      );

      ownerUser = createdUsers[0];

      // --------------------------------
      // 11. Atomically claim Institute
      // --------------------------------

      updatedInstitute = await Institute.findOneAndUpdate(
        {
          _id: institute._id,
          ownerId: null,
          approvalStatus: "APPROVED",
          isActive: true,
        },
        {
          $set: {
            ownerId: ownerUser._id,
          },
        },
        {
          returnDocument: "after",
          session,
        }
      );

      // --------------------------------
      // 12. Verify ownership claim
      // --------------------------------

      if (!updatedInstitute) {
        const error = new Error(
          "Institute ownership could not be established"
        );

        error.statusCode = 409;

        throw error;
      }

      // --------------------------------
      // 13. Verify User <--> Institute relationship
      // --------------------------------

      if (
        String(ownerUser.instituteId) !==
        String(updatedInstitute._id)
      ) {
        const error = new Error(
          "Owner and institute association is inconsistent"
        );

        error.statusCode = 500;

        throw error;
      }

      if (
        String(updatedInstitute.ownerId) !==
        String(ownerUser._id)
      ) {
        const error = new Error(
          "Institute ownership association is inconsistent"
        );

        error.statusCode = 500;

        throw error;
      }
    });

    // --------------------------------
    // 14. Success response
    // --------------------------------

    return res.status(201).json({
      success: true,
      message: "Institute Owner created successfully",
      data: {
        owner: {
          id: ownerUser._id,
          name: ownerUser.name,
          email: ownerUser.email,
          phone: ownerUser.phone,
          role: ownerUser.role,
          instituteId: ownerUser.instituteId,
          accountStatus: ownerUser.accountStatus,
          isActive: ownerUser.isActive,
        },

        institute: {
          id: updatedInstitute._id,
          name: updatedInstitute.name,
          code: updatedInstitute.code,
          ownerId: updatedInstitute.ownerId,
          approvalStatus: updatedInstitute.approvalStatus,
          isActive: updatedInstitute.isActive,
        },
      },
    });
  } catch (error) {
    console.error(
      "Create Institute Owner Error:",
      error
    );

    // --------------------------------
    // 15. Duplicate key handling
    // --------------------------------

    if (error?.code === 11000) {
      const duplicateField =
        Object.keys(error.keyPattern || {})[0];

      if (duplicateField === "email") {
        return res.status(409).json({
          success: false,
          message: "Email already exists",
        });
      }

      if (duplicateField === "ownerId") {
        return res.status(409).json({
          success: false,
          message: "Institute ownership conflict",
        });
      }

      return res.status(409).json({
        success: false,
        message: "Duplicate resource",
      });
    }

    // --------------------------------
    // 16. Known business errors
    // --------------------------------

    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    // --------------------------------
    // 17. Unexpected error
    // --------------------------------

    return res.status(500).json({
      success: false,
      message: "Failed to create institute owner",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createInstituteOwner,
};
