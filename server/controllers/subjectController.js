// const mongoose = require("mongoose");
// const Subject = require("../models/Subject");

// const isValidObjectId = (id) => {
//   return mongoose.Types.ObjectId.isValid(id);
// };

// // Create Subject
// const createSubject = async (req, res) => {
//   try {
//     const { name, code, description } = req.body;

//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     if (!name || typeof name !== "string" || name.trim().length < 2) {
//       return res.status(400).json({
//         success: false,
//         message: "Subject name must contain at least 2 characters",
//       });
//     }

//     if (!code || typeof code !== "string" || code.trim().length < 2) {
//       return res.status(400).json({
//         success: false,
//         message: "Subject code must contain at least 2 characters",
//       });
//     }

//     if (
//       description !== undefined &&
//       description !== null &&
//       typeof description !== "string"
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Description must be a string",
//       });
//     }

//     const normalizedName = name.trim();
//     const normalizedCode = code.trim().toUpperCase();

//     const existingSubject = await Subject.findOne({
//       instituteId: req.tenantId,
//       $or: [
//         { name: normalizedName, isDeleted: false },
//         { code: normalizedCode, isDeleted: false },
//       ],
//     });

//     if (existingSubject) {
//       return res.status(409).json({
//         success: false,
//         message: "Subject with same name or code already exists",
//       });
//     }

//     const subject = await Subject.create({
//       instituteId: req.tenantId,
//       name: normalizedName,
//       code: normalizedCode,
//       description:
//         description === undefined || description === null
//           ? null
//           : description.trim() || null,
//       createdBy: req.user._id,
//     });

//     return res.status(201).json({
//       success: true,
//       message: "Subject created successfully",
//       data: {
//         subject,
//       },
//     });
//   } catch (error) {
//     if (error.code === 11000) {
//       return res.status(409).json({
//         success: false,
//         message: "Subject with same name or code already exists",
//       });
//     }

//     console.error("Create subject error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

// // Get Subjects
// const getSubjects = async (req, res) => {
//   try {
//     if (!req.tenantId) {
//       return res.status(403).json({
//         success: false,
//         message: "Institute association is missing",
//       });
//     }

//     const subjects = await Subject.find({
//       instituteId: req.tenantId,
//       isDeleted: false,
//     })
//       .sort({ name: 1 })
//       .lean();

//     return res.status(200).json({
//       success: true,
//       message: "Subjects fetched successfully",
//       count: subjects.length,
//       data: {
//         subjects,
//       },
//     });
//   } catch (error) {
//     console.error("Get subjects error:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//     });
//   }
// };

