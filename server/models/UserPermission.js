const mongoose = require("mongoose");

const userPermissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },

    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: [true, "Institute ID is required"],
      index: true,
    },

    permissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Permission",
      required: [true, "Permission ID is required"],
      index: true,
    },

    grantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Granted by user ID is required"],
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index taaki ek user ko ek hi institute mein ek permission baar-baar na mile
userPermissionSchema.index(
  { userId: 1, instituteId: 1, permissionId: 1 },
  { unique: true }
);

const UserPermission = mongoose.model(
  "UserPermission",
  userPermissionSchema
);

module.exports = UserPermission;