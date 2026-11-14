const { getStudent } = require("../services/studentService");
const {
  listStudentAttendance,
  getStudentAttendanceSummary,
} = require("../services/studentAttendanceService");

// =========================================================
// 32.16.18a ΓÇö Student Profile Controller
//
// 3 handlers for /api/student/*.
// Reads req.user._id (authMiddleware) and req.user.instituteId.
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_INSTITUTE_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_DATE_RANGE: 400,
  INVALID_STATUS: 400,

  STUDENT_NOT_FOUND: 404,

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
      `[studentProfileController] ${operation} failed:`,
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

const serializeAttendance = (rec) => {
  if (!rec) return null;
  return {
    id: String(rec._id),
    batchId: rec.batchId ? String(rec.batchId) : null,
    attendanceDate: rec.attendanceDate,
    status: rec.status,
    remarks: rec.remarks || null,
    markedVia: rec.markedVia,
    createdAt: rec.createdAt || null,
  };
};

// ---------------------------------------------------------
// GET /api/student/me
// ---------------------------------------------------------
const getMyProfileHandler = async (req, res) => {
  try {
    const result = await getStudent({
      instituteId: req.user.instituteId,
      studentId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: {
        id: String(result.student._id),
        name: result.student.name,
        email: result.student.email,
        phone: result.student.phone || null,
        role: result.student.role,
        instituteId: String(result.student.instituteId),
        batchId: result.student.batchId
          ? String(result.student.batchId)
          : null,
        classId: result.classId ? String(result.classId) : null,
        mustChangePassword:
          result.student.mustChangePassword === true,
        lastLogin: result.student.lastLogin || null,
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "getMyProfile");
  }
};

// ---------------------------------------------------------
// GET /api/student/attendance
// ---------------------------------------------------------
const listMyAttendanceHandler = async (req, res) => {
  try {
    const { from, to, status, page, limit } = req.query;

    const result = await listStudentAttendance({
      instituteId: req.user.instituteId,
      studentId: req.user._id,
      from: from || undefined,
      to: to || undefined,
      status: status || undefined,
      page: page || 1,
      limit: limit || 50,
    });

    return res.status(200).json({
      success: true,
      message: "Your attendance fetched successfully",
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
    return handleControllerError(res, error, "listMyAttendance");
  }
};

// ---------------------------------------------------------
// GET /api/student/attendance/summary
// ---------------------------------------------------------
const mySummaryHandler = async (req, res) => {
  try {
    const { from, to } = req.query;

    const result = await getStudentAttendanceSummary({
      instituteId: req.user.instituteId,
      studentId: req.user._id,
      from: from || undefined,
      to: to || undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Your attendance summary fetched successfully",
      data: result,
    });
  } catch (error) {
    return handleControllerError(res, error, "mySummary");
  }
};

module.exports = {
  getMyProfileHandler,
  listMyAttendanceHandler,
  mySummaryHandler,
};