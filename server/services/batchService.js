const mongoose = require("mongoose");

const Batch = require("../models/Batch");
const Class = require("../models/Class");
const User = require("../models/User");

const { validateInstituteId } = require("./entitlementService");
const { reserveLimit } = require("./limitService");

// =========================================================
// 32.16.16 — Batch Service
//
// Business logic for Batch CRUD with MAX_BATCHES enforcement.
//
// Design rules:
//   - classId is immutable (decided in Sprint 2 contract)
//   - same teacher may teach multiple subjects in one batch,
//     but {teacherId, subject} pairs must be unique
//   - schedule is optional
//   - only createBatch reserves a limit slot
// =========================================================

const createBatchError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// ---------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------

const VALID_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const validateName = (name) => {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw createBatchError(
      "INVALID_BATCH_NAME",
      "Batch name must be at least 2 characters"
    );
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw createBatchError(
      "INVALID_BATCH_NAME",
      "Batch name cannot exceed 100 characters"
    );
  }
  return trimmed;
};

const validateSubject = (subject) => {
  if (typeof subject !== "string" || subject.trim().length < 2) {
    throw createBatchError(
      "INVALID_SUBJECT",
      "Subject must be at least 2 characters"
    );
  }
  const trimmed = subject.trim();
  if (trimmed.length > 100) {
    throw createBatchError(
      "INVALID_SUBJECT",
      "Subject cannot exceed 100 characters"
    );
  }
  return trimmed.toUpperCase();
};

const validateSchedule = (schedule) => {
  if (schedule === undefined || schedule === null) return null;

  if (typeof schedule !== "object" || Array.isArray(schedule)) {
    throw createBatchError(
      "INVALID_SCHEDULE",
      "Schedule must be an object"
    );
  }

  const { days, startTime, endTime } = schedule;

  if (!Array.isArray(days) || days.length < 1 || days.length > 7) {
    throw createBatchError(
      "INVALID_SCHEDULE",
      "Schedule must have 1-7 days"
    );
  }
  for (const day of days) {
    if (!VALID_DAYS.includes(day)) {
      throw createBatchError(
        "INVALID_SCHEDULE",
        `Invalid day: ${day}. Must be one of ${VALID_DAYS.join(", ")}`
      );
    }
  }

  if (typeof startTime !== "string" || !TIME_REGEX.test(startTime)) {
    throw createBatchError(
      "INVALID_SCHEDULE",
      "startTime must be HH:MM (00:00-23:59)"
    );
  }
  if (typeof endTime !== "string" || !TIME_REGEX.test(endTime)) {
    throw createBatchError(
      "INVALID_SCHEDULE",
      "endTime must be HH:MM (00:00-23:59)"
    );
  }
  if (startTime >= endTime) {
    throw createBatchError(
      "INVALID_SCHEDULE",
      "startTime must be before endTime"
    );
  }

  return { days, startTime, endTime };
};

const validateTeachers = async (
  teachers,
  instituteId,
  session = null
) => {
  if (teachers === undefined || teachers === null) return [];
  if (!Array.isArray(teachers)) {
    throw createBatchError(
      "INVALID_TEACHERS",
      "Teachers must be an array"
    );
  }

  const seen = new Set();
  const normalized = [];

  for (let i = 0; i < teachers.length; i++) {
    const entry = teachers[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw createBatchError(
        "INVALID_TEACHERS",
        `Teacher entry at index ${i} must be an object`
      );
    }

    if (
      !entry.teacherId ||
      !mongoose.isValidObjectId(entry.teacherId)
    ) {
      throw createBatchError(
        "INVALID_TEACHER_ID",
        `Invalid teacherId at index ${i}`
      );
    }

    const subject = validateSubject(entry.subject);
    const key = `${entry.teacherId}_${subject}`;
    if (seen.has(key)) {
      throw createBatchError(
        "DUPLICATE_TEACHER_SUBJECT",
        `Duplicate teacher-subject combination: ${subject}`
      );
    }
    seen.add(key);

    normalized.push({
      teacherId: entry.teacherId,
      subject,
    });
  }

  // Verify each teacher exists, is TEACHER, active, same institute
  const teacherIds = [...new Set(normalized.map((t) => String(t.teacherId)))];

  let query = User.find({
    _id: { $in: teacherIds },
    instituteId,
    role: "TEACHER",
    isDeleted: false,
    isActive: true,
    accountStatus: "ACTIVE",
  }).select("_id");
  if (session) query = query.session(session);

  const foundTeachers = await query;
  const foundIds = new Set(foundTeachers.map((u) => String(u._id)));

  for (const id of teacherIds) {
    if (!foundIds.has(id)) {
      throw createBatchError(
        "TEACHER_NOT_FOUND",
        `Teacher ${id} not found, not active, or not in this institute`,
        404
      );
    }
  }

  return normalized;
};

const validateClassBelongsToInstitute = async (
  classId,
  instituteId,
  session = null
) => {
  if (!classId || !mongoose.isValidObjectId(classId)) {
    throw createBatchError(
      "INVALID_CLASS_ID",
      "A valid classId is required"
    );
  }

  let query = Class.findOne({
    _id: classId,
    instituteId,
    isDeleted: false,
  }).select("_id");
  if (session) query = query.session(session);

  const cls = await query;
  if (!cls) {
    throw createBatchError(
      "CLASS_NOT_FOUND",
      "Class not found in this institute",
      404
    );
  }
  return cls._id;
};

