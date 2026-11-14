const { body, param, query } = require("express-validator");

// =========================================================
// 32.16.18 ΓÇö Fee Validators (Admin/Owner)
// =========================================================

const feeIdParam = [
  param("feeId")
    .trim()
    .notEmpty()
    .withMessage("feeId is required")
    .bail()
    .isMongoId()
    .withMessage("feeId must be a valid Mongo ID"),
];

const paymentIdParam = [
  param("paymentId")
    .trim()
    .notEmpty()
    .withMessage("paymentId is required")
    .bail()
    .isMongoId()
    .withMessage("paymentId must be a valid Mongo ID"),
];

// ---------------------------------------------------------
// Common field chains
// ---------------------------------------------------------

const cycleField = body("cycle")
  .exists()
  .withMessage("cycle is required")
  .bail()
  .isString()
  .withMessage("cycle must be a string")
  .bail()
  .trim()
  .isLength({ min: 1, max: 20 })
  .withMessage("cycle must be 1-20 characters");

const descriptionField = body("description")
  .exists()
  .withMessage("description is required")
  .bail()
  .isString()
  .withMessage("description must be a string")
  .bail()
  .trim()
  .isLength({ min: 2, max: 200 })
  .withMessage("description must be 2-200 characters");

const amountField = body("amount")
  .exists()
  .withMessage("amount is required")
  .bail()
  .isInt({ min: 1 })
  .withMessage("amount must be a positive integer");

const currencyField = body("currency")
  .optional()
  .isString()
  .withMessage("currency must be a string")
  .bail()
  .trim()
  .isLength({ min: 3, max: 3 })
  .withMessage("currency must be 3 letters");

const dueDateField = body("dueDate")
  .exists()
  .withMessage("dueDate is required")
  .bail()
  .isISO8601()
  .withMessage("dueDate must be an ISO 8601 date");

const notesField = body("notes")
  .optional({ nullable: true })
  .custom((v) => {
    if (v === null) return true;
    if (typeof v !== "string") throw new Error("notes must be a string or null");
    if (v.trim().length > 500) throw new Error("notes cannot exceed 500 characters");
    return true;
  });

// ---------------------------------------------------------
// Create
// ---------------------------------------------------------

const createFeeValidator = [
  body("studentId")
    .exists()
    .withMessage("studentId is required")
    .bail()
    .isMongoId()
    .withMessage("studentId must be a valid Mongo ID"),
  cycleField,
  descriptionField,
  amountField,
  currencyField,
  dueDateField,
  notesField,
];

// ---------------------------------------------------------
// Bulk create
// ---------------------------------------------------------

const bulkCreateFeeValidator = [
  body("batchId")
    .exists()
    .withMessage("batchId is required")
    .bail()
    .isMongoId()
    .withMessage("batchId must be a valid Mongo ID"),
  cycleField,
  descriptionField,
  amountField,
  currencyField,
  dueDateField,
  notesField,
];

// ---------------------------------------------------------
// List
// ---------------------------------------------------------

const listFeeValidator = [
  query("studentId").optional().isMongoId().withMessage("studentId must be Mongo ID"),
  query("batchId").optional().isMongoId().withMessage("batchId must be Mongo ID"),
  query("status")
    .optional()
    .isIn(["PENDING", "PARTIAL", "PAID", "CANCELLED"])
    .withMessage("status must be PENDING|PARTIAL|PAID|CANCELLED"),
  query("cycle").optional().isString().trim().isLength({ max: 20 }),
  query("overdue").optional().isIn(["true", "false"]),
  query("from").optional().isISO8601().withMessage("from must be ISO date"),
  query("to").optional().isISO8601().withMessage("to must be ISO date"),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 200 }),
];

// ---------------------------------------------------------
// Get
// ---------------------------------------------------------

const getFeeValidator = [...feeIdParam];

// ---------------------------------------------------------
// Update
// ---------------------------------------------------------

const updateFeeValidator = [
  ...feeIdParam,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be an object");
    }
    const keys = Object.keys(value);
    if (keys.length === 0) throw new Error("At least one field is required");
    const allowed = ["description", "dueDate", "notes", "status"];
    const unknown = keys.filter((k) => !allowed.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `Only description, dueDate, notes, status can be updated. Unsupported: ${unknown.join(", ")}`
      );
    }
    return true;
  }),
  body("description")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 200 }),
  body("dueDate").optional().isISO8601(),
  body("notes")
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null) return true;
      if (typeof v !== "string") throw new Error("notes must be a string or null");
      if (v.trim().length > 500) throw new Error("notes cannot exceed 500 characters");
      return true;
    }),
  body("status")
    .optional()
    .isIn(["CANCELLED"])
    .withMessage("status update only allows CANCELLED"),
];

// ---------------------------------------------------------
// Delete
// ---------------------------------------------------------

const deleteFeeValidator = [
  ...feeIdParam,
  body("reason")
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null) return true;
      if (typeof v !== "string") throw new Error("reason must be a string or null");
      if (v.trim().length > 500) throw new Error("reason cannot exceed 500 characters");
      return true;
    }),
];

// ---------------------------------------------------------
// Record payment
// ---------------------------------------------------------

const recordPaymentValidator = [
  ...feeIdParam,
  body("amount")
    .exists()
    .withMessage("amount is required")
    .bail()
    .isInt({ min: 1 })
    .withMessage("amount must be a positive integer"),
  body("method")
    .exists()
    .withMessage("method is required")
    .bail()
    .isIn(["MANUAL_UPI", "BANK_TRANSFER", "ONLINE_GATEWAY"])
    .withMessage("method must be MANUAL_UPI|BANK_TRANSFER|ONLINE_GATEWAY"),
  body("gateway")
    .optional()
    .isIn(["NONE", "RAZORPAY", "STRIPE", "OTHER"]),
  body("transactionId")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 200 }),
  body("receiptUrl")
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: 500 }),
  body("notes")
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null) return true;
      if (typeof v !== "string") throw new Error("notes must be a string or null");
      if (v.trim().length > 500) throw new Error("notes cannot exceed 500 characters");
      return true;
    }),
];

// ---------------------------------------------------------
// Refund payment
// ---------------------------------------------------------

const refundPaymentValidator = [
  ...paymentIdParam,
  body("reason")
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null) return true;
      if (typeof v !== "string") throw new Error("reason must be a string or null");
      if (v.trim().length > 500) throw new Error("reason cannot exceed 500 characters");
      return true;
    }),
];

module.exports = {
  createFeeValidator,
  bulkCreateFeeValidator,
  listFeeValidator,
  getFeeValidator,
  updateFeeValidator,
  deleteFeeValidator,
  recordPaymentValidator,
  refundPaymentValidator,
};