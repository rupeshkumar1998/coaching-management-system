// const Permission = require("../models/Permission");
// const PERMISSION_CATALOG = require("../constants/permissionCatalog");

// const seedPermissions = async () => {
//   const results = {
//     created: 0,
//     updated: 0,
//     unchanged: 0,
//   };

//   for (const permissionData of PERMISSION_CATALOG) {
//     const existingPermission = await Permission.findOne({
//       permissionKey: permissionData.permissionKey,
//     });

//     if (!existingPermission) {
//       await Permission.create(permissionData);
//       results.created += 1;
//       continue;
//     }

//     const hasChanges =
//       existingPermission.resource !== permissionData.resource ||
//       existingPermission.action !== permissionData.action ||
//       existingPermission.category !== permissionData.category ||
//       existingPermission.description !== permissionData.description ||
//       existingPermission.isDelegatable !== permissionData.isDelegatable;

//     if (hasChanges) {
//       existingPermission.resource = permissionData.resource;
//       existingPermission.action = permissionData.action;
//       existingPermission.category = permissionData.category;
//       existingPermission.description = permissionData.description;
//       existingPermission.isDelegatable = permissionData.isDelegatable;

//       await existingPermission.save();
//       results.updated += 1;
//     } else {
//       results.unchanged += 1;
//     }
//   }

//   return results;
// };

// const getPermissionByKey = async (permissionKey) => {
//   return Permission.findOne({
//     permissionKey,
//     isActive: true,
//   });
// };

// const getAllActivePermissions = async () => {
//   return Permission.find({
//     isActive: true,
//   }).sort({
//     resource: 1,
//     action: 1,
//   });
// };

// module.exports = {
//   seedPermissions,
//   getPermissionByKey,
//   getAllActivePermissions,
// };


const mongoose = require("mongoose");

const Permission = require("../models/Permission");
const User = require("../models/User");
const UserPermission = require("../models/UserPermission");
const PERMISSION_CATALOG = require("../constants/permissionCatalog");

const {
  canOwnerDelegatePermission,
  isOwner,
} = require("../constants/permissionRolePolicy");

// const {
//   canOwnerDelegatePermission,
//   isOwner,
// } = require("../constants/permissionRolePolicy");



const seedPermissions = async () => {
  const results = {
    created: 0,
    updated: 0,
    unchanged: 0,
  };

  for (const permissionData of PERMISSION_CATALOG) {
    const existingPermission = await Permission.findOne({
      permissionKey: permissionData.permissionKey,
    });

    if (!existingPermission) {
      await Permission.create(permissionData);
      results.created += 1;
      continue;
    }

    const hasChanges =
      existingPermission.resource !== permissionData.resource ||
      existingPermission.action !== permissionData.action ||
      existingPermission.category !== permissionData.category ||
      existingPermission.description !== permissionData.description ||
      existingPermission.isDelegatable !== permissionData.isDelegatable;

    if (hasChanges) {
      existingPermission.resource = permissionData.resource;
      existingPermission.action = permissionData.action;
      existingPermission.category = permissionData.category;
      existingPermission.description = permissionData.description;
      existingPermission.isDelegatable = permissionData.isDelegatable;

      await existingPermission.save();
      results.updated += 1;
    } else {
      results.unchanged += 1;
    }
  }

  return results;
};

const getPermissionByKey = async (permissionKey) => {
  return Permission.findOne({
    permissionKey,
    isActive: true,
  });
};

const getAllActivePermissions = async () => {
  return Permission.find({
    isActive: true,
  }).sort({
    resource: 1,
    action: 1,
  });
};

/*
 * Validate whether a permission can be assigned.
 *
 * This function only validates the permission itself.
 * Authorization of the person performing the assignment
 * will be handled later by controller/middleware.
 */
const validateDelegatablePermission = async (permissionKey) => {
  const permission = await Permission.findOne({
    permissionKey,
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  if (!permission.isActive) {
    throw new Error("Permission is inactive");
  }

  if (!permission.isDelegatable) {
    throw new Error("Permission cannot be delegated");
  }

  return permission;
};

/*
 * Verify that the target user is an active Institute Admin
 * belonging to the requested institute.
 */
const validateAdminForInstitute = async (userId, instituteId) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId)
  ) {
    throw new Error("Invalid user ID or institute ID");
  }

  const user = await User.findOne({
    _id: userId,
    instituteId,
    role: "INSTITUTE_ADMIN",
    isDeleted: false,
  });

  if (!user) {
    throw new Error(
      "Target user is not a valid Institute Admin for this institute"
    );
  }

  if (!user.isActive || user.accountStatus !== "ACTIVE") {
    throw new Error("Target Institute Admin is not active");
  }

  return user;
};


