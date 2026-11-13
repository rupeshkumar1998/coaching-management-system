const {
  markStudentAttendance,
  bulkMarkStudentAttendance,
  listStudentAttendance,
  getStudentAttendance,
  updateStudentAttendance,
  deleteStudentAttendance,
  getStudentAttendanceSummary,
  getBatchAttendanceSummary,
} = require("../services/studentAttendanceService");

// =========================================================
// 32.16.17 ΓÇö Student Attendance Controller (Admin/Owner)
//
// 8 endpoints. Mirrors studentController pattern.
// Routes mount under /api/owner/student-attendance
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_ATTENDANCE_ID: 400,
  INVALID_MARKED_BY: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_ATTENDANCE_DATE: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_STATUS: 400,
  INVALID_REMARKS: 400,
  INVALID_REASON: 400,
  INVALID_UPDATES: 400,
  INVALID_ENTRIES: 400,
  INVALID_ENTRY: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,
  IMMUTABLE_FIELD: 400,
  DUPLICATE_STUDENT_IN_BATCH: 400,

  STUDENT_NOT_FOUND: 404,
  BATCH_NOT_FOUND: 404,
  ATTENDANCE_NOT_FOUND: 404,

  DUPLICATE_ATTENDANCE: 409,
  STUDENT_INACTIVE: 409,
  BATCH_INACTIVE: 409,
  BATCH_MISMATCH: 409,
  NO_BATCH_ASSIGNED: 409,

  FUTURE_ATTENDANCE_DATE: 422,

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
      `[studentAttendanceController] ${operation} failed:`,
      error
    );
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the attendance"
        : error.message,
  });
};

// ---------------------------------------------------------
// Serializers
// ---------------------------------------------------------

const serializeAttendance = (rec) => {
  if (!rec) return null;
  return {
    id: String(rec._id),
    instituteId: String(rec.instituteId),
    studentId: rec.studentId?._id
      ? {
          id: String(rec.studentId._id),
          name: rec.studentId.name || null,
          email: rec.studentId.email || null,
          batchId: rec.studentId.batchId
            ? String(rec.studentId.batchId)
            : null,
        }
      : String(rec.studentId),
    batchId: String(rec.batchId),
    attendanceDate: rec.attendanceDate,
    date: rec.date || null,
    status: rec.status,
    remarks: rec.remarks || null,
    markedBy: rec.markedBy?._id
      ? {
          id: String(rec.markedBy._id),
          name: rec.markedBy.name || null,
          role: rec.markedBy.role || null,
        }
      : String(rec.markedBy),
    markedVia: rec.markedVia,
    createdAt: rec.createdAt || null,
    updatedAt: rec.updatedAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/owner/student-attendance
// ---------------------------------------------------------
const markHandler = async (req, res) => {
  try {
    const { studentId, status, attendanceDate, remarks } = req.body;

    const attendance = await markStudentAttendance({
      instituteId: req.tenantId,
      studentId,
      status,
      attendanceDate,
      remarks,
      markedBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Student attendance marked successfully",
      data: { attendance: serializeAttendance(attendance) },
    });
  } catch (error) {
    return handleControllerError(res, error, "markAttendance");
  }
};

// ---------------------------------------------------------
// POST /api/owner/student-attendance/bulk
// ---------------------------------------------------------
const bulkMarkHandler = async (req, res) => {
  try {
    const { batchId, attendanceDate, entries } = req.body;

    const created = await bulkMarkStudentAttendance({
      instituteId: req.tenantId,
      batchId,
      attendanceDate,
      entries,
      markedBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: `${created.length} attendance record(s) marked successfully`,
      count: created.length,
      data: {
        attendance: created.map(serializeAttendance),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "bulkMarkAttendance");
  }
};

// ---------------------------------------------------------
// GET /api/owner/student-attendance
// ---------------------------------------------------------
const listHandler = async (req, res) => {
  try {
    const { studentId, batchId, from, to, status, page, limit } = req.query;

    const result = await listStudentAttendance({
      instituteId: req.tenantId,
      studentId: studentId || undefined,
      batchId: batchId || undefined,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
      page: page || 1,
      limit: limit || 50,
    });

    return res.status(200).json({
      success: true,
      message: "Student attendance fetched successfully",
      count: result.items.length,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
      data: {
        attendance: result.items.map(serializeAttendance),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "listAttendance");
  }
};

// ---------------------------------------------------------
// GET /api/owner/student-attendance/:attendanceId
// ---------------------------------------------------------
const getHandler = async (req, res) => {
  try {
    const attendance = await getStudentAttendance({
      instituteId: req.tenantId,
      attendanceId: req.params.attendanceId,
    });

    return res.status(200).json({
      success: true,
      message: "Attendance fetched successfully",
      data: { attendance: serializeAttendance(attendance) },
    });
  } catch (error) {
    return handleControllerError(res, error, "getAttendance");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/student-attendance/:attendanceId
// ---------------------------------------------------------
const updateHandler = async (req, res) => {
  try {
    const updates = {};
    for (const field of ["status", "remarks"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const attendance = await updateStudentAttendance({
      instituteId: req.tenantId,
      attendanceId: req.params.attendanceId,
      updates,
    });

    return res.status(200).json({
      success: true,
      message: "Attendance updated successfully",
      data: { attendance: serializeAttendance(attendance) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateAttendance");
  }
};

// ---------------------------------------------------------
// DELETE /api/owner/student-attendance/:attendanceId
// ---------------------------------------------------------
const deleteHandler = async (req, res) => {
  try {
    const { reason } = req.body || {};

    const attendance = await deleteStudentAttendance({
      instituteId: req.tenantId,
      attendanceId: req.params.attendanceId,
      reason,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Attendance deleted successfully",
      data: {
        attendance: {
          id: String(attendance._id),
          isDeleted: attendance.isDeleted,
          deletedBy: attendance.deletedBy
            ? String(attendance.deletedBy)
            : null,
          deletedAt: attendance.deletedAt,
          deleteReason: attendance.deleteReason,
        },
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "deleteAttendance");
  }
};

// ---------------------------------------------------------
// GET /api/owner/student-attendance/summary/student/:studentId
// ---------------------------------------------------------
const studentSummaryHandler = async (req, res) => {
  try {
    const { from, to } = req.query;

    const result = await getStudentAttendanceSummary({
      instituteId: req.tenantId,
      studentId: req.params.studentId,
      from: from || undefined,
      to: to || undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Student attendance summary fetched successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(res, error, "studentSummary");
  }
};

// ---------------------------------------------------------
// GET /api/owner/student-attendance/summary/batch/:batchId
// ---------------------------------------------------------
const batchSummaryHandler = async (req, res) => {
  try {
    const { date } = req.query;

    const result = await getBatchAttendanceSummary({
      instituteId: req.tenantId,
      batchId: req.params.batchId,
      attendanceDate: date,
    });

    return res.status(200).json({
      success: true,
      message: "Batch attendance summary fetched successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(res, error, "batchSummary");
  }
};

module.exports = {
  markHandler,
  bulkMarkHandler,
  listHandler,
  getHandler,
  updateHandler,
  deleteHandler,
  studentSummaryHandler,
  batchSummaryHandler,
};