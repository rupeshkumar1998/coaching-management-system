const User = require("../models/User");
const Batch = require("../models/Batch");
const Class = require("../models/Class");
const Fee = require("../models/Fee");
const StudentAttendance = require("../models/StudentAttendance");

const { validateInstituteId } = require("../services/entitlementService");

// =========================================================
// 32.16.19 ΓÇö CSV Export Controller
//
// 3 exports: students, fees, attendance.
//
// Design rules:
//   - Stream into memory first, only send on success
//     (never send partial CSV, always JSON error if failed)
//   - 10,000 row hard cap (fail-fast with 413)
//   - RFC 4180 escaping (quotes, commas, newlines)
//   - UTF-8 BOM for Excel compatibility
//   - Institute-scoped (req.tenantId)
// =========================================================

const EXPORT_MAX_ROWS = 10000;

const createExportError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_CLASS_ID: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_STATUS: 400,
  EXPORT_TOO_LARGE: 413,
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
    console.error(`[csvExportController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred during export"
        : error.message,
  });
};

// ---------------------------------------------------------
// CSV helpers (RFC 4180)
// ---------------------------------------------------------

const escapeCsv = (value) => {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsvRow = (values) => values.map(escapeCsv).join(",");

const buildCsv = (headers, rows) => {
  // UTF-8 BOM + header + rows (CRLF line endings)
  const lines = [toCsvRow(headers)];
  for (const row of rows) {
    lines.push(toCsvRow(row));
  }
  return "\uFEFF" + lines.join("\r\n");
};

const timestampForFilename = () => {
  return new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
};

const sendCsv = (res, filename, csv) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"`
  );
  res.setHeader("Content-Length", Buffer.byteLength(csv, "utf8"));
  return res.status(200).send(csv);
};

const checkRowLimit = async (Model, filter) => {
  const count = await Model.countDocuments(filter);
  if (count > EXPORT_MAX_ROWS) {
    throw createExportError(
      "EXPORT_TOO_LARGE",
      `Export would contain ${count} rows (max ${EXPORT_MAX_ROWS}). Apply filters to reduce the result.`,
      413
    );
  }
  return count;
};

const toIndianDate = (date) => {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
};

// =========================================================
// 1. STUDENTS EXPORT
// =========================================================

const exportStudentsHandler = async (req, res) => {
  try {
    const instituteId = validateInstituteId(req.tenantId);
    const { classId, batchId, status } = req.query;

    const filter = {
      instituteId,
      role: "STUDENT",
      isDeleted: false,
    };

    if (batchId) {
      filter.batchId = batchId;
    } else if (classId) {
      const batches = await Batch.find({
        classId,
        instituteId,
        isDeleted: false,
      })
        .select("_id")
        .lean();
      filter.batchId = { $in: batches.map((b) => b._id) };
    }

    if (status === "active") {
      filter.isActive = true;
      filter.accountStatus = "ACTIVE";
    } else if (status === "inactive") {
      filter.$or = [
        { isActive: false },
        { accountStatus: { $ne: "ACTIVE" } },
      ];
    }

    await checkRowLimit(User, filter);

    const students = await User.find(filter)
      .select(
        "name email phone batchId isActive accountStatus createdAt"
      )
      .sort({ name: 1 })
      .lean();

    // Batch name lookup
    const batchIds = [
      ...new Set(
        students
          .filter((s) => s.batchId)
          .map((s) => String(s.batchId))
      ),
    ];
    const batches = await Batch.find({
      _id: { $in: batchIds },
      instituteId,
    })
      .select("_id name classId")
      .lean();
    const batchMap = new Map(
      batches.map((b) => [String(b._id), b])
    );

    // Class name lookup
    const classIds = [
      ...new Set(
        batches
          .filter((b) => b.classId)
          .map((b) => String(b.classId))
      ),
    ];
    const classes = await Class.find({
      _id: { $in: classIds },
      instituteId,
    })
      .select("_id name")
      .lean();
    const classMap = new Map(
      classes.map((c) => [String(c._id), c.name])
    );

    const headers = [
      "Name",
      "Email",
      "Phone",
      "Class",
      "Batch",
      "Active",
      "Account Status",
      "Created At",
    ];

    const rows = students.map((s) => {
      const batch = s.batchId
        ? batchMap.get(String(s.batchId))
        : null;
      const className = batch
        ? classMap.get(String(batch.classId)) || ""
        : "";
      return [
        s.name || "",
        s.email || "",
        s.phone || "",
        className,
        batch ? batch.name : "",
        s.isActive ? "Yes" : "No",
        s.accountStatus || "",
        toIndianDate(s.createdAt),
      ];
    });

    const csv = buildCsv(headers, rows);
    const filename = `students-${timestampForFilename()}.csv`;

    return sendCsv(res, filename, csv);
  } catch (error) {
    return handleControllerError(res, error, "exportStudents");
  }
};

