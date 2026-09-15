const User = require("../models/User");
const Teacher = require("../models/Teacher");
const Institute = require("../models/Institute");
const { hashPassword } = require("../services/authService");

const createTeacher = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      employeeId,
      qualification,
      specialization,
      experienceYears,
      joiningDate,
      subjects,
      bio,
      salary,
      employmentType,
    } = req.body;

    // Required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required",
      });
    }

    // Tenant must exist
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    // Verify institute
    const institute = await Institute.findOne({
      _id: req.tenantId,
      isActive: true,
      approvalStatus: "APPROVED",
    });

    if (!institute) {
      return res.status(403).json({
        success: false,
        message: "Institute is not active or approved",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Email must be unique
    const existingUser = await User.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already exists",
      });
    }

    // Employee ID unique within this institute
    if (employeeId) {
      const existingEmployee = await Teacher.findOne({
        instituteId: req.tenantId,
        employeeId: employeeId.trim().toUpperCase(),
        isDeleted: false,
      });

      if (existingEmployee) {
        return res.status(409).json({
          success: false,
          message: "Employee ID already exists in this institute",
        });
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create User account
    const teacherUser = await User.create({
      instituteId: req.tenantId,
      name: name.trim(),
      email: normalizedEmail,
      phone: phone ? phone.trim() : null,
      password: hashedPassword,
      role: "TEACHER",
      accountStatus: "ACTIVE",
      isActive: true,
    });

    // Create Teacher profile
    let teacherProfile;

    try {
      teacherProfile = await Teacher.create({
        userId: teacherUser._id,
        instituteId: req.tenantId,
        employeeId: employeeId
          ? employeeId.trim().toUpperCase()
          : null,
        qualification: qualification ? qualification.trim() : null,
        specialization: specialization
          ? specialization.trim()
          : null,
        experienceYears:
          experienceYears !== undefined ? experienceYears : 0,
        joiningDate: joiningDate || null,
        subjects: Array.isArray(subjects) ? subjects : [],
        bio: bio ? bio.trim() : null,
        salary: salary !== undefined ? salary : null,
        employmentType: employmentType || "FULL_TIME",
        status: "ACTIVE",
      });
    } catch (error) {
      // Rollback User if Teacher profile creation fails
      await User.findByIdAndDelete(teacherUser._id);
      throw error;
    }

    return res.status(201).json({
      success: true,
      message: "Teacher created successfully",
      data: {
        user: {
          id: teacherUser._id,
          name: teacherUser.name,
          email: teacherUser.email,
          phone: teacherUser.phone,
          role: teacherUser.role,
          instituteId: teacherUser.instituteId,
          accountStatus: teacherUser.accountStatus,
          isActive: teacherUser.isActive,
        },
        teacher: {
          id: teacherProfile._id,
          employeeId: teacherProfile.employeeId,
          qualification: teacherProfile.qualification,
          specialization: teacherProfile.specialization,
          experienceYears: teacherProfile.experienceYears,
          joiningDate: teacherProfile.joiningDate,
          subjects: teacherProfile.subjects,
          employmentType: teacherProfile.employmentType,
          status: teacherProfile.status,
        },
      },
    });
  } catch (error) {
    console.error("Create Teacher Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create teacher",
    });
  }
};

const getTeachers = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const teachers = await Teacher.find({
      instituteId: req.tenantId,
      isDeleted: false,
    })
      .populate({
        path: "userId",
        select: "name email phone role accountStatus isActive profileImage lastLogin",
      })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: teachers.length,
      data: teachers,
    });
  } catch (error) {
    console.error("Get Teachers Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch teachers",
    });
  }
};


const getTeacherById = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    })
      .populate({
        path: "userId",
        select:
          "name email phone role accountStatus isActive profileImage lastLogin",
      })
      .lean();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: teacher,
    });
  } catch (error) {
    console.error("Get Teacher By ID Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch teacher",
    });
  }
};


const updateTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    // Find teacher only inside logged-in admin's institute
    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const {
      name,
      email,
      phone,
      employeeId,
      qualification,
      specialization,
      experienceYears,
      joiningDate,
      subjects,
      bio,
      salary,
      employmentType,
    } = req.body;

    // Find linked User
    const teacherUser = await User.findOne({
      _id: teacher.userId,
      instituteId: req.tenantId,
      role: "TEACHER",
      isDeleted: false,
    });

    if (!teacherUser) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    // Update email only if provided and changed
    if (email !== undefined) {
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        return res.status(400).json({
          success: false,
          message: "Email cannot be empty",
        });
      }

      if (normalizedEmail !== teacherUser.email) {
        const existingUser = await User.findOne({
          email: normalizedEmail,
          _id: { $ne: teacherUser._id },
        });

        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: "Email already exists",
          });
        }

        teacherUser.email = normalizedEmail;
      }
    }

    // Update User fields
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty",
        });
      }

      teacherUser.name = name.trim();
    }

    if (phone !== undefined) {
      teacherUser.phone = phone ? phone.trim() : null;
    }

    // Update Teacher fields
    if (employeeId !== undefined) {
      const normalizedEmployeeId = employeeId
        ? employeeId.trim().toUpperCase()
        : null;

      if (normalizedEmployeeId && normalizedEmployeeId !== teacher.employeeId) {
        const existingEmployee = await Teacher.findOne({
          instituteId: req.tenantId,
          employeeId: normalizedEmployeeId,
          isDeleted: false,
          _id: { $ne: teacher._id },
        });

        if (existingEmployee) {
          return res.status(409).json({
            success: false,
            message: "Employee ID already exists in this institute",
          });
        }
      }

      teacher.employeeId = normalizedEmployeeId;
    }

    if (qualification !== undefined) {
      teacher.qualification = qualification
        ? qualification.trim()
        : null;
    }

    if (specialization !== undefined) {
      teacher.specialization = specialization
        ? specialization.trim()
        : null;
    }

    if (experienceYears !== undefined) {
      teacher.experienceYears = experienceYears;
    }

    if (joiningDate !== undefined) {
      teacher.joiningDate = joiningDate || null;
    }

    if (subjects !== undefined) {
      if (!Array.isArray(subjects)) {
        return res.status(400).json({
          success: false,
          message: "Subjects must be an array",
        });
      }

      teacher.subjects = subjects;
    }

    if (bio !== undefined) {
      teacher.bio = bio ? bio.trim() : null;
    }

    if (salary !== undefined) {
      teacher.salary = salary;
    }

    if (employmentType !== undefined) {
      const allowedEmploymentTypes = [
        "FULL_TIME",
        "PART_TIME",
        "CONTRACT",
        "VISITING",
      ];

      if (!allowedEmploymentTypes.includes(employmentType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid employment type",
        });
      }

      teacher.employmentType = employmentType;
    }

    await teacherUser.save();
    await teacher.save();

    return res.status(200).json({
      success: true,
      message: "Teacher updated successfully",
      data: {
        user: {
          id: teacherUser._id,
          name: teacherUser.name,
          email: teacherUser.email,
          phone: teacherUser.phone,
          role: teacherUser.role,
          instituteId: teacherUser.instituteId,
          accountStatus: teacherUser.accountStatus,
          isActive: teacherUser.isActive,
        },
        teacher: {
          id: teacher._id,
          employeeId: teacher.employeeId,
          qualification: teacher.qualification,
          specialization: teacher.specialization,
          experienceYears: teacher.experienceYears,
          joiningDate: teacher.joiningDate,
          subjects: teacher.subjects,
          bio: teacher.bio,
          salary: teacher.salary,
          employmentType: teacher.employmentType,
          status: teacher.status,
        },
      },
    });
  } catch (error) {
    console.error("Update Teacher Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update teacher",
    });
  }
};


const toggleTeacherStatus = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const teacherUser = await User.findOne({
      _id: teacher.userId,
      instituteId: req.tenantId,
      role: "TEACHER",
      isDeleted: false,
    });

    if (!teacherUser) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    const newIsActive = !teacherUser.isActive;

    teacherUser.isActive = newIsActive;
    teacherUser.accountStatus = newIsActive ? "ACTIVE" : "SUSPENDED";

    teacher.status = newIsActive ? "ACTIVE" : "INACTIVE";

    await teacherUser.save();
    await teacher.save();

    return res.status(200).json({
      success: true,
      message: newIsActive
        ? "Teacher activated successfully"
        : "Teacher deactivated successfully",
      data: {
        teacherId: teacher._id,
        isActive: teacherUser.isActive,
        accountStatus: teacherUser.accountStatus,
        status: teacher.status,
      },
    });
  } catch (error) {
    console.error("Toggle Teacher Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to change teacher status",
    });
  }
};


const deleteTeacher = async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    const teacherUser = await User.findOne({
      _id: teacher.userId,
      instituteId: req.tenantId,
      role: "TEACHER",
      isDeleted: false,
    });

    if (!teacherUser) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    // Soft delete user account
    teacherUser.isDeleted = true;
    teacherUser.isActive = false;
    teacherUser.accountStatus = "SUSPENDED";

    // Soft delete teacher profile
    teacher.isDeleted = true;
    teacher.status = "TERMINATED";

    await teacherUser.save();
    await teacher.save();

    return res.status(200).json({
      success: true,
      message: "Teacher deleted successfully",
      data: {
        teacherId: teacher._id,
        userId: teacherUser._id,
        isDeleted: true,
        accountStatus: teacherUser.accountStatus,
        isActive: teacherUser.isActive,
        status: teacher.status,
      },
    });
  } catch (error) {
    console.error("Delete Teacher Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete teacher",
    });
  }
};


const resetTeacherPassword = async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { newPassword } = req.body;

    // Validate password
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: "New password is required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    // Tenant must exist
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    // Find teacher only inside logged-in admin's institute
    const teacher = await Teacher.findOne({
      _id: teacherId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: "Teacher not found",
      });
    }

    // Find linked teacher user
    const teacherUser = await User.findOne({
      _id: teacher.userId,
      instituteId: req.tenantId,
      role: "TEACHER",
      isDeleted: false,
    }).select("+password");

    if (!teacherUser) {
      return res.status(404).json({
        success: false,
        message: "Teacher user account not found",
      });
    }

    // Do not reset password of inactive/suspended teacher
    if (!teacherUser.isActive || teacherUser.accountStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Cannot reset password for an inactive teacher",
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    teacherUser.password = hashedPassword;

    await teacherUser.save();

    return res.status(200).json({
      success: true,
      message: "Teacher password reset successfully",
    });
  } catch (error) {
    console.error("Reset Teacher Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reset teacher password",
    });
  }
};




module.exports = {
  createTeacher,
  getTeachers,
  getTeacherById,
  updateTeacher,
  toggleTeacherStatus,
  deleteTeacher,
  resetTeacherPassword,
};