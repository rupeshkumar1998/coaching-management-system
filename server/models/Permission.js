const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
  {
    permissionKey: {
      type: String,
      required: [true, "Permission key is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },

    resource: {
      type: String,
      required: [true, "Resource is required"],
      trim: true,
    },

    action: {
      type: String,
      required: [true, "Action is required"],
      trim: true,
    },

    category: {
      type: String,
      required: [true, "Permission category is required"],
      enum: ["OPERATIONAL", "SENSITIVE", "PLATFORM"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
      default: "",
    },

    isDelegatable: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Permission = mongoose.model("Permission", permissionSchema);

module.exports = Permission;