/*
 * Verify that the target user is an active Teacher
 * belonging to the requested institute.
 */
const validateTeacherForInstitute = async (userId, instituteId) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId)
  ) {
    throw new Error("Invalid user ID or institute ID");
  }

  const user = await User.findOne({
    _id: userId,
    instituteId,
    role: "TEACHER",
    isDeleted: false,
  });

  if (!user) {
    throw new Error(
      "Target user is not a valid Teacher for this institute"
    );
  }

  if (!user.isActive || user.accountStatus !== "ACTIVE") {
    throw new Error("Target Teacher is not active");
  }

  return user;
};

/*
 * Grant one permission to one Institute Admin.
 */
// const grantPermissionToAdmin = async ({
//   userId,
//   instituteId,
//   permissionKey,
//   grantedBy,
// }) => {
//   if (
//     !mongoose.Types.ObjectId.isValid(userId) ||
//     !mongoose.Types.ObjectId.isValid(instituteId) ||
//     !mongoose.Types.ObjectId.isValid(grantedBy)
//   ) {
//     throw new Error("Invalid user, institute, or grantor ID");
//   }

//   const admin = await validateAdminForInstitute(
//     userId,
//     instituteId
//   );

//   const permission = await validateDelegatablePermission(
//     permissionKey
//   );

//   const existingAssignment = await UserPermission.findOne({
//     userId: admin._id,
//     instituteId,
//     permissionId: permission._id,
//   });

//   if (existingAssignment) {
//     if (existingAssignment.isActive) {
//       throw new Error("Permission is already assigned");
//     }

//     existingAssignment.isActive = true;
//     existingAssignment.grantedBy = grantedBy;

//     await existingAssignment.save();

//     return {
//       assignment: existingAssignment,
//       action: "REACTIVATED",
//     };
//   }

//   const assignment = await UserPermission.create({
//     userId: admin._id,
//     instituteId,
//     permissionId: permission._id,
//     grantedBy,
//     isActive: true,
//   });

//   return {
//     assignment,
//     action: "GRANTED",
//   };
// };

