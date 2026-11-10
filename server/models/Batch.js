const mongoose = require("mongoose");

// =========================================================
// 32.16.16 — Batch Model
//
// A Batch belongs to exactly one Class (immutable).
// Batches can have multiple subject teachers.
// Schedule is optional (can be added later).
//
// Design decisions (Sprint 2):
//   - classId: immutable (moving a batch changes history)
//   - teachers: same teacher may teach multiple subjects
//     in the same batch ({teacherId, subject} combined must be unique)
//   - schedule: optional; when present, validated strictly
//   - name: unique per class (not per institute)
//   - isActive replaced by status: ACTIVE | INACTIVE
//   - Delete protection: hard delete blocked, use status instead
// =========================================================

const VALID_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const batchTeacherSchema = new mongoose.Schema(
  {
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: [2, "Subject must be at least 2 characters"],
      maxlength: [100, "Subject cannot exceed 100 characters"],
    },
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    days: {
      type: [{ type: String, enum: VALID_DAYS }],
      required: true,
      validate: {
        validator: (v) =>
          Array.isArray(v) && v.length >= 1 && v.length <= 7,
        message: "Schedule must have 1-7 days",
      },
    },
    startTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be HH:MM"],
    },
    endTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be HH:MM"],
    },
  },
  { _id: false }
);

const batchSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      immutable: true,
      index: true,
    },

    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
      immutable: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, "Batch name must be at least 2 characters"],
      maxlength: [100, "Batch name cannot exceed 100 characters"],
    },

    teachers: {
      type: [batchTeacherSchema],
      default: [],
    },

    schedule: {
      type: scheduleSchema,
      default: null,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
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
// Validation hooks
// ---------------------------------------------------------

batchSchema.pre("validate", function () {
  // Ensure no duplicate (teacherId, subject) combinations
  if (Array.isArray(this.teachers) && this.teachers.length > 0) {
    const seen = new Set();
    for (const entry of this.teachers) {
      if (!entry || !entry.teacherId || !entry.subject) {
        throw new Error("Each teacher entry requires teacherId and subject");
      }
      const key = `${entry.teacherId}_${String(entry.subject).toUpperCase()}`;
      if (seen.has(key)) {
        throw new Error(
          `Duplicate teacher-subject combination: ${entry.subject}`
        );
      }
      seen.add(key);
    }
  }

  // Ensure startTime < endTime
  if (this.schedule) {
    const start = this.schedule.startTime;
    const end = this.schedule.endTime;
    if (start && end && start >= end) {
      throw new Error("schedule.startTime must be before schedule.endTime");
    }
  }
});

// ---------------------------------------------------------
// Indexes
// ---------------------------------------------------------

// Batch name unique per class (excluding soft-deleted)
batchSchema.index(
  { instituteId: 1, classId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_batch_name_per_class",
  }
);

// Fast listing by class
batchSchema.index({
  instituteId: 1,
  classId: 1,
  status: 1,
  isDeleted: 1,
});

// Counter query
batchSchema.index({
  instituteId: 1,
  isDeleted: 1,
});

// ---------------------------------------------------------
// Delete protection
// ---------------------------------------------------------

const rejectBatchDelete = function () {
  throw new Error(
    "Batches cannot be deleted; use status=INACTIVE instead"
  );
};

batchSchema.pre(
  "deleteOne",
  { query: true, document: false },
  rejectBatchDelete
);
batchSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectBatchDelete
);
batchSchema.pre("deleteMany", rejectBatchDelete);
batchSchema.pre("findOneAndDelete", rejectBatchDelete);

// ---------------------------------------------------------
// Model export
// ---------------------------------------------------------

const Batch =
  mongoose.models.Batch || mongoose.model("Batch", batchSchema);

module.exports = Batch;
module.exports.VALID_DAYS = VALID_DAYS;