const mongoose = require("mongoose");

// =========================================================
// 32.16.17 ΓÇö Student Attendance Model
//
// One attendance record per student per day per institute.
//
// Design (Sprint .17.7):
//   - batchId is a snapshot (student's batch at marking time)
//   - Historical records do NOT change when student moves batch
//   - Soft delete only (isDeleted flag), no hard delete
//   - markedVia reserved for future QR (default "MANUAL")
//   - attendanceDate is the canonical business date
//   - date is a legacy compatibility field (matches teacher pattern)
// =========================================================

const studentAttendanceSchema = new mongoose.Schema(
  {
    // Student whose attendance is being recorded
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Multi-tenant isolation
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },

    // Snapshot of student's batch at marking time.
    // Immutable after create; historical record preserved.
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      index: true,
    },

    // Canonical business date (YYYY-MM-DD, India timezone)
    attendanceDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    // Legacy compatibility field (matches teacher attendance pattern)
    date: {
      type: Date,
      required: true,
    },

    // Attendance status
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LATE", "LEAVE", "HALF_DAY"],
      required: true,
    },

    // Optional remarks
    remarks: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    // User who marked/updated attendance
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // How attendance was captured (future QR integration)
    markedVia: {
      type: String,
      enum: ["MANUAL", "QR"],
      default: "MANUAL",
      required: true,
    },

    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deleteReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// One attendance per student per day per institute.
// Partial index: soft-deleted rows don't block re-marking.
studentAttendanceSchema.index(
  {
    instituteId: 1,
    studentId: 1,
    attendanceDate: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
    name: "unique_student_attendance_per_day",
  }
);

// Fast batch listing by date (batch roster queries)
studentAttendanceSchema.index(
  {
    instituteId: 1,
    batchId: 1,
    attendanceDate: 1,
    isDeleted: 1,
  },
  {
    name: "batch_date_listing",
  }
);

const StudentAttendance =
  mongoose.models.StudentAttendance ||
  mongoose.model("StudentAttendance", studentAttendanceSchema);

module.exports = StudentAttendance;