// =========================================================
// 2. FEES EXPORT
// =========================================================

const exportFeesHandler = async (req, res) => {
  try {
    const instituteId = validateInstituteId(req.tenantId);
    const { studentId, batchId, status, cycle, overdue, from, to } =
      req.query;

    const filter = {
      instituteId,
      isDeleted: false,
    };

    if (studentId) filter.studentId = studentId;
    if (batchId) filter.batchId = batchId;
    if (cycle) filter.cycle = String(cycle).trim();
    if (status) filter.status = status;

    if (overdue === "true" || overdue === true) {
      filter.status = { $in: ["PENDING", "PARTIAL"] };
      filter.dueDate = { $lt: new Date() };
    }

    if (from || to) {
      filter.dueDate = filter.dueDate || {};
      if (from) filter.dueDate.$gte = new Date(from);
      if (to) filter.dueDate.$lte = new Date(to);
    }

    await checkRowLimit(Fee, filter);

    const fees = await Fee.find(filter)
      .populate({
        path: "studentId",
        select: "name email",
      })
      .sort({ dueDate: -1, createdAt: -1 })
      .lean();

    const headers = [
      "Student Name",
      "Student Email",
      "Cycle",
      "Description",
      "Amount",
      "Currency",
      "Paid",
      "Outstanding",
      "Due Date",
      "Status",
      "Overdue",
      "Created At",
    ];

    const now = new Date();
    const rows = fees.map((f) => {
      const outstanding = f.amount - f.paidAmount;
      const isOverdue =
        (f.status === "PENDING" || f.status === "PARTIAL") &&
        f.dueDate < now;
      return [
        f.studentId?.name || "",
        f.studentId?.email || "",
        f.cycle || "",
        f.description || "",
        f.amount,
        f.currency || "INR",
        f.paidAmount,
        outstanding,
        toIndianDate(f.dueDate),
        f.status,
        isOverdue ? "Yes" : "No",
        toIndianDate(f.createdAt),
      ];
    });

    const csv = buildCsv(headers, rows);
    const filename = `fees-${timestampForFilename()}.csv`;

    return sendCsv(res, filename, csv);
  } catch (error) {
    return handleControllerError(res, error, "exportFees");
  }
};

// =========================================================
// 3. ATTENDANCE EXPORT (requires batchId + from/to)
// =========================================================

const exportAttendanceHandler = async (req, res) => {
  try {
    const instituteId = validateInstituteId(req.tenantId);
    const { batchId, from, to, status } = req.query;

    if (!batchId) {
      throw createExportError(
        "INVALID_BATCH_ID",
        "batchId is required for attendance export"
      );
    }

    if (!from || !to) {
      throw createExportError(
        "INVALID_DATE_RANGE",
        "from and to dates are required (YYYY-MM-DD)"
      );
    }

    if (from > to) {
      throw createExportError(
        "INVALID_DATE_RANGE",
        "from date cannot be after to date"
      );
    }

    const filter = {
      instituteId,
      batchId,
      attendanceDate: { $gte: from, $lte: to },
      isDeleted: false,
    };

    if (status) filter.status = status;

    await checkRowLimit(StudentAttendance, filter);

    const records = await StudentAttendance.find(filter)
      .populate({
        path: "studentId",
        select: "name email",
      })
      .sort({ attendanceDate: -1, createdAt: -1 })
      .lean();

    const headers = [
      "Student Name",
      "Student Email",
      "Date",
      "Status",
      "Remarks",
      "Marked Via",
      "Created At",
    ];

    const rows = records.map((r) => [
      r.studentId?.name || "",
      r.studentId?.email || "",
      r.attendanceDate || "",
      r.status || "",
      r.remarks || "",
      r.markedVia || "MANUAL",
      toIndianDate(r.createdAt),
    ]);

    const csv = buildCsv(headers, rows);
    const filename = `attendance-${batchId}-${from}-to-${to}-${timestampForFilename()}.csv`;

    return sendCsv(res, filename, csv);
  } catch (error) {
    return handleControllerError(res, error, "exportAttendance");
  }
};

module.exports = {
  exportStudentsHandler,
  exportFeesHandler,
  exportAttendanceHandler,
};