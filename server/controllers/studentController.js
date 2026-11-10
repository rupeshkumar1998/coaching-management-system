const {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  assignBatch,
  removeBatch,
} = require("../services/studentService");

// =========================================================
// 32.16.16 Sprint 3 — Student Controller
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_NAME: 400,
  INVALID_EMAIL: 400,
  INVALID_PHONE: 400,
  INVALID_CLASS_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_STUDENT_ID: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_UPDATES: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,
  NOT_A_STUDENT: 400,
  INVALID_INSTITUTE_ID: 400,

  CLASS_NOT_FOUND: 404,
  BATCH_NOT_FOUND: 404,
  STUDENT_NOT_FOUND: 404,

  EMAIL_EXISTS: 409,
  BATCH_CLASS_MISMATCH: 409,
  CLASS_INACTIVE: 409,
  BATCH_INACTIVE: 409,
  NO_BATCH_ASSIGNED: 409,

  LIMIT_REACHED: 403,
  FEATURE_DISABLED: 403,
  SUBSCRIPTION_INACTIVE: 403,
  ENTITLEMENT_SNAPSHOT_MISSING: 500,
  ENTITLEMENT_CONFIGURATION_INVALID: 500,
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
    console.error(`[studentController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the student"
        : error.message,
  });
};

const serializeStudent = (student, classId = null) => {
  if (!student) return null;
  return {
    id: String(student._id),
    instituteId: String(student.instituteId),
    name: student.name,
    email: student.email,
    phone: student.phone || null,
    role: student.role,
    batchId: student.batchId ? String(student.batchId) : null,
    classId: classId ? String(classId) : null,
    isActive: student.isActive,
    accountStatus: student.accountStatus,
    mustChangePassword: student.mustChangePassword,
    createdAt: student.createdAt || null,
    updatedAt: student.updatedAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/owner/students
// ---------------------------------------------------------
const createStudentHandler = async (req, res) => {
  try {
    const { name, email, phone, classId, batchId } = req.body;

    const result = await createStudent({
      instituteId: req.tenantId,
      name,
      email,
      phone,
      classId,
      batchId,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Student created successfully",
      data: {
        student: serializeStudent(result.student, result.classId),
        tempPassword: result.tempPassword,
        tempPasswordWarning:
          "This password will not be shown again. Student must change it on first login.",
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "createStudent");
  }
};

// ---------------------------------------------------------
// GET /api/owner/students
// ---------------------------------------------------------
const listStudentsHandler = async (req, res) => {
  try {
    const { classId, batchId } = req.query;
    const students = await listStudents({
      instituteId: req.tenantId,
      classId: classId || undefined,
      batchId: batchId || undefined,
    });

    // Derive classId per student in one batch lookup
    const Batch = require("../models/Batch");
    const batchIds = [
      ...new Set(
        students
          .filter((s) => s.batchId)
          .map((s) => String(s.batchId))
      ),
    ];
    const batches = await Batch.find({ _id: { $in: batchIds } })
      .select("_id classId")
      .lean();
    const classByBatch = new Map(
      batches.map((b) => [String(b._id), b.classId])
    );

    const serialized = students.map((s) =>
      serializeStudent(
        s,
        s.batchId ? classByBatch.get(String(s.batchId)) : null
      )
    );

    return res.status(200).json({
      success: true,
      message: "Students fetched successfully",
      count: serialized.length,
      data: { students: serialized },
    });
  } catch (error) {
    return handleControllerError(res, error, "listStudents");
  }
};

// ---------------------------------------------------------
// GET /api/owner/students/:studentId
// ---------------------------------------------------------
const getStudentHandler = async (req, res) => {
  try {
    const result = await getStudent({
      instituteId: req.tenantId,
      studentId: req.params.studentId,
    });

    return res.status(200).json({
      success: true,
      message: "Student fetched successfully",
      data: {
        student: serializeStudent(result.student, result.classId),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "getStudent");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/students/:studentId
// ---------------------------------------------------------
const updateStudentHandler = async (req, res) => {
  try {
    const updates = {};
    for (const field of ["name", "phone"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const student = await updateStudent({
      instituteId: req.tenantId,
      studentId: req.params.studentId,
      updates,
      actorId: req.user._id,
    });

    // Derive classId
    let classId = null;
    if (student.batchId) {
      const Batch = require("../models/Batch");
      const batch = await Batch.findById(student.batchId)
        .select("classId")
        .lean();
      classId = batch ? batch.classId : null;
    }

    return res.status(200).json({
      success: true,
      message: "Student updated successfully",
      data: {
        student: serializeStudent(student, classId),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateStudent");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/students/:studentId/assign-batch
// ---------------------------------------------------------
const assignBatchHandler = async (req, res) => {
  try {
    const result = await assignBatch({
      instituteId: req.tenantId,
      studentId: req.params.studentId,
      batchId: req.body.batchId,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Student assigned to batch successfully",
      data: {
        student: serializeStudent(result.student, result.classId),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "assignBatch");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/students/:studentId/remove-batch
// ---------------------------------------------------------
const removeBatchHandler = async (req, res) => {
  try {
    const student = await removeBatch({
      instituteId: req.tenantId,
      studentId: req.params.studentId,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Student removed from batch successfully",
      data: {
        student: serializeStudent(student, null),
      },
    });
  } catch (error) {
    return handleControllerError(res, error, "removeBatch");
  }
};

module.exports = {
  createStudentHandler,
  listStudentsHandler,
  getStudentHandler,
  updateStudentHandler,
  assignBatchHandler,
  removeBatchHandler,
};