const {
  createBatch,
  listBatches,
  getBatch,
  updateBatch,
} = require("../services/batchService");

// =========================================================
// 32.16.16 — Batch Controller
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_BATCH_NAME: 400,
  INVALID_CLASS_ID: 400,
  INVALID_BATCH_ID: 400,
  INVALID_TEACHER_ID: 400,
  INVALID_SUBJECT: 400,
  INVALID_TEACHERS: 400,
  INVALID_SCHEDULE: 400,
  INVALID_STATUS: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_UPDATES: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,
  CLASS_ID_IMMUTABLE: 400,
  INSTITUTE_ID_IMMUTABLE: 400,
  DUPLICATE_TEACHER_SUBJECT: 409,
  INVALID_INSTITUTE_ID: 400,

  CLASS_NOT_FOUND: 404,
  TEACHER_NOT_FOUND: 404,
  BATCH_NOT_FOUND: 404,

  BATCH_NAME_EXISTS: 409,

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
    console.error(`[batchController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the batch"
        : error.message,
  });
};

const serializeBatch = (b) => {
  if (!b) return null;
  return {
    id: String(b._id),
    instituteId: String(b.instituteId),
    classId: String(b.classId),
    name: b.name,
    teachers: Array.isArray(b.teachers)
      ? b.teachers.map((t) => ({
          teacherId: String(t.teacherId),
          subject: t.subject,
        }))
      : [],
    schedule: b.schedule
      ? {
          days: b.schedule.days,
          startTime: b.schedule.startTime,
          endTime: b.schedule.endTime,
        }
      : null,
    status: b.status,
    createdAt: b.createdAt || null,
    updatedAt: b.updatedAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/owner/batches
// ---------------------------------------------------------
const createBatchHandler = async (req, res) => {
  try {
    const { classId, name, teachers, schedule } = req.body;

    const batch = await createBatch({
      instituteId: req.tenantId,
      classId,
      name,
      teachers,
      schedule,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Batch created successfully",
      data: { batch: serializeBatch(batch) },
    });
  } catch (error) {
    return handleControllerError(res, error, "createBatch");
  }
};

// ---------------------------------------------------------
// GET /api/owner/batches
// ---------------------------------------------------------
const listBatchesHandler = async (req, res) => {
  try {
    const { classId } = req.query;
    const list = await listBatches({
      instituteId: req.tenantId,
      classId: classId || undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Batches fetched successfully",
      count: list.length,
      data: { batches: list.map(serializeBatch) },
    });
  } catch (error) {
    return handleControllerError(res, error, "listBatches");
  }
};

// ---------------------------------------------------------
// GET /api/owner/batches/:batchId
// ---------------------------------------------------------
const getBatchHandler = async (req, res) => {
  try {
    const batch = await getBatch({
      instituteId: req.tenantId,
      batchId: req.params.batchId,
    });

    return res.status(200).json({
      success: true,
      message: "Batch fetched successfully",
      data: { batch: serializeBatch(batch) },
    });
  } catch (error) {
    return handleControllerError(res, error, "getBatch");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/batches/:batchId
// ---------------------------------------------------------
const updateBatchHandler = async (req, res) => {
  try {
    const updates = {};
    for (const field of ["name", "teachers", "schedule", "status"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const batch = await updateBatch({
      instituteId: req.tenantId,
      batchId: req.params.batchId,
      updates,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Batch updated successfully",
      data: { batch: serializeBatch(batch) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateBatch");
  }
};

module.exports = {
  createBatchHandler,
  listBatchesHandler,
  getBatchHandler,
  updateBatchHandler,
};