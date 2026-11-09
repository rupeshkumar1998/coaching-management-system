const {
  createClass,
  listClasses,
  updateClass,
} = require("../services/classService");

// =========================================================
// 32.16.16 — Class Controller
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_CLASS_NAME: 400,
  INVALID_DESCRIPTION: 400,
  INVALID_CAPACITY: 400,
  INVALID_SORT_ORDER: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_CLASS_ID: 400,
  INVALID_TEACHER_ID: 400,
  INVALID_UPDATES: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,
  INVALID_IS_ACTIVE: 400,
  INVALID_INSTITUTE_ID: 400,

  CLASS_NOT_FOUND: 404,
  CLASS_TEACHER_NOT_FOUND: 404,
  INSTITUTE_NOT_FOUND: 404,

  CLASS_NAME_EXISTS: 409,

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
    console.error(`[classController] ${operation} failed:`, error);
  }

  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the class"
        : error.message,
  });
};

const serializeClass = (cls) => {
  if (!cls) return null;
  return {
    id: String(cls._id),
    instituteId: String(cls.instituteId),
    name: cls.name,
    description: cls.description || "",
    classTeacherId: cls.classTeacherId
      ? String(cls.classTeacherId)
      : null,
    capacity: cls.capacity ?? null,
    sortOrder: cls.sortOrder ?? 0,
    isActive: cls.isActive,
    createdAt: cls.createdAt || null,
    updatedAt: cls.updatedAt || null,
  };
};

// ---------------------------------------------------------
// POST /api/owner/classes
// ---------------------------------------------------------

const createClassHandler = async (req, res) => {
  try {
    const { name, description, classTeacherId, capacity, sortOrder } =
      req.body;

    const cls = await createClass({
      instituteId: req.tenantId,
      name,
      description,
      classTeacherId,
      capacity,
      sortOrder,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Class created successfully",
      data: { class: serializeClass(cls) },
    });
  } catch (error) {
    return handleControllerError(res, error, "createClass");
  }
};

// ---------------------------------------------------------
// GET /api/owner/classes
// ---------------------------------------------------------

const listClassesHandler = async (req, res) => {
  try {
    const list = await listClasses({ instituteId: req.tenantId });

    return res.status(200).json({
      success: true,
      message: "Classes fetched successfully",
      count: list.length,
      data: { classes: list.map(serializeClass) },
    });
  } catch (error) {
    return handleControllerError(res, error, "listClasses");
  }
};

// ---------------------------------------------------------
// PATCH /api/owner/classes/:classId
// ---------------------------------------------------------

const updateClassHandler = async (req, res) => {
  try {
    const { classId } = req.params;

    // Pass only allowed keys
    const updates = {};
    for (const field of [
      "name",
      "description",
      "classTeacherId",
      "capacity",
      "sortOrder",
      "isActive",
    ]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const cls = await updateClass({
      instituteId: req.tenantId,
      classId,
      updates,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Class updated successfully",
      data: { class: serializeClass(cls) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateClass");
  }
};

module.exports = {
  createClassHandler,
  listClassesHandler,
  updateClassHandler,
};