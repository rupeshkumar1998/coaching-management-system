const mongoose = require("mongoose");

// =========================================================
// 32.16.18 - Fee Model (Invoice)
//
// One fee invoice per student per cycle. Payments are recorded
// against a Fee via Payment.feeId.
//
// Design rules:
//   - studentId + batchId are snapshots (immutable after create)
//   - paidAmount is maintained by paymentService transactionally
//   - status: PENDING | PARTIAL | PAID | CANCELLED
//   - Overdue is derived (dueDate < today && status in PENDING/PARTIAL)
//   - Cannot cancel if any VERIFIED payment exists
//   - Soft delete only
// =========================================================

const FEE_STATUSES = ["PENDING", "PARTIAL", "PAID", "CANCELLED"];

const feeSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      immutable: true,
      index: true,
    },

    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    // Snapshot of student's batch at invoice creation.
    // Immutable ΓÇö student moving batch does not change past invoices.
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
      immutable: true,
      index: true,
    },

    // Snapshot of student's class (derived from batch at creation).
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Class",
      required: true,
      immutable: true,
      index: true,
    },

    // Business cycle identifier e.g. "OCT-2026", "Q3-2026"
    cycle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    // Human-readable description e.g. "Monthly tuition fee - Oct 2026"
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },

    currency: {
      type: String,
      default: "INR",
      uppercase: true,
      trim: true,
    },

    dueDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: FEE_STATUSES,
      default: "PENDING",
      required: true,
      index: true,
    },

    // Sum of VERIFIED payments. Maintained by paymentService
    // inside a transaction when recording / refunding payments.
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
    strict: "throw",
  }
);

// ---------------------------------------------------------
// Validation hooks
// ---------------------------------------------------------

feeSchema.pre("validate", function () {
  // paidAmount must not exceed amount
  // (only when amount is valid; negative amount caught by min: 0)
  if (this.amount >= 0 && this.paidAmount > this.amount) {
    throw new Error("paidAmount cannot exceed fee amount");
  }

  // Cannot cancel if any paidAmount > 0
  if (
    this.status === "CANCELLED" &&
    this.paidAmount > 0 &&
    this.isModified("status")
  ) {
    throw new Error(
      "Cannot cancel a fee that already has verified payments"
    );
  }
});

// ---------------------------------------------------------
// Immutability guards for post-creation updates
// ---------------------------------------------------------

const LOCKED_FEE_PATHS = [
  "instituteId",
  "studentId",
  "batchId",
  "classId",
  "cycle",
  "amount",
  "currency",
  "createdBy",
];

feeSchema.pre("save", function () {
  if (this.isNew) return;

  const changed = this.modifiedPaths();
  const illegal = changed.filter((f) => LOCKED_FEE_PATHS.includes(f));

  if (illegal.length > 0) {
    throw new Error(
      `Immutable fee fields cannot be changed: ${illegal.join(", ")}`
    );
  }
});

// ---------------------------------------------------------
// Indexes
// ---------------------------------------------------------

// Listing per institute, sorted by due date
feeSchema.index({
  instituteId: 1,
  isDeleted: 1,
  dueDate: -1,
});

// Per-student listing
feeSchema.index({
  instituteId: 1,
  studentId: 1,
  isDeleted: 1,
  dueDate: -1,
});

// Per-batch listing
feeSchema.index({
  instituteId: 1,
  batchId: 1,
  isDeleted: 1,
  dueDate: -1,
});

// Duplicate prevention: one fee per student per cycle per description
feeSchema.index(
  {
    instituteId: 1,
    studentId: 1,
    cycle: 1,
    description: 1,
  },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_fee_per_student_cycle_description",
  }
);

// ---------------------------------------------------------
// Model export
// ---------------------------------------------------------

const Fee =
  mongoose.models.Fee || mongoose.model("Fee", feeSchema);

module.exports = Fee;
module.exports.FEE_STATUSES = FEE_STATUSES;