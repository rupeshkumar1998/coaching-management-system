const mongoose = require("mongoose");

const teacherSchema = new mongoose.Schema(
  {
    // Link with User account
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Multi-tenant isolation
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },

    employeeId: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 50,
      default: null,
    },

    qualification: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    specialization: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
    },

    experienceYears: {
      type: Number,
      min: 0,
      max: 60,
      default: 0,
    },

    joiningDate: {
      type: Date,
      default: null,
    },

    subjects: [
      {
        type: String,
        trim: true,
        maxlength: 100,
      },
    ],

    bio: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },

    salary: {
      type: Number,
      min: 0,
      default: null,
    },

    employmentType: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT", "VISITING"],
      default: "FULL_TIME",
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "ON_LEAVE", "TERMINATED"],
      default: "ACTIVE",
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Important for tenant isolation
teacherSchema.index(
  { instituteId: 1, employeeId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employeeId: { $type: "string" },
    },
  }
);

const Teacher = mongoose.model("Teacher", teacherSchema);

module.exports = Teacher;