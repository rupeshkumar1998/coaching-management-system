const mongoose = require("mongoose");

const Fee = require("../models/Fee");
const User = require("../models/User");
const Batch = require("../models/Batch");

const { validateInstituteId } = require("./entitlementService");

// =========================================================
// 32.16.18 ΓÇö Fee Service
//
// Fee invoice lifecycle: create, list, get, update, delete, summary.
//
// Design rules (from .18 contract):
//   - Invoice per student per cycle per description
//   - batchId + classId are snapshots at creation (immutable)
//   - amount > 0 (zero-amount fees not allowed)
//   - status auto-derived: PENDING / PARTIAL / PAID
//   - CANCELLED is manual only, requires paidAmount = 0
//   - deleteFee requires paidAmount = 0 (no payments attached)
//   - bulkCreateFees is all-or-nothing (transaction)
// =========================================================

const createFeeError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// ---------------------------------------------------------
// Validators
// ---------------------------------------------------------

const validateCycle = (cycle) => {
  if (typeof cycle !== "string" || cycle.trim().length === 0) {
    throw createFeeError("INVALID_CYCLE", "cycle is required");
  }
  const trimmed = cycle.trim();
  if (trimmed.length > 20) {
    throw createFeeError(
      "INVALID_CYCLE",
      "cycle cannot exceed 20 characters"
    );
  }
  return trimmed;
};

const validateDescription = (description) => {
  if (
    typeof description !== "string" ||
    description.trim().length < 2
  ) {
    throw createFeeError(
      "INVALID_DESCRIPTION",
      "description must be at least 2 characters"
    );
  }
  const trimmed = description.trim();
  if (trimmed.length > 200) {
    throw createFeeError(
      "INVALID_DESCRIPTION",
      "description cannot exceed 200 characters"
    );
  }
  return trimmed;
};

const validateAmount = (amount) => {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw createFeeError(
      "INVALID_AMOUNT",
      "amount must be a positive number"
    );
  }
  if (amount <= 0) {
    throw createFeeError(
      "INVALID_AMOUNT",
      "amount must be greater than zero"
    );
  }
  if (!Number.isInteger(amount)) {
    throw createFeeError(
      "INVALID_AMOUNT",
      "amount must be a whole number (INR)"
    );
  }
  return amount;
};

const validateDueDate = (dueDate) => {
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) {
    throw createFeeError(
      "INVALID_DUE_DATE",
      "dueDate must be a valid date"
    );
  }
  return parsed;
};

const validateCurrency = (currency) => {
  if (currency === undefined || currency === null) return "INR";
  if (typeof currency !== "string" || currency.trim().length !== 3) {
    throw createFeeError(
      "INVALID_CURRENCY",
      "currency must be a 3-letter code"
    );
  }
  return currency.trim().toUpperCase();
};

const validateNotes = (notes) => {
  if (notes === undefined || notes === null) return null;
  if (typeof notes !== "string") {
    throw createFeeError("INVALID_NOTES", "notes must be a string or null");
  }
  const trimmed = notes.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 500) {
    throw createFeeError(
      "INVALID_NOTES",
      "notes cannot exceed 500 characters"
    );
  }
  return trimmed;
};

const validateStudent = async (studentId, instituteId) => {
  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createFeeError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId,
    role: "STUDENT",
    isDeleted: false,
  })
    .select("_id batchId isActive accountStatus")
    .lean();

  if (!student) {
    throw createFeeError(
      "STUDENT_NOT_FOUND",
      "Student not found in this institute",
      404
    );
  }
  if (!student.isActive || student.accountStatus !== "ACTIVE") {
    throw createFeeError(
      "STUDENT_INACTIVE",
      "Student account is not active",
      409
    );
  }
  if (!student.batchId) {
    throw createFeeError(
      "NO_BATCH_ASSIGNED",
      "Student is not assigned to any batch",
      409
    );
  }

  const batch = await Batch.findOne({
    _id: student.batchId,
    instituteId,
    isDeleted: false,
  })
    .select("classId")
    .lean();

  if (!batch) {
    throw createFeeError(
      "BATCH_NOT_FOUND",
      "Student's batch not found",
      404
    );
  }

  return { student, batch };
};