// module.exports = {
//   createSubject,
//   getSubjects,
// };
const mongoose = require("mongoose");
const Subject = require("../models/Subject");

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Create Subject
const createSubject = async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Subject name must contain at least 2 characters",
      });
    }

    if (!code || typeof code !== "string" || code.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Subject code must contain at least 2 characters",
      });
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Description must be a string",
      });
    }

    const normalizedName = name.trim();
    const normalizedCode = code.trim().toUpperCase();

    const existingSubject = await Subject.findOne({
      instituteId: req.tenantId,
      isDeleted: false,
      $or: [
        { name: normalizedName },
        { code: normalizedCode },
      ],
    });

    if (existingSubject) {
      return res.status(409).json({
        success: false,
        message: "Subject with same name or code already exists",
      });
    }

    const subject = await Subject.create({
      instituteId: req.tenantId,
      name: normalizedName,
      code: normalizedCode,
      description:
        description === undefined || description === null
          ? null
          : description.trim() || null,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Subject created successfully",
      data: {
        subject,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Subject with same name or code already exists",
      });
    }

    console.error("Create subject error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Get all active subjects
const getSubjects = async (req, res) => {
  try {
    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    const subjects = await Subject.find({
      instituteId: req.tenantId,
      isDeleted: false,
      isActive: true,
    })
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Subjects fetched successfully",
      count: subjects.length,
      data: {
        subjects,
      },
    });
  } catch (error) {
    console.error("Get subjects error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Get single subject
const getSubjectById = async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subjectId",
      });
    }

    const subject = await Subject.findOne({
      _id: subjectId,
      instituteId: req.tenantId,
      isDeleted: false,
    }).lean();

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject fetched successfully",
      data: {
        subject,
      },
    });
  } catch (error) {
    console.error("Get subject by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Update subject
const updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { name, code, description } = req.body;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subjectId",
      });
    }

    if (name === undefined && code === undefined && description === undefined) {
      return res.status(400).json({
        success: false,
        message: "At least one field is required for update",
      });
    }

    const updateData = {
      updatedBy: req.user._id,
    };

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Subject name must contain at least 2 characters",
        });
      }

      updateData.name = name.trim();
    }

    if (code !== undefined) {
      if (typeof code !== "string" || code.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Subject code must contain at least 2 characters",
        });
      }

      updateData.code = code.trim().toUpperCase();
    }

    if (description !== undefined) {
      if (description !== null && typeof description !== "string") {
        return res.status(400).json({
          success: false,
          message: "Description must be a string or null",
        });
      }

      updateData.description =
        description === null ? null : description.trim() || null;
    }

    const existingSubject = await Subject.findOne({
      _id: subjectId,
      instituteId: req.tenantId,
      isDeleted: false,
    });

    if (!existingSubject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found",
      });
    }

    const duplicateSubject = await Subject.findOne({
      _id: { $ne: subjectId },
      instituteId: req.tenantId,
      isDeleted: false,
      $or: [
        ...(updateData.name ? [{ name: updateData.name }] : []),
        ...(updateData.code ? [{ code: updateData.code }] : []),
      ],
    });

    if (duplicateSubject) {
      return res.status(409).json({
        success: false,
        message: "Subject with same name or code already exists",
      });
    }

    const updatedSubject = await Subject.findOneAndUpdate(
      {
        _id: subjectId,
        instituteId: req.tenantId,
        isDeleted: false,
      },
      {
        $set: updateData,
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    return res.status(200).json({
      success: true,
      message: "Subject updated successfully",
      data: {
        subject: updatedSubject,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Subject with same name or code already exists",
      });
    }

    console.error("Update subject error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Activate subject
const activateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subjectId",
      });
    }

    const subject = await Subject.findOneAndUpdate(
      {
        _id: subjectId,
        instituteId: req.tenantId,
        isDeleted: false,
      },
      {
        $set: {
          isActive: true,
          updatedBy: req.user._id,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject activated successfully",
      data: {
        subject,
      },
    });
  } catch (error) {
    console.error("Activate subject error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Deactivate subject
const deactivateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subjectId",
      });
    }

    const subject = await Subject.findOneAndUpdate(
      {
        _id: subjectId,
        instituteId: req.tenantId,
        isDeleted: false,
      },
      {
        $set: {
          isActive: false,
          updatedBy: req.user._id,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject deactivated successfully",
      data: {
        subject,
      },
    });
  } catch (error) {
    console.error("Deactivate subject error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Soft delete subject
const deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { deleteReason } = req.body || {};

    if (!req.tenantId) {
      return res.status(403).json({
        success: false,
        message: "Institute association is missing",
      });
    }

    if (!isValidObjectId(subjectId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subjectId",
      });
    }

    if (
      deleteReason !== undefined &&
      deleteReason !== null &&
      typeof deleteReason !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Delete reason must be a string",
      });
    }

    const subject = await Subject.findOneAndUpdate(
      {
        _id: subjectId,
        instituteId: req.tenantId,
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          isActive: false,
          deletedBy: req.user._id,
          deletedAt: new Date(),
          deleteReason:
            deleteReason === undefined || deleteReason === null
              ? null
              : deleteReason.trim() || null,
          updatedBy: req.user._id,
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
      }
    ).lean();

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: "Subject not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Subject deleted successfully",
      data: {
        subject,
      },
    });
  } catch (error) {
    console.error("Delete subject error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

module.exports = {
  createSubject,
  getSubjects,
  getSubjectById,
  updateSubject,
  activateSubject,
  deactivateSubject,
  deleteSubject,
};