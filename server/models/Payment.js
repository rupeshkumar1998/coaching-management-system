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

const Payment = mongoose.model("Payment", paymentSchema);

module.exports = Payment;