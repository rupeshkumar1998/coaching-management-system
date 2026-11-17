const mongoose = require("mongoose");

const Class = require("../models/Class");
const User = require("../models/User");

const {
  validateInstituteId,
  resolveEffectiveSubscription,
  checkFeatureInSubscription,
} = require("./entitlementService");

const { reserveLimit } = require("./limitService");
const { getLimitDefinition } = require("../constants/limitCatalog");

// =========================================================
// 32.16.16 — Class Service
//
// Business logic for Class CRUD with MAX_CLASSES enforcement.
//
// createClass is the ONLY operation that reserves a limit slot.
// Update operations do not change the count.
//
// Transaction flow (createClass):
//   1. Validate inputs
//   2. If classTeacherId given, verify teacher exists
//   3. Start transaction:
//      a. Check duplicate name (fast-fail before reserve)
//      b. reserveLimit(MAX_CLASSES) — atomic, race-safe
//      c. Class.create
//   4. Commit / rollback
//
// Any failure → transaction abort → counter released automatically.
// =========================================================

const createClassError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// ---------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------

const validateName = (name) => {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw createClassError(
      "INVALID_CLASS_NAME",
      "Class name must be at least 2 characters"
    );
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw createClassError(
      "INVALID_CLASS_NAME",
      "Class name cannot exceed 100 characters"
    );
  }
  return trimmed;
};

const validateDescription = (description) => {
  if (description === undefined) return "";
  if (typeof description !== "string") {
    throw createClassError(
      "INVALID_DESCRIPTION",
      "Description must be a string"
    );
  }
  const trimmed = description.trim();
  if (trimmed.length > 500) {
    throw createClassError(
      "INVALID_DESCRIPTION",
      "Description cannot exceed 500 characters"
    );
  }
  return trimmed;
};

const validateCapacity = (capacity) => {
  if (capacity === undefined || capacity === null) return null;
  if (
    typeof capacity !== "number" ||
    !Number.isSafeInteger(capacity) ||
    capacity < 1
  ) {
    throw createClassError(
      "INVALID_CAPACITY",
      "Capacity must be a positive safe integer or null"
    );
  }
  return capacity;
};

const validateSortOrder = (sortOrder) => {
  if (sortOrder === undefined) return 0;
  if (
    typeof sortOrder !== "number" ||
    !Number.isSafeInteger(sortOrder)
  ) {
    throw createClassError(
      "INVALID_SORT_ORDER",
      "Sort order must be a safe integer"
    );
  }
  return sortOrder;
};

const validateTeacherBelongsToInstitute = async (
  classTeacherId,
  instituteId,
  session = null
) => {
  if (classTeacherId === undefined || classTeacherId === null) {
    return null;
  }
  if (!mongoose.isValidObjectId(classTeacherId)) {
    throw createClassError(
      "INVALID_TEACHER_ID",
      "A valid teacher ID is required"
    );
  }
  let query = User.findOne({
    _id: classTeacherId,
    instituteId,
    role: "TEACHER",
    isDeleted: false,
    isActive: true,
    accountStatus: "ACTIVE",
  }).select("_id");
  if (session) {
    query = query.session(session);
  }
  const teacher = await query;
  if (!teacher) {
    throw createClassError(
      "CLASS_TEACHER_NOT_FOUND",
      "Class teacher must be an active teacher of this institute",
      404
    );
  }
  return teacher._id;
};

// ---------------------------------------------------------
// 1. CREATE
// ---------------------------------------------------------