// ---------------------------------------------------------
// 1. CREATE
// ---------------------------------------------------------

const createBatch = async ({
  instituteId,
  classId,
  name,
  teachers,
  schedule,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createBatchError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedName = validateName(name);
  const normalizedSchedule = validateSchedule(schedule);

  await validateClassBelongsToInstitute(classId, normalizedInstituteId);
  const normalizedTeachers = await validateTeachers(
    teachers,
    normalizedInstituteId
  );

  const session = await mongoose.startSession();
  let createdBatch = null;

  try {
    await session.withTransaction(async () => {
      // Fast-fail duplicate before reserving a slot
      const existing = await Batch.findOne({
        instituteId: normalizedInstituteId,
        classId,
        name: normalizedName,
        isDeleted: false,
      }).session(session);

      if (existing) {
        throw createBatchError(
          "BATCH_NAME_EXISTS",
          "A batch with this name already exists in this class",
          409
        );
      }

      // Atomic reservation
      await reserveLimit({
        instituteId: normalizedInstituteId,
        limitKey: "MAX_BATCHES",
        incrementBy: 1,
        session,
      });

      [createdBatch] = await Batch.create(
        [
          {
            instituteId: normalizedInstituteId,
            classId,
            name: normalizedName,
            teachers: normalizedTeachers,
            schedule: normalizedSchedule,
            createdBy: actorId,
            updatedBy: actorId,
          },
        ],
        { session }
      );
    });

    return createdBatch;
  } catch (error) {
    if (error.code === 11000) {
      throw createBatchError(
        "BATCH_NAME_EXISTS",
        "A batch with this name already exists in this class",
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

const listBatches = async ({ instituteId, classId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  const filter = {
    instituteId: normalizedInstituteId,
    isDeleted: false,
  };

  if (classId !== undefined && classId !== null) {
    if (!mongoose.isValidObjectId(classId)) {
      throw createBatchError(
        "INVALID_CLASS_ID",
        "A valid classId is required"
      );
    }
    filter.classId = classId;
  }

  return Batch.find(filter).sort({ name: 1 }).lean();
};

// ---------------------------------------------------------
// 3. GET SINGLE
// ---------------------------------------------------------

const getBatch = async ({ instituteId, batchId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createBatchError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const batch = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  }).lean();

  if (!batch) {
    throw createBatchError(
      "BATCH_NOT_FOUND",
      "Batch not found",
      404
    );
  }

  return batch;
};

// ---------------------------------------------------------
// 4. UPDATE
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["name", "teachers", "schedule", "status"];

const updateBatch = async ({
  instituteId,
  batchId,
  updates,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createBatchError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createBatchError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createBatchError(
      "INVALID_UPDATES",
      "Updates must be an object"
    );
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createBatchError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }

  // Explicitly reject immutable fields with clear message
  if (Object.prototype.hasOwnProperty.call(updates, "classId")) {
    throw createBatchError(
      "CLASS_ID_IMMUTABLE",
      "classId cannot be changed; create a new batch instead"
    );
  }
  if (Object.prototype.hasOwnProperty.call(updates, "instituteId")) {
    throw createBatchError(
      "INSTITUTE_ID_IMMUTABLE",
      "instituteId cannot be changed"
    );
  }

  const unknown = keys.filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
  if (unknown.length > 0) {
    throw createBatchError(
      "UNSUPPORTED_UPDATE_FIELDS",
      `Unsupported fields: ${unknown.join(", ")}`
    );
  }

  // Validate fields
  const safeUpdates = {};

  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    safeUpdates.name = validateName(updates.name);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "schedule")) {
    safeUpdates.schedule = validateSchedule(updates.schedule);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    if (!["ACTIVE", "INACTIVE"].includes(updates.status)) {
      throw createBatchError(
        "INVALID_STATUS",
        "status must be ACTIVE or INACTIVE"
      );
    }
    safeUpdates.status = updates.status;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "teachers")) {
    safeUpdates.teachers = await validateTeachers(
      updates.teachers,
      normalizedInstituteId
    );
  }

  const existing = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!existing) {
    throw createBatchError(
      "BATCH_NOT_FOUND",
      "Batch not found",
      404
    );
  }

  // Duplicate name check
  if (
    safeUpdates.name !== undefined &&
    safeUpdates.name !== existing.name
  ) {
    const dup = await Batch.findOne({
      instituteId: normalizedInstituteId,
      classId: existing.classId,
      name: safeUpdates.name,
      isDeleted: false,
      _id: { $ne: batchId },
    });
    if (dup) {
      throw createBatchError(
        "BATCH_NAME_EXISTS",
        "A batch with this name already exists in this class",
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
      throw createBatchError(
        "BATCH_NAME_EXISTS",
        "A batch with this name already exists in this class",
        409
      );
    }
    throw error;
  }

  return existing;
};

module.exports = {
  createBatch,
  listBatches,
  getBatch,
  updateBatch,
};