const grantPermissionToAdmin = async ({
  userId,
  instituteId,
  permissionKey,
  grantedBy,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId) ||
    !mongoose.Types.ObjectId.isValid(grantedBy)
  ) {
    throw new Error("Invalid user, institute, or grantor ID");
  }

  // Grantor must be an Institute Owner
  const grantor = await User.findOne({
    _id: grantedBy,
    instituteId,
    role: "INSTITUTE_OWNER",
    isDeleted: false,
  });

  if (!grantor) {
    throw new Error(
      "Only the Institute Owner can grant permissions"
    );
  }

  if (
    !grantor.isActive ||
    grantor.accountStatus !== "ACTIVE"
  ) {
    throw new Error(
      "Institute Owner account is not active"
    );
  }

  // Target must be an Admin of the same institute
  const admin = await validateAdminForInstitute(
    userId,
    instituteId
  );

  const permission = await Permission.findOne({
    permissionKey: permissionKey.toUpperCase(),
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  // // Owner cannot delegate platform/non-delegatable permissions
  // if (!canOwnerDelegatePermission(permission)) {
  //   throw new Error(
  //     "This permission cannot be delegated"
  //   );
  // }
  // Reject inactive permissions with a specific error first.
  if (!permission.isActive) {
    throw new Error("Permission is inactive");
  }
  // Owners cannot delegate platform/non-delegatable permissions.
  if (!canOwnerDelegatePermission(permission)) {
    throw new Error("This permission cannot be delegated");
  }

  const existingAssignment =
    await UserPermission.findOne({
      userId: admin._id,
      instituteId,
      permissionId: permission._id,
    });

  if (existingAssignment) {
    if (existingAssignment.isActive) {
      throw new Error(
        "Permission is already assigned"
      );
    }

    existingAssignment.isActive = true;
    existingAssignment.grantedBy = grantor._id;

    await existingAssignment.save();

    return {
      assignment: existingAssignment,
      action: "REACTIVATED",
    };
  }

  const assignment = await UserPermission.create({
    userId: admin._id,
    instituteId,
    permissionId: permission._id,
    grantedBy: grantor._id,
    isActive: true,
  });

  return {
    assignment,
    action: "GRANTED",
  };
};


/*
 * Grant one ATTENDANCE permission to one Teacher.
 *
 * Defense-in-depth: even if a non-ATTENDANCE permission
 * is passed, this function refuses to create the mapping.
 */
const grantPermissionToTeacher = async ({
  userId,
  instituteId,
  permissionKey,
  grantedBy,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId) ||
    !mongoose.Types.ObjectId.isValid(grantedBy)
  ) {
    throw new Error("Invalid user, institute, or grantor ID");
  }

  const grantor = await User.findOne({
    _id: grantedBy,
    instituteId,
    role: "INSTITUTE_OWNER",
    isDeleted: false,
  });

  if (!grantor) {
    throw new Error("Only the Institute Owner can grant permissions");
  }

  if (!grantor.isActive || grantor.accountStatus !== "ACTIVE") {
    throw new Error("Institute Owner account is not active");
  }

  const teacher = await validateTeacherForInstitute(
    userId,
    instituteId
  );

  const permission = await Permission.findOne({
    permissionKey: permissionKey.toUpperCase(),
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  if (permission.resource !== "ATTENDANCE") {
    throw new Error(
      "Teachers can only be assigned attendance permissions"
    );
  }

  if (!permission.isActive) {
    throw new Error("Permission is inactive");
  }

  if (!canOwnerDelegatePermission(permission)) {
    throw new Error("This permission cannot be delegated");
  }

  const existingAssignment = await UserPermission.findOne({
    userId: teacher._id,
    instituteId,
    permissionId: permission._id,
  });

  if (existingAssignment) {
    if (existingAssignment.isActive) {
      throw new Error("Permission is already assigned");
    }

    existingAssignment.isActive = true;
    existingAssignment.grantedBy = grantor._id;

    await existingAssignment.save();

    return {
      assignment: existingAssignment,
      action: "REACTIVATED",
    };
  }

  const assignment = await UserPermission.create({
    userId: teacher._id,
    instituteId,
    permissionId: permission._id,
    grantedBy: grantor._id,
    isActive: true,
  });

  return {
    assignment,
    action: "GRANTED",
  };
};

/*
 * Revoke one permission from one Institute Admin.
 *
 * We use soft revocation by setting isActive=false.
 * The historical assignment record remains available.
 */
// const revokePermissionFromAdmin = async ({
//   userId,
//   instituteId,
//   permissionKey,
// }) => {
//   if (
//     !mongoose.Types.ObjectId.isValid(userId) ||
//     !mongoose.Types.ObjectId.isValid(instituteId)
//   ) {
//     throw new Error("Invalid user ID or institute ID");
//   }

//   const admin = await validateAdminForInstitute(
//     userId,
//     instituteId
//   );

//   const permission = await Permission.findOne({
//     permissionKey,
//   });

//   if (!permission) {
//     throw new Error("Permission not found");
//   }

//   const assignment = await UserPermission.findOne({
//     userId: admin._id,
//     instituteId,
//     permissionId: permission._id,
//   });

//   if (!assignment) {
//     throw new Error("Permission assignment not found");
//   }

//   if (!assignment.isActive) {
//     throw new Error("Permission is already revoked");
//   }

//   assignment.isActive = false;

//   await assignment.save();

//   return assignment;
// };
const revokePermissionFromAdmin = async ({
  userId,
  instituteId,
  permissionKey,
  revokedBy,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId) ||
    !mongoose.Types.ObjectId.isValid(revokedBy)
  ) {
    throw new Error(
      "Invalid user, institute, or revoker ID"
    );
  }

  // Only Institute Owner can revoke permissions
  const revoker = await User.findOne({
    _id: revokedBy,
    instituteId,
    role: "INSTITUTE_OWNER",
    isDeleted: false,
  });

  if (!revoker) {
    throw new Error(
      "Only the Institute Owner can revoke permissions"
    );
  }

  if (
    !revoker.isActive ||
    revoker.accountStatus !== "ACTIVE"
  ) {
    throw new Error(
      "Institute Owner account is not active"
    );
  }

  const admin = await validateAdminForInstitute(
    userId,
    instituteId
  );

  const permission = await Permission.findOne({
    permissionKey: permissionKey.toUpperCase(),
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  const assignment = await UserPermission.findOne({
    userId: admin._id,
    instituteId,
    permissionId: permission._id,
  });

  if (!assignment) {
    throw new Error(
      "Permission assignment not found"
    );
  }

  if (!assignment.isActive) {
    throw new Error(
      "Permission is already revoked"
    );
  }

  assignment.isActive = false;

  await assignment.save();

  return assignment;
};


/*
 * Revoke one ATTENDANCE permission from one Teacher.
 * Soft revocation via isActive=false.
 */
const revokePermissionFromTeacher = async ({
  userId,
  instituteId,
  permissionKey,
  revokedBy,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId) ||
    !mongoose.Types.ObjectId.isValid(revokedBy)
  ) {
    throw new Error("Invalid user, institute, or revoker ID");
  }

  const revoker = await User.findOne({
    _id: revokedBy,
    instituteId,
    role: "INSTITUTE_OWNER",
    isDeleted: false,
  });

  if (!revoker) {
    throw new Error("Only the Institute Owner can revoke permissions");
  }

  if (!revoker.isActive || revoker.accountStatus !== "ACTIVE") {
    throw new Error("Institute Owner account is not active");
  }

  const teacher = await validateTeacherForInstitute(
    userId,
    instituteId
  );

  const permission = await Permission.findOne({
    permissionKey: permissionKey.toUpperCase(),
  });

  if (!permission) {
    throw new Error("Permission not found");
  }

  if (permission.resource !== "ATTENDANCE") {
    throw new Error(
      "Teachers can only have attendance permissions"
    );
  }

  const assignment = await UserPermission.findOne({
    userId: teacher._id,
    instituteId,
    permissionId: permission._id,
  });

  if (!assignment) {
    throw new Error("Permission assignment not found");
  }

  if (!assignment.isActive) {
    throw new Error("Permission is already revoked");
  }

  assignment.isActive = false;

  await assignment.save();

  return assignment;
};


/*
 * Get all active permissions assigned to an Institute Admin.
 */
const getAdminPermissions = async ({
  userId,
  instituteId,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId)
  ) {
    throw new Error("Invalid user ID or institute ID");
  }

  const admin = await validateAdminForInstitute(
    userId,
    instituteId
  );

  return UserPermission.find({
    userId: admin._id,
    instituteId,
    isActive: true,
  })
    .populate({
      path: "permissionId",
      match: {
        isActive: true,
      },
    })
    .populate({
      path: "grantedBy",
      select: "name email role",
    })
    .sort({
      createdAt: -1,
    });
};


const getEffectivePermissions = async ({
  userId,
  instituteId,
}) => {
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !mongoose.Types.ObjectId.isValid(instituteId)
  ) {
    throw new Error(
      "Invalid user ID or institute ID"
    );
  }

  const user = await User.findOne({
    _id: userId,
    instituteId,
    isDeleted: false,
  });

  if (!user) {
    throw new Error(
      "User does not belong to this institute"
    );
  }

  if (
    !user.isActive ||
    user.accountStatus !== "ACTIVE"
  ) {
    throw new Error(
      "User account is not active"
    );
  }

  // Owner gets all active non-platform permissions
  if (isOwner(user)) {
    return Permission.find({
      isActive: true,
      category: {
        $ne: "PLATFORM",
      },
    }).sort({
      resource: 1,
      action: 1,
    });
  }

  // Admin gets only explicitly assigned permissions
  if (user.role === "INSTITUTE_ADMIN") {
    const assignments = await UserPermission.find({
      userId: user._id,
      instituteId,
      isActive: true,
    })
      .populate({
        path: "permissionId",
        match: {
          isActive: true,
          category: {
            $ne: "PLATFORM",
          },
        },
      })
      .sort({
        createdAt: -1,
      });

    return assignments
      .filter((assignment) => assignment.permissionId)
      .map((assignment) => assignment.permissionId);
  }

  // Teacher gets only ATTENDANCE resource permissions
  if (user.role === "TEACHER") {
    const assignments = await UserPermission.find({
      userId: user._id,
      instituteId,
      isActive: true,
    })
      .populate({
        path: "permissionId",
        match: {
          isActive: true,
          resource: "ATTENDANCE",
          category: {
            $ne: "PLATFORM",
          },
        },
      })
      .sort({
        createdAt: -1,
      });

    return assignments
      .filter((assignment) => assignment.permissionId)
      .map((assignment) => assignment.permissionId);
  }

  return [];
};




module.exports = {
  seedPermissions,
  getPermissionByKey,
  getAllActivePermissions,
  validateDelegatablePermission,
  validateAdminForInstitute,
  validateTeacherForInstitute,
  grantPermissionToAdmin,
  grantPermissionToTeacher,
  revokePermissionFromAdmin,
  revokePermissionFromTeacher,
  getAdminPermissions,
  getEffectivePermissions,
};
