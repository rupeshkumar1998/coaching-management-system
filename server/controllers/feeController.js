const {
  createFee,
  bulkCreateFees,
  listFees,
  getFee,
  updateFee,
  deleteFee,
  getFeeSummary,
} = require("../services/feeService");

const {
  recordPayment,
  refundPayment,
} = require("../services/paymentService");

// =========================================================
// 32.16.18 ΓÇö Fee Controller (Admin/Owner)
//
// 9 handlers. Mounted at /api/owner/fees.
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_FEE_ID: 400,
  INVALID_PAYMENT_ID: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_CYCLE: 400,
  INVALID_DESCRIPTION: 400,
  INVALID_AMOUNT: 400,
  INVALID_CURRENCY: 400,
  INVALID_DUE_DATE: 400,
  INVALID_NOTES: 400,
  INVALID_REASON: 400,
  INVALID_METHOD: 400,
  INVALID_GATEWAY: 400,
  INVALID_FIELD: 400,
  INVALID_STATUS: 400,
  INVALID_STATUS_CHANGE: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_UPDATES: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,

  STUDENT_NOT_FOUND: 404,
  BATCH_NOT_FOUND: 404,
  FEE_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,

  STUDENT_INACTIVE: 409,
  BATCH_INACTIVE: 409,
  NO_BATCH_ASSIGNED: 409,
  NO_ACTIVE_STUDENTS: 409,
  DUPLICATE_FEE: 409,
  FEE_CANCELLED: 409,
  FEE_HAS_PAYMENTS: 409,
  CANNOT_CANCEL: 409,
  OVERPAYMENT: 409,
  INVALID_PAYMENT_STATUS: 409,
  WRONG_PAYMENT_TYPE: 409,

  INTERNAL_ERROR: 500,
});

const resolveStatus = (error) => {
  if (error && typeof error.status === "number") return error.status;
  if (error && typeof error.code === "string") {
    return ERROR_STATUS_MAP[error.code] || 500;
  }
  return 500;
};

