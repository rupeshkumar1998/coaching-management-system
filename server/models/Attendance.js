const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    // Teacher whose attendance is being recorded
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
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

    // Attendance date
    date: {
      type: Date,
      required: true,
    },

    attendanceDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
},
    

    // Attendance status
    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "LATE"],
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

// Prevent duplicate attendance for the same teacher,
// institute and date.
// attendanceSchema.index(
//   { instituteId: 1, teacherId: 1, date: 1 },
//   { 
//     unique: true,
//     partialFilterExpression: {
//       isDeleted: false,
//     },
//   }
// );
attendanceSchema.index(
  {
    instituteId: 1,
    teacherId: 1,
    attendanceDate: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
    },
  }
);

const Attendance = mongoose.model("Attendance", attendanceSchema);

module.exports = Attendance;