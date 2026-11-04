// const mongoose = require("mongoose");

// const paymentSchema = new mongoose.Schema(
//   {
//     instituteId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Institute",
//       required: true,
//       index: true,
//     },

//     subscriptionId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "Subscription",
//       default: null,
//     },

//     paymentType: {
//       type: String,
//       enum: [
//         "INSTITUTE_SUBSCRIPTION",
//         "STUDENT_COURSE",
//         "STUDENT_BATCH",
//       ],
//       required: true,
//     },

//     amount: {
//       type: Number,
//       required: true,
//       min: 0,
//     },

//     currency: {
//       type: String,
//       default: "INR",
//       uppercase: true,
//     },

//     method: {
//       type: String,
//       enum: [
//         "MANUAL_UPI",
//         "BANK_TRANSFER",
//         "ONLINE_GATEWAY",
//       ],
//       required: true,
//     },

//     gateway: {
//       type: String,
//       enum: [
//         "NONE",
//         "RAZORPAY",
//         "STRIPE",
//         "OTHER",
//       ],
//       default: "NONE",
//     },

//     transactionId: {
//       type: String,
//       trim: true,
//       default: null,
//     },

//     receiptUrl: {
//       type: String,
//       default: null,
//     },

//     status: {
//       type: String,
//       enum: [
//         "PENDING",
//         "VERIFIED",
//         "REJECTED",
//         "FAILED",
//         "REFUNDED",
//       ],
//       default: "PENDING",
//     },

//     verifiedBy: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       default: null,
//     },

//     verifiedAt: {
//       type: Date,
//       default: null,
//     },

//     notes: {
//       type: String,
//       maxlength: 500,
//       default: null,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// const Payment = mongoose.model("Payment", paymentSchema);

// module.exports = Payment;

const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },

    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },

    paymentType: {
      type: String,
      enum: [
        "INSTITUTE_SUBSCRIPTION",
        "STUDENT_COURSE",
        "STUDENT_BATCH",
      ],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "INR",
      uppercase: true,
    },

    method: {
      type: String,
      enum: [
        "MANUAL_UPI",
        "BANK_TRANSFER",
        "ONLINE_GATEWAY",
      ],
      required: true,
    },

    gateway: {
      type: String,
      enum: [
        "NONE",
        "RAZORPAY",
        "STRIPE",
        "OTHER",
      ],
      default: "NONE",
    },

    transactionId: {
      type: String,
      trim: true,
      default: null,
    },

    receiptUrl: {
      type: String,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "VERIFIED",
        "REJECTED",
        "FAILED",
        "REFUNDED",
      ],
      default: "PENDING",
    },

    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------
// 32.16.15.9.15 — FINANCIAL INTEGRITY
//
// Once a payment is VERIFIED, its financial identity is frozen.
// Only a transition to REFUNDED (and free-form notes) remains
// allowed. This prevents tampering that would break the audit
// chain Payment -> Subscription -> PlanVersion.
//
// Bypassing through raw collection writes remains a DBA-level
// concern; Mongoose-layer protection is what this guard provides.
// ---------------------------------------------------------------

const LOCKED_PAYMENT_STATUSES = ["VERIFIED", "REFUNDED"];

const TERMINAL_PAYMENT_STATUSES = ["REFUNDED"];

const PROTECTED_PAYMENT_PATHS = [
  "instituteId",
  "subscriptionId",
  "paymentType",
  "amount",
  "currency",
  "method",
  "gateway",
  "transactionId",
  "receiptUrl",
  "verifiedBy",
  "verifiedAt",
];

const getChangedPaths = (doc) => doc.modifiedPaths();

// Track the original status so save() can detect a locked starting state.
paymentSchema.post("init", function (doc) {
  doc.$locals.originalStatus = doc.status;
});

paymentSchema.post("save", function (doc) {
  doc.$locals.originalStatus = doc.status;
});