const handleControllerError = (res, error, operation) => {
  const status = resolveStatus(error);
  if (status === 500) {
    console.error(`[feeController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the fee"
        : error.message,
  });
};

// ---------------------------------------------------------
// Serializers
// ---------------------------------------------------------

const serializeFee = (fee, isOverdue) => {
  if (!fee) return null;
  const isOverdueFinal =
    typeof isOverdue === "boolean"
      ? isOverdue
      : (fee.status === "PENDING" || fee.status === "PARTIAL") &&
        new Date(fee.dueDate) < new Date();
  return {
    id: String(fee._id),
    instituteId: String(fee.instituteId),
    studentId: fee.studentId?._id
      ? {
          id: String(fee.studentId._id),
          name: fee.studentId.name || null,
          email: fee.studentId.email || null,
          phone: fee.studentId.phone || null,
        }
      : String(fee.studentId),
    batchId: fee.batchId ? String(fee.batchId) : null,
    classId: fee.classId ? String(fee.classId) : null,
    cycle: fee.cycle,
    description: fee.description,
    amount: fee.amount,
    currency: fee.currency,
    paidAmount: fee.paidAmount,
    outstanding: fee.amount - fee.paidAmount,
    dueDate: fee.dueDate,
    status: fee.status,
    isOverdue: isOverdueFinal,
    notes: fee.notes || null,
    createdAt: fee.createdAt || null,
    updatedAt: fee.updatedAt || null,
  };
};

const serializePayment = (p) => {
  if (!p) return null;
  return {
    id: String(p._id),
    feeId: p.feeId ? String(p.feeId) : null,
    studentId: p.studentId ? String(p.studentId) : null,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    gateway: p.gateway,
    transactionId: p.transactionId || null,
    receiptUrl: p.receiptUrl || null,
    status: p.status,
    notes: p.notes || null,
    verifiedBy: p.verifiedBy ? String(p.verifiedBy) : null,
    verifiedAt: p.verifiedAt || null,
    createdAt: p.createdAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/owner/fees
// ---------------------------------------------------------
const createFeeHandler = async (req, res) => {
  try {
    const {
      studentId,
      cycle,
      description,
      amount,
      currency,
      dueDate,
      notes,
    } = req.body;

    const fee = await createFee({
      instituteId: req.tenantId,
      studentId,
      cycle,
      description,
      amount,
      currency,
      dueDate,
      notes,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Fee created successfully",
      data: { fee: serializeFee(fee) },
    });
  } catch (error) {
    return handleControllerError(res, error, "createFee");
  }
};

// ---------------------------------------------------------
// POST /api/owner/fees/bulk
// ---------------------------------------------------------
const bulkCreateFeeHandler = async (req, res) => {
  try {
    const {
      batchId,
      cycle,
      description,
      amount,
      currency,
      dueDate,
      notes,
    } = req.body;

    const fees = await bulkCreateFees({
      instituteId: req.tenantId,
      batchId,
      cycle,
      description,
      amount,
      currency,
      dueDate,
      notes,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: `${fees.length} fee(s) created successfully`,
      count: fees.length,
      data: { fees: fees.map((f) => serializeFee(f)) },
    });
  } catch (error) {
    return handleControllerError(res, error, "bulkCreateFee");
  }
};

// ---------------------------------------------------------
// GET /api/owner/fees
// ---------------------------------------------------------
const listFeeHandler = async (req, res) => {
  try {
    const { studentId, batchId, status, cycle, overdue, from, to, page, limit } =
      req.query;

    const result = await listFees({
      instituteId: req.tenantId,
      studentId: studentId || undefined,
      batchId: batchId || undefined,
      status: status || undefined,
      cycle: cycle || undefined,
      overdue,
      from: from || undefined,
      to: to || undefined,
      page: page || 1,
      limit: limit || 50,
    });

    return res.status(200).json({
      success: true,
      message: "Fees fetched successfully",
      count: result.items.length,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      data: {
        fees: result.items.map((f) => serializeFee(f, f.isOverdue)),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "listFee");
  }
};

// ---------------------------------------------------------
// GET /api/owner/fees/summary
// ---------------------------------------------------------
const summaryHandler = async (req, res) => {
  try {
    const summary = await getFeeSummary({
      instituteId: req.tenantId,
    });

    return res.status(200).json({
      success: true,
      message: "Fee summary fetched successfully",
      data: summary,
    });
  } catch (error) {
    return handleControllerError(res, error, "summary");
  }
};

// ---------------------------------------------------------
// GET /api/owner/fees/:feeId
// ---------------------------------------------------------
const getFeeHandler = async (req, res) => {
  try {
    const result = await getFee({
      instituteId: req.tenantId,
      feeId: req.params.feeId,
    });

    return res.status(200).json({
      success: true,
      message: "Fee fetched successfully",
      data: {
        fee: serializeFee(result.fee),
        payments: result.payments.map(serializePayment),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "getFee");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/fees/:feeId
// ---------------------------------------------------------
const updateFeeHandler = async (req, res) => {
  try {
    const updates = {};
    for (const field of ["description", "dueDate", "notes", "status"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const fee = await updateFee({
      instituteId: req.tenantId,
      feeId: req.params.feeId,
      updates,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Fee updated successfully",
      data: { fee: serializeFee(fee) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateFee");
  }
};

// ---------------------------------------------------------
// DELETE /api/owner/fees/:feeId
// ---------------------------------------------------------
const deleteFeeHandler = async (req, res) => {
  try {
    const { reason } = req.body || {};

    const fee = await deleteFee({
      instituteId: req.tenantId,
      feeId: req.params.feeId,
      reason,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Fee deleted successfully",
      data: {
        fee: {
          id: String(fee._id),
          isDeleted: fee.isDeleted,
          deletedBy: fee.deletedBy ? String(fee.deletedBy) : null,
          deletedAt: fee.deletedAt,
          deleteReason: fee.deleteReason,
        },
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "deleteFee");
  }
};

// ---------------------------------------------------------
// POST /api/owner/fees/:feeId/payments
// ---------------------------------------------------------
const recordPaymentHandler = async (req, res) => {
  try {
    const { amount, method, gateway, transactionId, receiptUrl, notes } =
      req.body;

    const result = await recordPayment({
      instituteId: req.tenantId,
      feeId: req.params.feeId,
      amount,
      method,
      gateway,
      transactionId,
      receiptUrl,
      notes,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Payment recorded successfully",
      data: {
        payment: serializePayment(result.payment),
        fee: serializeFee(result.fee),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "recordPayment");
  }
};

// ---------------------------------------------------------
// POST /api/owner/fees/payments/:paymentId/refund
// ---------------------------------------------------------
const refundPaymentHandler = async (req, res) => {
  try {
    const { reason } = req.body || {};

    const result = await refundPayment({
      instituteId: req.tenantId,
      paymentId: req.params.paymentId,
      reason,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Payment refunded successfully",
      data: {
        payment: serializePayment(result.payment),
        fee: serializeFee(result.fee),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "refundPayment");
  }
};

module.exports = {
  createFeeHandler,
  bulkCreateFeeHandler,
  listFeeHandler,
  summaryHandler,
  getFeeHandler,
  updateFeeHandler,
  deleteFeeHandler,
  recordPaymentHandler,
  refundPaymentHandler,
};