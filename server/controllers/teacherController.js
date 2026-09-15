const User = require("../models/User");
const Teacher = require("../models/Teacher");

const getMyProfile = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.user._id,
      role: "TEACHER",
      isDeleted: false,
    }).select(
      "_id instituteId name email phone profileImage isActive accountStatus lastLogin twoFactorEnabled createdAt updatedAt"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    if (!user.isActive || user.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    const teacher = await Teacher.findOne({
      userId: user._id,
      instituteId: user.instituteId,
      isDeleted: false,
    }).select(
      "_id userId instituteId employeeId qualification specialization experienceYears joiningDate subjects bio employmentType status createdAt updatedAt"
    );

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Teacher profile fetched successfully",
      data: {
        user: {
          id: user._id,
          instituteId: user.instituteId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profileImage: user.profileImage,
          isActive: user.isActive,
          accountStatus: user.accountStatus,
          lastLogin: user.lastLogin,
          twoFactorEnabled: user.twoFactorEnabled,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },

        teacher: {
          id: teacher._id,
          userId: teacher.userId,
          instituteId: teacher.instituteId,
          employeeId: teacher.employeeId,
          qualification: teacher.qualification,
          specialization: teacher.specialization,
          experienceYears: teacher.experienceYears,
          joiningDate: teacher.joiningDate,
          subjects: teacher.subjects,
          bio: teacher.bio,
          employmentType: teacher.employmentType,
          status: teacher.status,
          createdAt: teacher.createdAt,
          updatedAt: teacher.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("Get My Teacher Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher profile",
    });
  }
};



const updateMyProfile = async (req, res) => {
  try {
    const { name, phone, profileImage, bio } = req.body;

    // At least one allowed field is required
    if (
      name === undefined &&
      phone === undefined &&
      profileImage === undefined &&
      bio === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one profile field is required",
      });
    }

    // Validate name
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Name must be at least 2 characters long",
        });
      }
    }

    // Validate phone
    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be a string",
        });
      }

      const phoneRegex = /^[0-9]{10}$/;

      if (!phoneRegex.test(phone.trim())) {
        return res.status(400).json({
          success: false,
          message: "Phone must be a valid 10-digit number",
        });
      }
    }

    // Validate profileImage
    if (profileImage !== undefined) {
      if (
        profileImage !== null &&
        typeof profileImage !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "Profile image must be a valid string or null",
        });
      }
    }

    // Validate bio
    if (bio !== undefined) {
      if (typeof bio !== "string") {
        return res.status(400).json({
          success: false,
          message: "Bio must be a string",
        });
      }

      if (bio.length > 500) {
        return res.status(400).json({
          success: false,
          message: "Bio cannot exceed 500 characters",
        });
      }
    }

    // Find teacher user
    const user = await User.findOne({
      _id: req.user._id,
      role: "TEACHER",
      isDeleted: false,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    // Account status check
    if (!user.isActive || user.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    // Update ONLY allowed User fields
    if (name !== undefined) {
      user.name = name.trim();
    }

    if (phone !== undefined) {
      user.phone = phone.trim();
    }

    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }

    await user.save();

    // Update bio in Teacher profile
    if (bio !== undefined) {
      const teacher = await Teacher.findOne({
        userId: user._id,
        instituteId: user.instituteId,
        isDeleted: false,
      });

      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: "Teacher profile not found",
        });
      }

      teacher.bio = bio.trim();

      await teacher.save();
    }

    return res.status(200).json({
      success: true,
      message: "Teacher profile updated successfully",
    });
  } catch (error) {
    console.error("Update My Teacher Profile Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update teacher profile",
    });
  }
};


const updateMyProfessionalProfile = async (req, res) => {
  try {
    const {
      qualification,
      specialization,
      experienceYears,
      joiningDate,
      subjects,
    } = req.body;

    // At least one allowed field is required
    if (
      qualification === undefined &&
      specialization === undefined &&
      experienceYears === undefined &&
      joiningDate === undefined &&
      subjects === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one professional field is required",
      });
    }

    // Validate qualification
    if (qualification !== undefined) {
      if (
        typeof qualification !== "string" ||
        qualification.trim().length < 2
      ) {
        return res.status(400).json({
          success: false,
          message: "Qualification must be at least 2 characters long",
        });
      }
    }

    // Validate specialization
    if (specialization !== undefined) {
      if (
        typeof specialization !== "string" ||
        specialization.trim().length < 2
      ) {
        return res.status(400).json({
          success: false,
          message: "Specialization must be at least 2 characters long",
        });
      }
    }

    // Validate experienceYears
    if (experienceYears !== undefined) {
      if (
        typeof experienceYears !== "number" ||
        experienceYears < 0 ||
        experienceYears > 60
      ) {
        return res.status(400).json({
          success: false,
          message: "Experience years must be between 0 and 60",
        });
      }
    }

    // Validate joiningDate
    if (joiningDate !== undefined) {
      const date = new Date(joiningDate);

      if (Number.isNaN(date.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Joining date must be a valid date",
        });
      }
    }

    // Validate subjects
    if (subjects !== undefined) {
      if (!Array.isArray(subjects)) {
        return res.status(400).json({
          success: false,
          message: "Subjects must be an array",
        });
      }

      if (subjects.length > 20) {
        return res.status(400).json({
          success: false,
          message: "Subjects cannot contain more than 20 items",
        });
      }

      for (const subject of subjects) {
        if (
          typeof subject !== "string" ||
          subject.trim().length < 1
        ) {
          return res.status(400).json({
            success: false,
            message: "Each subject must be a valid string",
          });
        }
      }
    }

    // Find logged-in teacher
    const user = await User.findOne({
      _id: req.user._id,
      role: "TEACHER",
      isDeleted: false,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    // Account status check
    if (!user.isActive || user.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is not active",
      });
    }

    // Find own teacher profile with tenant isolation
    const teacher = await Teacher.findOne({
      userId: user._id,
      instituteId: user.instituteId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher profile not found",
      });
    }

    // Update ONLY allowed professional fields
    if (qualification !== undefined) {
      teacher.qualification = qualification.trim();
    }

    if (specialization !== undefined) {
      teacher.specialization = specialization.trim();
    }

    if (experienceYears !== undefined) {
      teacher.experienceYears = experienceYears;
    }

    if (joiningDate !== undefined) {
      teacher.joiningDate = new Date(joiningDate);
    }

    if (subjects !== undefined) {
      teacher.subjects = subjects.map((subject) => subject.trim());
    }

    await teacher.save();

    return res.status(200).json({
      success: true,
      message: "Teacher professional profile updated successfully",
    });
  } catch (error) {
    console.error(
      "Update My Professional Profile Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to update professional profile",
    });
  }
};




module.exports = {
  getMyProfile,
  updateMyProfile,
  updateMyProfessionalProfile,
};