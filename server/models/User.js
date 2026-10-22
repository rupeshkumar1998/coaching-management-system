const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      default: null,
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      default: null,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },

    role: {
      type: String,
      required: true,
      enum: [
        "SUPER_ADMIN",
        "INSTITUTE_OWNER",
        "INSTITUTE_ADMIN",
        "TEACHER",
        "STUDENT",
        "PARENT",
      ],
    },

    profileImage: {
      type: String,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: false,
    },

    accountStatus: {
  type: String,
  enum: [
    "PENDING",
    "ACTIVE",
    "SUSPENDED",
    "REJECTED",
  ],
  default: "PENDING",
},

    isDeleted: {
      type: Boolean,
      default: false,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

module.exports = User;