const {
  bulkMarkStudentAttendance,
  listStudentAttendance,
  updateStudentAttendance,
  deleteStudentAttendance,
  getBatchAttendanceSummary,
  getStudentAttendance,
  getStudentAttendanceSummary,
  getTeacherBatchIds,
  assertTeacherOwnsBatch,
} = require("../services/studentAttendanceService");

// =========================================================
// 32.16.17 ΓÇö Teacher Student Attendance Controller
//
// 5 endpoints. TEACHER role (own batches only).
// Requires: protect + requireTeacherProfile + requirePermission
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_TEACHER_ID: 400,
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

  TEACHER_NOT_ASSIGNED_TO_BATCH: 403,

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
      `[teacherStudentAttendanceController] ${operation} failed:`,
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
// POST /api/teacher/student-attendance/bulk
// ---------------------------------------------------------
const bulkMarkHandler = async (req, res) => {
  try {
    const { batchId, attendanceDate, entries } = req.body;

    await assertTeacherOwnsBatch({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
      batchId,
    });

    const created = await bulkMarkStudentAttendance({
      instituteId: req.user.instituteId,
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
// GET /api/teacher/student-attendance
// ---------------------------------------------------------
const listHandler = async (req, res) => {
  try {
    const { studentId, batchId, from, to, status, page, limit } = req.query;

    const teacherBatchIds = await getTeacherBatchIds({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
    });

    const result = await listStudentAttendance({
      instituteId: req.user.instituteId,
      studentId: studentId || undefined,
      batchId: batchId || undefined,
      allowedBatchIds: teacherBatchIds,
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
// PATCH /api/teacher/student-attendance/:attendanceId
// remarks only (status blocked at validator level)
// ---------------------------------------------------------
const patchRemarksHandler = async (req, res) => {
  try {
    const attendance = await getStudentAttendance({
      instituteId: req.user.instituteId,
      attendanceId: req.params.attendanceId,
    });

    await assertTeacherOwnsBatch({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
      batchId: attendance.batchId,
    });

    const updated = await updateStudentAttendance({
      instituteId: req.user.instituteId,
      attendanceId: req.params.attendanceId,
      updates: { remarks: req.body.remarks },
    });

    return res.status(200).json({
      success: true,
      message: "Attendance remarks updated successfully",
      data: { attendance: serializeAttendance(updated) },
    });
  } catch (error) {
    return handleControllerError(res, error, "patchRemarks");
  }
};

// ---------------------------------------------------------
// DELETE /api/teacher/student-attendance/:attendanceId
// Soft delete (re-mark allowed via partial unique index)
// ---------------------------------------------------------
const deleteHandler = async (req, res) => {
  try {
    const { reason } = req.body || {};

    const attendance = await getStudentAttendance({
      instituteId: req.user.instituteId,
      attendanceId: req.params.attendanceId,
    });

    await assertTeacherOwnsBatch({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
      batchId: attendance.batchId,
    });

    const deleted = await deleteStudentAttendance({
      instituteId: req.user.instituteId,
      attendanceId: req.params.attendanceId,
      reason,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Attendance deleted successfully",
      data: {
        attendance: {
          id: String(deleted._id),
          isDeleted: deleted.isDeleted,
          deletedBy: deleted.deletedBy
            ? String(deleted.deletedBy)
            : null,
          deletedAt: deleted.deletedAt,
          deleteReason: deleted.deleteReason,
        },
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "deleteAttendance");
  }
};

// ---------------------------------------------------------
// GET /api/teacher/student-attendance/summary/batch/:batchId
// ---------------------------------------------------------
const batchSummaryHandler = async (req, res) => {
  try {
    await assertTeacherOwnsBatch({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
      batchId: req.params.batchId,
    });

    const result = await getBatchAttendanceSummary({
      instituteId: req.user.instituteId,
      batchId: req.params.batchId,
      attendanceDate: req.query.date,
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


// ---------------------------------------------------------
// GET /api/teacher/student-attendance/summary/student/:studentId
// ---------------------------------------------------------
const studentSummaryHandler = async (req, res) => {
  try {
    const { from, to } = req.query;

    const summary = await getStudentAttendanceSummary({
      instituteId: req.user.instituteId,
      studentId: req.params.studentId,
      from: from || undefined,
      to: to || undefined,
    });

    if (!summary.student.batchId) {
      return res.status(403).json({
        success: false,
        code: "TEACHER_NOT_ASSIGNED_TO_BATCH",
        message: "Student is not assigned to any batch",
      });
    }

    await assertTeacherOwnsBatch({
      instituteId: req.user.instituteId,
      teacherId: req.user._id,
      batchId: summary.student.batchId,
    });

    return res.status(200).json({
      success: true,
      message: "Student attendance summary fetched successfully",
      data: summary,
    });
  } catch (error) {
    return handleControllerError(res, error, "studentSummary");
  }
};

module.exports = {
  bulkMarkHandler,
  listHandler,
  patchRemarksHandler,
  deleteHandler,
  studentSummaryHandler,
  batchSummaryHandler,
};