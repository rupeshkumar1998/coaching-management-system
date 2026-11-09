const mongoose = require("mongoose");

// =========================================================
// 32.16.16 — Class Model
//
// Represents a class within an institute (e.g., "Class 10",
// "Class 12 Science", "JEE Batch Group").
//
// A Class is the parent container for Batches (Sprint 2).
//
// Design decisions:
//   - `name` is unique per institute (excluding deleted)
//   - `capacity` is informational only (MAX_STUDENTS limit
//     is separate and enforced at enrollment time)
//   - `sortOrder` allows custom display order (Class 1, 2, 3
//     not alphabetical)
//   - `isActive` allows disabling without deletion
//   - `isDeleted` for soft-delete; hard delete blocked
//   - Delete protection preserves history
// =========================================================

const classSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      immutable: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, "Class name must be at least 2 characters"],
      maxlength: [100, "Class name cannot exceed 100 characters"],
    },

    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
      default: "",
    },

    classTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Informational hint for UI: how many students can fit.
    // Does not enforce MAX_STUDENTS.
    capacity: {
      type: Number,
      min: [1, "Capacity must be at least 1"],
      validate: {
        validator: function (value) {
          return (
            value === null ||
            value === undefined ||
            Number.isSafeInteger(value)
          );
        },
        message: "Capacity must be a positive safe integer or null",
      },
      default: null,
    },

    // For custom display order (e.g., Class 1 → Class 10)
    sortOrder: {
      type: Number,
      default: 0,
      validate: {
        validator: function (value) {
          return Number.isSafeInteger(value);
        },
        message: "sortOrder must be a safe integer",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    strict: "throw",
  }
);

// ---------------------------------------------------------
// Indexes
// ---------------------------------------------------------

// Class name unique per institute (excluding deleted records)
classSchema.index(
  { instituteId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_class_name_per_institute",
  }
);

// Fast active listing
classSchema.index({
  instituteId: 1,
  isActive: 1,
  isDeleted: 1,
});

// Ordered listing
classSchema.index({
  instituteId: 1,
  sortOrder: 1,
  name: 1,
});

// ---------------------------------------------------------
// Delete protection — preserve history
// ---------------------------------------------------------

const rejectClassDelete = function () {
  throw new Error(
    "Classes cannot be deleted; use isActive=false instead"
  );
};

classSchema.pre(
  "deleteOne",
  { query: true, document: false },
  rejectClassDelete
);
classSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectClassDelete
);
classSchema.pre("deleteMany", rejectClassDelete);
classSchema.pre("findOneAndDelete", rejectClassDelete);

// ---------------------------------------------------------
// Model export
// ---------------------------------------------------------

const Class =
  mongoose.models.Class ||
  mongoose.model("Class", classSchema);

module.exports = Class;