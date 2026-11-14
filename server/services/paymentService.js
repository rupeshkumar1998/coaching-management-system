const mongoose = require("mongoose");

const Payment = require("../models/Payment");
const Fee = require("../models/Fee");

const { validateInstituteId } = require("./entitlementService");
const { computeFeeStatus } = require("./feeService");

// =========================================================
// 32.16.18 ΓÇö Payment Service
//
// Records fee payments and refunds. Updates Fee.paidAmount
// transactionally to keep invoice and payments consistent.
//
// Design rules:
//   - recordPayment creates Payment with status VERIFIED (MVP:
//     admin records after money received)
//   - Overpayment not allowed (amount <= fee.amount - fee.paidAmount)
//   - refundPayment transitions VERIFIED -> REFUNDED, decrements
//     Fee.paidAmount
//   - Both operations transactional
// =========================================================

const createPaymentError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const VALID_METHODS = ["MANUAL_UPI", "BANK_TRANSFER", "ONLINE_GATEWAY"];
const VALID_GATEWAYS = ["NONE", "RAZORPAY", "STRIPE", "OTHER"];

const validateAmount = (amount, remaining) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw createPaymentError(
      "INVALID_AMOUNT",
      "amount must be a positive number"
    );
  }
  if (amount <= 0) {
    throw createPaymentError(
      "INVALID_AMOUNT",
      "amount must be greater than zero"
    );
  }
  if (!Number.isInteger(amount)) {
    throw createPaymentError(
      "INVALID_AMOUNT",
      "amount must be a whole number (INR)"
    );
  }
  if (remaining !== undefined && amount > remaining) {
    throw createPaymentError(
      "OVERPAYMENT",
      `Payment exceeds outstanding balance of ${remaining}`,
      409
    );
  }
  return amount;
};

const validateMethod = (method) => {
  if (!VALID_METHODS.includes(method)) {
    throw createPaymentError(
      "INVALID_METHOD",
      `method must be one of ${VALID_METHODS.join(", ")}`
    );
  }
  return method;
};

const validateGateway = (gateway) => {
  if (gateway === undefined || gateway === null) return "NONE";
  if (!VALID_GATEWAYS.includes(gateway)) {
    throw createPaymentError(
      "INVALID_GATEWAY",
      `gateway must be one of ${VALID_GATEWAYS.join(", ")}`
    );
  }
  return gateway;
};

const validateStringField = (value, fieldName, maxLen = 200) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw createPaymentError(
      "INVALID_FIELD",
      `${fieldName} must be a string or null`
    );
  }
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > maxLen) {
    throw createPaymentError(
      "INVALID_FIELD",
      `${fieldName} cannot exceed ${maxLen} characters`
    );
  }
  return trimmed;
};

// ---------------------------------------------------------
// 1. RECORD PAYMENT
// ---------------------------------------------------------

const recordPayment = async ({
  instituteId,
  feeId,
  amount,
  method,
  gateway,
  transactionId,
  receiptUrl,
  notes,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!feeId || !mongoose.isValidObjectId(feeId)) {
    throw createPaymentError(
      "INVALID_FEE_ID",
      "A valid feeId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createPaymentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedAmount = validateAmount(amount);
  const normalizedMethod = validateMethod(method);
  const normalizedGateway = validateGateway(gateway);
  const normalizedTransactionId = validateStringField(
    transactionId,
    "transactionId",
    200
  );
  const normalizedReceiptUrl = validateStringField(
    receiptUrl,
    "receiptUrl",
    500
  );
  const normalizedNotes = validateStringField(notes, "notes", 500);

  const session = await mongoose.startSession();
  let createdPayment = null;
  let updatedFee = null;

  try {
    await session.withTransaction(async () => {
      // Re-fetch fee inside transaction (race-safe)
      const fee = await Fee.findOne({
        _id: feeId,
        instituteId: normalizedInstituteId,
        isDeleted: false,
      }).session(session);

      if (!fee) {
        throw createPaymentError(
          "FEE_NOT_FOUND",
          "Fee not found",
          404
        );
      }

      if (fee.status === "CANCELLED") {
        throw createPaymentError(
          "FEE_CANCELLED",
          "Cannot record payment against a cancelled fee",
          409
        );
      }

      const remaining = fee.amount - fee.paidAmount;
      validateAmount(normalizedAmount, remaining);

      const now = new Date();

      [createdPayment] = await Payment.create(
        [
          {
            instituteId: normalizedInstituteId,
            feeId: fee._id,
            studentId: fee.studentId,
            paymentType: "STUDENT_FEE",
            amount: normalizedAmount,
            currency: fee.currency,
            method: normalizedMethod,
            gateway: normalizedGateway,
            transactionId: normalizedTransactionId,
            receiptUrl: normalizedReceiptUrl,
            status: "VERIFIED",
            verifiedBy: actorId,
            verifiedAt: now,
            notes: normalizedNotes,
          },
        ],
        { session }
      );

      fee.paidAmount += normalizedAmount;
      fee.updatedBy = actorId;
      fee.status = computeFeeStatus(fee);
      await fee.save({ session });

      updatedFee = fee;
    });

    return { payment: createdPayment, fee: updatedFee };
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 2. REFUND PAYMENT
// ---------------------------------------------------------

const refundPayment = async ({
  instituteId,
  paymentId,
  reason,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!paymentId || !mongoose.isValidObjectId(paymentId)) {
    throw createPaymentError(
      "INVALID_PAYMENT_ID",
      "A valid paymentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createPaymentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedReason = validateStringField(
    reason,
    "reason",
    500
  );

  const session = await mongoose.startSession();
  let updatedPayment = null;
  let updatedFee = null;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({
        _id: paymentId,
        instituteId: normalizedInstituteId,
      }).session(session);

      if (!payment) {
        throw createPaymentError(
          "PAYMENT_NOT_FOUND",
          "Payment not found",
          404
        );
      }

      if (payment.paymentType !== "STUDENT_FEE") {
        throw createPaymentError(
          "WRONG_PAYMENT_TYPE",
          "Only STUDENT_FEE payments can be refunded here",
          409
        );
      }

      if (payment.status !== "VERIFIED") {
        throw createPaymentError(
          "INVALID_PAYMENT_STATUS",
          "Only VERIFIED payments can be refunded",
          409
        );
      }

      const fee = await Fee.findOne({
        _id: payment.feeId,
        instituteId: normalizedInstituteId,
        isDeleted: false,
      }).session(session);

      if (!fee) {
        throw createPaymentError(
          "FEE_NOT_FOUND",
          "Associated fee not found",
          404
        );
      }

      payment.status = "REFUNDED";
      payment.notes = normalizedReason || payment.notes;
      await payment.save({ session });

      fee.paidAmount = Math.max(0, fee.paidAmount - payment.amount);
      fee.updatedBy = actorId;
      fee.status = computeFeeStatus(fee);
      await fee.save({ session });

      updatedPayment = payment;
      updatedFee = fee;
    });

    return { payment: updatedPayment, fee: updatedFee };
  } finally {
    await session.endSession();
  }
};

module.exports = {
  recordPayment,
  refundPayment,
};