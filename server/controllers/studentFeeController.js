const { listFees, getFee } = require("../services/feeService");

// =========================================================
// 32.16.18 ΓÇö Student Fee Controller
//
// 2 handlers. Mounted at /api/student/fees.
// Student can only view own fees (req.user._id enforced).
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_FEE_ID: 400,
  INVALID_STATUS: 400,
  INVALID_DATE_RANGE: 400,

  FEE_NOT_FOUND: 404,

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
    console.error(
      `[studentFeeController] ${operation} failed:`,
      error
    );
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred"
        : error.message,
  });
};

const serializeFee = (fee, isOverdue) => {
  if (!fee) return null;
  const isOverdueFinal =
    typeof isOverdue === "boolean"
      ? isOverdue
      : (fee.status === "PENDING" || fee.status === "PARTIAL") &&
        new Date(fee.dueDate) < new Date();
  return {
    id: String(fee._id),
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
  };
};

const serializePayment = (p) => {
  if (!p) return null;
  return {
    id: String(p._id),
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    status: p.status,
    transactionId: p.transactionId || null,
    receiptUrl: p.receiptUrl || null,
    notes: p.notes || null,
    verifiedAt: p.verifiedAt || null,
    createdAt: p.createdAt || null,
  };
};

// ---------------------------------------------------------
// GET /api/student/fees
// ---------------------------------------------------------
const listMyFeesHandler = async (req, res) => {
  try {
    const { status, from, to, page, limit } = req.query;

    const result = await listFees({
      instituteId: req.user.instituteId,
      studentId: req.user._id,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      page: page || 1,
      limit: limit || 50,
    });

    return res.status(200).json({
      success: true,
      message: "Your fees fetched successfully",
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
    return handleControllerError(res, error, "listMyFees");
  }
};

// ---------------------------------------------------------
// GET /api/student/fees/:feeId
// ---------------------------------------------------------
const getMyFeeHandler = async (req, res) => {
  try {
    const result = await getFee({
      instituteId: req.user.instituteId,
      feeId: req.params.feeId,
    });

    // Ownership check: student can only view own fee
    if (String(result.fee.studentId._id || result.fee.studentId) !== String(req.user._id)) {
      return res.status(404).json({
        success: false,
        code: "FEE_NOT_FOUND",
        message: "Fee not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Fee fetched successfully",
      data: {
        fee: serializeFee(result.fee),
        payments: result.payments.map(serializePayment),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "getMyFee");
  }
};

module.exports = {
  listMyFeesHandler,
  getMyFeeHandler,
};