paymentSchema.pre("save", function () {
  if (this.isNew) {
    return;
  }

  const originalStatus = this.$locals.originalStatus;

  if (!originalStatus) {
    return;
  }

  const changed = getChangedPaths(this);

  // Fully terminal status — no field may change.
  if (TERMINAL_PAYMENT_STATUSES.includes(originalStatus)) {
    const illegal = changed.filter(
      (field) => field !== "updatedAt"
    );

    if (illegal.length > 0) {
      throw new Error(
        `Refunded payments are terminal and cannot be modified: ${illegal.join(", ")}`
      );
    }

    return;
  }

  if (!LOCKED_PAYMENT_STATUSES.includes(originalStatus)) {
    return;
  }

  // VERIFIED — only status -> REFUNDED, notes, updatedAt are allowed.
  const allowedFields = new Set(["status", "notes", "updatedAt"]);
  const illegal = changed.filter(
    (field) => !allowedFields.has(field)
  );

  if (illegal.length > 0) {
    throw new Error(
      `Financial fields of a VERIFIED payment are immutable: ${illegal.join(", ")}`
    );
  }

  if (changed.includes("status") && this.status !== "REFUNDED") {
    throw new Error(
      `Invalid payment status transition: ${originalStatus} -> ${this.status}`
    );
  }
});

// ---------------------------------------------------------------
// QUERY-BASED UPDATE GUARDS
//
// Reject $set / $unset / $inc / $rename on protected financial
// fields when the target is VERIFIED or REFUNDED.
// ---------------------------------------------------------------

const collectUpdatePaths = (update) => {
  const paths = new Set();

  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return paths;
  }

  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const field of Object.keys(value)) {
          paths.add(field);

          if (key === "$rename" && typeof value[field] === "string") {
            paths.add(value[field]);
          }
        }
      }
    } else {
      paths.add(key);
    }
  }

  return paths;
};

const rejectVerifiedPaymentQueryUpdate = async function () {
  const filter = this.getFilter();
  const update = this.getUpdate();

  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return;
  }

  const updatedPaths = collectUpdatePaths(update);

  const touchesProtected = PROTECTED_PAYMENT_PATHS.some((field) =>
    updatedPaths.has(field)
  );

  const touchesStatus = updatedPaths.has("status");

  if (!touchesProtected && !touchesStatus) {
    return;
  }

  const matchingPayments = await this.model
    .find(filter)
    .select("_id status")
    .lean();

  const hasLockedPayment = matchingPayments.some((doc) =>
    LOCKED_PAYMENT_STATUSES.includes(doc.status)
  );

  if (!hasLockedPayment) {
    return;
  }

  if (touchesProtected) {
    throw new Error(
      "Financial fields of VERIFIED or REFUNDED payments cannot be modified through query updates"
    );
  }

  // Status-only change: allow only VERIFIED -> REFUNDED.
  const requestedStatus =
    update.status ?? update.$set?.status ?? null;

  if (requestedStatus && requestedStatus !== "REFUNDED") {
    const hasVerified = matchingPayments.some(
      (doc) => doc.status === "VERIFIED"
    );

    if (hasVerified) {
      throw new Error(
        `Invalid payment status transition: VERIFIED -> ${requestedStatus}`
      );
    }
  }
};

paymentSchema.pre("updateOne", rejectVerifiedPaymentQueryUpdate);
paymentSchema.pre("updateMany", rejectVerifiedPaymentQueryUpdate);
paymentSchema.pre("findOneAndUpdate", rejectVerifiedPaymentQueryUpdate);

// Replacements can silently drop locked fields.
paymentSchema.pre("replaceOne", function () {
  throw new Error(
    "Payment replacement is not allowed; use targeted updates"
  );
});

paymentSchema.pre("findOneAndReplace", function () {
  throw new Error(
    "Payment replacement is not allowed; use targeted updates"
  );
});

const Payment =
  mongoose.models.Payment ||
  mongoose.model("Payment", paymentSchema);

module.exports = Payment;