const validateBatch = async (batchId, instituteId) => {
  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createFeeError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const batch = await Batch.findOne({
    _id: batchId,
    instituteId,
    isDeleted: false,
  })
    .select("_id classId status")
    .lean();

  if (!batch) {
    throw createFeeError(
      "BATCH_NOT_FOUND",
      "Batch not found in this institute",
      404
    );
  }
  if (batch.status !== "ACTIVE") {
    throw createFeeError(
      "BATCH_INACTIVE",
      "Cannot create fees for an inactive batch",
      409
    );
  }

  return batch;
};

// ---------------------------------------------------------
// Status computation (used by feeService + paymentService)
// ---------------------------------------------------------

const computeFeeStatus = (fee) => {
  if (fee.status === "CANCELLED") return "CANCELLED";
  if (fee.paidAmount >= fee.amount) return "PAID";
  if (fee.paidAmount > 0) return "PARTIAL";
  return "PENDING";
};

// ---------------------------------------------------------
// 1. CREATE FEE
// ---------------------------------------------------------

const createFee = async ({
  instituteId,
  studentId,
  cycle,
  description,
  amount,
  currency,
  dueDate,
  notes,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createFeeError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedCycle = validateCycle(cycle);
  const normalizedDescription = validateDescription(description);
  const normalizedAmount = validateAmount(amount);
  const normalizedCurrency = validateCurrency(currency);
  const normalizedDueDate = validateDueDate(dueDate);
  const normalizedNotes = validateNotes(notes);

  const { student, batch } = await validateStudent(
    studentId,
    normalizedInstituteId
  );

  // Pre-check duplicate (unique index catches race)
  const existing = await Fee.findOne({
    instituteId: normalizedInstituteId,
    studentId: student._id,
    cycle: normalizedCycle,
    description: normalizedDescription,
    isDeleted: false,
  }).lean();

  if (existing) {
    throw createFeeError(
      "DUPLICATE_FEE",
      "A fee with this cycle and description already exists for this student",
      409
    );
  }

  try {
    const fee = await Fee.create({
      instituteId: normalizedInstituteId,
      studentId: student._id,
      batchId: student.batchId,
      classId: batch.classId,
      cycle: normalizedCycle,
      description: normalizedDescription,
      amount: normalizedAmount,
      currency: normalizedCurrency,
      dueDate: normalizedDueDate,
      notes: normalizedNotes,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return fee;
  } catch (error) {
    if (error.code === 11000) {
      throw createFeeError(
        "DUPLICATE_FEE",
        "A fee with this cycle and description already exists for this student",
        409
      );
    }
    throw error;
  }
};

// ---------------------------------------------------------
// 2. BULK CREATE FEES (all-or-nothing)
// ---------------------------------------------------------

const bulkCreateFees = async ({
  instituteId,
  batchId,
  cycle,
  description,
  amount,
  currency,
  dueDate,
  notes,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createFeeError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedCycle = validateCycle(cycle);
  const normalizedDescription = validateDescription(description);
  const normalizedAmount = validateAmount(amount);
  const normalizedCurrency = validateCurrency(currency);
  const normalizedDueDate = validateDueDate(dueDate);
  const normalizedNotes = validateNotes(notes);

  const batch = await validateBatch(batchId, normalizedInstituteId);

  const students = await User.find({
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    batchId,
    isDeleted: false,
    isActive: true,
    accountStatus: "ACTIVE",
  })
    .select("_id")
    .lean();

  if (students.length === 0) {
    throw createFeeError(
      "NO_ACTIVE_STUDENTS",
      "No active students found in this batch",
      409
    );
  }

  const studentIds = students.map((s) => s._id);

  // Detect duplicates upfront
  const existingFees = await Fee.find({
    instituteId: normalizedInstituteId,
    studentId: { $in: studentIds },
    cycle: normalizedCycle,
    description: normalizedDescription,
    isDeleted: false,
  })
    .select("studentId")
    .lean();

  if (existingFees.length > 0) {
    const conflicting = existingFees.map((f) => String(f.studentId));
    throw createFeeError(
      "DUPLICATE_FEE",
      `Fee already exists for ${conflicting.length} student(s): ${conflicting.join(", ")}`,
      409
    );
  }

  const session = await mongoose.startSession();
  let created = [];

  try {
    await session.withTransaction(async () => {
      const docs = studentIds.map((sid) => ({
        instituteId: normalizedInstituteId,
        studentId: sid,
        batchId: batch._id,
        classId: batch.classId,
        cycle: normalizedCycle,
        description: normalizedDescription,
        amount: normalizedAmount,
        currency: normalizedCurrency,
        dueDate: normalizedDueDate,
        notes: normalizedNotes,
        createdBy: actorId,
        updatedBy: actorId,
      }));

      created = await Fee.insertMany(docs, {
        session,
        ordered: true,
      });
    });

    return created;
  } catch (error) {
    if (error.code === 11000) {
      throw createFeeError(
        "DUPLICATE_FEE",
        "One or more students already have this fee",
        409
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 3. LIST FEES
// ---------------------------------------------------------

const listFees = async ({
  instituteId,
  studentId,
  batchId,
  status,
  cycle,
  overdue,
  from,
  to,
  page = 1,
  limit = 50,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  const filter = {
    instituteId: normalizedInstituteId,
    isDeleted: false,
  };

  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      throw createFeeError(
        "INVALID_STUDENT_ID",
        "Invalid studentId"
      );
    }
    filter.studentId = studentId;
  }

  if (batchId) {
    if (!mongoose.isValidObjectId(batchId)) {
      throw createFeeError("INVALID_BATCH_ID", "Invalid batchId");
    }
    filter.batchId = batchId;
  }

  if (cycle) {
    filter.cycle = String(cycle).trim();
  }

  if (status) {
    const valid = ["PENDING", "PARTIAL", "PAID", "CANCELLED"];
    if (!valid.includes(status)) {
      throw createFeeError(
        "INVALID_STATUS",
        `status must be one of ${valid.join(", ")}`
      );
    }
    filter.status = status;
  }

  if (overdue === true || overdue === "true") {
    filter.status = { $in: ["PENDING", "PARTIAL"] };
    filter.dueDate = { $lt: new Date() };
  }

  if (from || to) {
    filter.dueDate = filter.dueDate || {};
    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw createFeeError(
          "INVALID_DATE_RANGE",
          "from must be a valid date"
        );
      }
      filter.dueDate.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw createFeeError(
          "INVALID_DATE_RANGE",
          "to must be a valid date"
        );
      }
      filter.dueDate.$lte = toDate;
    }
  }

  const safeLimit = Math.min(
    Math.max(parseInt(limit, 10) || 50, 1),
    200
  );
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Fee.find(filter)
      .populate({
        path: "studentId",
        select: "name email",
      })
      .sort({ dueDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Fee.countDocuments(filter),
  ]);

  const now = new Date();
  const withOverdue = items.map((f) => ({
    ...f,
    isOverdue:
      (f.status === "PENDING" || f.status === "PARTIAL") &&
      f.dueDate < now,
  }));

  return {
    items: withOverdue,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};

// ---------------------------------------------------------
// 4. GET FEE (with payment history)
// ---------------------------------------------------------

const getFee = async ({ instituteId, feeId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!feeId || !mongoose.isValidObjectId(feeId)) {
    throw createFeeError(
      "INVALID_FEE_ID",
      "A valid feeId is required"
    );
  }

  const fee = await Fee.findOne({
    _id: feeId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  })
    .populate({
      path: "studentId",
      select: "name email phone",
    })
    .lean();

  if (!fee) {
    throw createFeeError("FEE_NOT_FOUND", "Fee not found", 404);
  }

  const Payment = require("../models/Payment");

  const payments = await Payment.find({
    feeId: fee._id,
    instituteId: normalizedInstituteId,
  })
    .select(
      "_id amount currency method status transactionId receiptUrl notes verifiedBy verifiedAt createdAt"
    )
    .sort({ createdAt: -1 })
    .lean();

  return { fee, payments };
};

// ---------------------------------------------------------
// 5. UPDATE FEE
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["description", "dueDate", "notes", "status"];

const updateFee = async ({
  instituteId,
  feeId,
  updates,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!feeId || !mongoose.isValidObjectId(feeId)) {
    throw createFeeError(
      "INVALID_FEE_ID",
      "A valid feeId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createFeeError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createFeeError(
      "INVALID_UPDATES",
      "updates must be an object"
    );
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createFeeError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }

  const unknown = keys.filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
  if (unknown.length > 0) {
    throw createFeeError(
      "UNSUPPORTED_UPDATE_FIELDS",
      `Unsupported fields: ${unknown.join(", ")}`
    );
  }

  const fee = await Fee.findOne({
    _id: feeId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!fee) {
    throw createFeeError("FEE_NOT_FOUND", "Fee not found", 404);
  }

  if (fee.status === "CANCELLED") {
    throw createFeeError(
      "FEE_CANCELLED",
      "Cancelled fees cannot be modified",
      409
    );
  }

  const safeUpdates = {};

  if (Object.prototype.hasOwnProperty.call(updates, "description")) {
    safeUpdates.description = validateDescription(updates.description);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "dueDate")) {
    safeUpdates.dueDate = validateDueDate(updates.dueDate);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    safeUpdates.notes = validateNotes(updates.notes);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    if (updates.status !== "CANCELLED") {
      throw createFeeError(
        "INVALID_STATUS_CHANGE",
        "The only allowed status update is CANCELLED"
      );
    }
    if (fee.paidAmount > 0) {
      throw createFeeError(
        "CANNOT_CANCEL",
        "Cannot cancel a fee that already has payments",
        409
      );
    }
    safeUpdates.status = "CANCELLED";
  }

  fee.set(safeUpdates);
  fee.updatedBy = actorId;
  await fee.save();

  return fee;
};

// ---------------------------------------------------------
// 6. DELETE FEE (soft)
// ---------------------------------------------------------

const deleteFee = async ({
  instituteId,
  feeId,
  reason,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!feeId || !mongoose.isValidObjectId(feeId)) {
    throw createFeeError(
      "INVALID_FEE_ID",
      "A valid feeId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createFeeError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (
    reason !== undefined &&
    reason !== null &&
    typeof reason !== "string"
  ) {
    throw createFeeError(
      "INVALID_REASON",
      "Delete reason must be a string or null"
    );
  }

  const fee = await Fee.findOne({
    _id: feeId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!fee) {
    throw createFeeError("FEE_NOT_FOUND", "Fee not found", 404);
  }

  if (fee.paidAmount > 0) {
    throw createFeeError(
      "FEE_HAS_PAYMENTS",
      "Cannot delete a fee with payments. Cancel instead.",
      409
    );
  }

  fee.isDeleted = true;
  fee.deletedBy = actorId;
  fee.deletedAt = new Date();
  fee.deleteReason =
    reason === undefined || reason === null || reason.trim() === ""
      ? null
      : reason.trim();

  await fee.save();

  return fee;
};

// ---------------------------------------------------------
// 7. FEE SUMMARY (dashboard)
// ---------------------------------------------------------

const getFeeSummary = async ({ instituteId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);
  const instituteOid = new mongoose.Types.ObjectId(
    String(normalizedInstituteId)
  );

  const now = new Date();

  const [byStatus, overdueAgg] = await Promise.all([
    Fee.aggregate([
      {
        $match: {
          instituteId: instituteOid,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          totalPaid: { $sum: "$paidAmount" },
        },
      },
    ]),
    Fee.aggregate([
      {
        $match: {
          instituteId: instituteOid,
          isDeleted: false,
          status: { $in: ["PENDING", "PARTIAL"] },
          dueDate: { $lt: now },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          outstanding: {
            $sum: { $subtract: ["$amount", "$paidAmount"] },
          },
        },
      },
    ]),
  ]);

  const byStatusMap = {
    PENDING: { count: 0, totalAmount: 0, totalPaid: 0, outstanding: 0 },
    PARTIAL: { count: 0, totalAmount: 0, totalPaid: 0, outstanding: 0 },
    PAID: { count: 0, totalAmount: 0, totalPaid: 0, outstanding: 0 },
    CANCELLED: { count: 0, totalAmount: 0, totalPaid: 0, outstanding: 0 },
  };

  let totalFees = 0;
  let totalAmount = 0;
  let totalPaid = 0;

  for (const row of byStatus) {
    if (byStatusMap[row._id]) {
      byStatusMap[row._id] = {
        count: row.count,
        totalAmount: row.totalAmount,
        totalPaid: row.totalPaid,
        outstanding: row.totalAmount - row.totalPaid,
      };
      totalFees += row.count;
      totalAmount += row.totalAmount;
      totalPaid += row.totalPaid;
    }
  }

  const totalOutstanding = totalAmount - totalPaid;
  const overdue = overdueAgg[0] || { count: 0, outstanding: 0 };

  return {
    totalFees,
    totalAmount,
    totalPaid,
    totalOutstanding,
    overdueCount: overdue.count,
    overdueOutstanding: overdue.outstanding,
    byStatus: byStatusMap,
  };
};

module.exports = {
  createFee,
  bulkCreateFees,
  listFees,
  getFee,
  updateFee,
  deleteFee,
  getFeeSummary,
  computeFeeStatus,
};