const createClass = async ({
  instituteId,
  name,
  description,
  classTeacherId,
  capacity,
  sortOrder,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createClassError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedName = validateName(name);
  const normalizedDescription = validateDescription(description);
  const normalizedCapacity = validateCapacity(capacity);
  const normalizedSortOrder = validateSortOrder(sortOrder);

  await validateTeacherBelongsToInstitute(
    classTeacherId,
    normalizedInstituteId
  );

  const session = await mongoose.startSession();
  let createdClass = null;

  try {
    await session.withTransaction(async () => {
      // Fast-fail before reserving a slot.
      const existing = await Class.findOne({
        instituteId: normalizedInstituteId,
        name: normalizedName,
        isDeleted: false,
      }).session(session);

      if (existing) {
        throw createClassError(
          "CLASS_NAME_EXISTS",
          "A class with this name already exists in this institute",
          409
        );
      }

      // Atomic reservation. Throws LIMIT_REACHED / FEATURE_DISABLED
      // / SUBSCRIPTION_INACTIVE and rolls back this transaction.
      await reserveLimit({
        instituteId: normalizedInstituteId,
        limitKey: "MAX_CLASSES",
        incrementBy: 1,
        session,
      });

      [createdClass] = await Class.create(
        [
          {
            instituteId: normalizedInstituteId,
            name: normalizedName,
            description: normalizedDescription,
            classTeacherId: classTeacherId || null,
            capacity: normalizedCapacity,
            sortOrder: normalizedSortOrder,
            createdBy: actorId,
            updatedBy: actorId,
          },
        ],
        { session }
      );
    });

    return createdClass;
  } catch (error) {
    // Transaction auto-rolled back. Re-throw for controller mapping.
    if (error.code === 11000) {
      throw createClassError(
        "CLASS_NAME_EXISTS",
        "A class with this name already exists in this institute",
        409
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 2. LIST
// ---------------------------------------------------------

const listClasses = async ({ instituteId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  return Class.find({
    instituteId: normalizedInstituteId,
    isDeleted: false,
  })
    .sort({ sortOrder: 1, name: 1 })
    .lean();
};

// ---------------------------------------------------------
// 3. UPDATE
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = [
  "name",
  "description",
  "classTeacherId",
  "capacity",
  "sortOrder",
  "isActive",
];

const updateClass = async ({
  instituteId,
  classId,
  updates,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!classId || !mongoose.isValidObjectId(classId)) {
    throw createClassError(
      "INVALID_CLASS_ID",
      "A valid class ID is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createClassError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (
    !updates ||
    typeof updates !== "object" ||
    Array.isArray(updates)
  ) {
    throw createClassError(
      "INVALID_UPDATES",
      "Updates must be an object"
    );
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createClassError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }

  const unknown = keys.filter(
    (k) => !ALLOWED_UPDATE_FIELDS.includes(k)
  );
  if (unknown.length > 0) {
    throw createClassError(
      "UNSUPPORTED_UPDATE_FIELDS",
      `Unsupported fields: ${unknown.join(", ")}`
    );
  }

  // Validate individual fields before opening a transaction.
  const safeUpdates = {};

  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    safeUpdates.name = validateName(updates.name);
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, "description")
  ) {
    safeUpdates.description = validateDescription(updates.description);
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, "capacity")
  ) {
    safeUpdates.capacity = validateCapacity(updates.capacity);
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, "sortOrder")
  ) {
    safeUpdates.sortOrder = validateSortOrder(updates.sortOrder);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "isActive")) {
    if (typeof updates.isActive !== "boolean") {
      throw createClassError(
        "INVALID_IS_ACTIVE",
        "isActive must be a boolean"
      );
    }
    safeUpdates.isActive = updates.isActive;
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, "classTeacherId")
  ) {
    if (updates.classTeacherId !== null) {
      await validateTeacherBelongsToInstitute(
        updates.classTeacherId,
        normalizedInstituteId
      );
    }
    safeUpdates.classTeacherId = updates.classTeacherId || null;
  }

  const existing = await Class.findOne({
    _id: classId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!existing) {
    throw createClassError(
      "CLASS_NOT_FOUND",
      "Class not found",
      404
    );
  }

  // Duplicate name check when name changes.
  if (
    safeUpdates.name !== undefined &&
    safeUpdates.name !== existing.name
  ) {
    const duplicate = await Class.findOne({
      instituteId: normalizedInstituteId,
      name: safeUpdates.name,
      isDeleted: false,
      _id: { $ne: classId },
    });
    if (duplicate) {
      throw createClassError(
        "CLASS_NAME_EXISTS",
        "A class with this name already exists in this institute",
        409
      );
    }
  }

  existing.set(safeUpdates);
  existing.updatedBy = actorId;

  try {
    await existing.save();
  } catch (error) {
    if (error.code === 11000) {
      throw createClassError(
        "CLASS_NAME_EXISTS",
        "A class with this name already exists in this institute",
        409
      );
    }
    throw error;
  }

  return existing;
};


// ---------------------------------------------------------
// 4. DELETE CLASS (soft)
// ---------------------------------------------------------

const deleteClass = async ({ instituteId, classId, actorId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!classId || !mongoose.isValidObjectId(classId)) {
    throw createClassError(
      "INVALID_CLASS_ID",
      "A valid class ID is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createClassError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  // Block if any active batch exists in class
  const Batch = require("../models/Batch");
  const hasBatches = await Batch.exists({
    instituteId: normalizedInstituteId,
    classId,
    isDeleted: false,
  });

  if (hasBatches) {
    throw createClassError(
      "CLASS_HAS_BATCHES",
      "Cannot delete class with active batches. Remove batches first.",
      409
    );
  }

  const cls = await Class.findOne({
    _id: classId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!cls) {
    throw createClassError(
      "CLASS_NOT_FOUND",
      "Class not found",
      404
    );
  }

  cls.isDeleted = true;
  cls.isActive = false;
  cls.updatedBy = actorId;
  await cls.save();

  return cls;
};

module.exports = {
  createClass,
  listClasses,
  updateClass,
  deleteClass,
};