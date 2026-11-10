const {
  createParent,
  listParents,
  getParent,
  updateParent,
} = require("../services/parentService");

// =========================================================
// 32.16.16 Sprint 4C — Parent Controller
// =========================================================

const ERROR_STATUS_MAP = Object.freeze({
  INVALID_NAME: 400,
  INVALID_EMAIL: 400,
  INVALID_PHONE: 400,
  INVALID_PASSWORD: 400,
  INVALID_PARENT_ID: 400,
  INVALID_ACTOR_ID: 400,
  INVALID_UPDATES: 400,
  EMPTY_UPDATES: 400,
  UNSUPPORTED_UPDATE_FIELDS: 400,
  INVALID_INSTITUTE_ID: 400,

  PARENT_NOT_FOUND: 404,

  EMAIL_EXISTS: 409,

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
    console.error(`[parentController] ${operation} failed:`, error);
  }
  return res.status(status).json({
    success: false,
    ...(error && error.code ? { code: error.code } : {}),
    message:
      status === 500
        ? "An unexpected error occurred while processing the parent"
        : error.message,
  });
};

const serializeParent = (parent) => {
  if (!parent) return null;
  return {
    id: String(parent._id),
    instituteId: String(parent.instituteId),
    name: parent.name,
    email: parent.email,
    phone: parent.phone || null,
    role: parent.role,
    isActive: parent.isActive,
    accountStatus: parent.accountStatus,
    createdAt: parent.createdAt || null,
    updatedAt: parent.updatedAt || null,
  };
};

// POST /api/owner/parents
const createParentHandler = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    const parent = await createParent({
      instituteId: req.tenantId,
      name,
      email,
      phone,
      password,
      actorId: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Parent created successfully",
      data: { parent: serializeParent(parent) },
    });
  } catch (error) {
    return handleControllerError(res, error, "createParent");
  }
};

// GET /api/owner/parents
const listParentsHandler = async (req, res) => {
  try {
    const parents = await listParents({ instituteId: req.tenantId });

    return res.status(200).json({
      success: true,
      message: "Parents fetched successfully",
      count: parents.length,
      data: { parents: parents.map(serializeParent) },
    });
  } catch (error) {
    return handleControllerError(res, error, "listParents");
  }
};

// GET /api/owner/parents/:parentId
const getParentHandler = async (req, res) => {
  try {
    const parent = await getParent({
      instituteId: req.tenantId,
      parentId: req.params.parentId,
    });

    return res.status(200).json({
      success: true,
      message: "Parent fetched successfully",
      data: { parent: serializeParent(parent) },
    });
  } catch (error) {
    return handleControllerError(res, error, "getParent");
  }
};

// PATCH /api/owner/parents/:parentId
const updateParentHandler = async (req, res) => {
  try {
    const updates = {};
    for (const field of ["name", "phone"]) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const parent = await updateParent({
      instituteId: req.tenantId,
      parentId: req.params.parentId,
      updates,
      actorId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Parent updated successfully",
      data: { parent: serializeParent(parent) },
    });
  } catch (error) {
    return handleControllerError(res, error, "updateParent");
  }
};

module.exports = {
  createParentHandler,
  listParentsHandler,
  getParentHandler,
  updateParentHandler,
};