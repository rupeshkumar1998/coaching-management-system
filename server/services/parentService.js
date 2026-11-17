const mongoose = require("mongoose");

const User = require("../models/User");

const { validateInstituteId } = require("./entitlementService");
const { reserveLimit } = require("./limitService");
const { hashPassword } = require("./authService");

// =========================================================
// 32.16.16 Sprint 4C — Parent Service
//
// Simple User records with role=PARENT.
// No profile model (unlike Teacher).
// No class/batch assignment (unlike Student).
//
// Parents currently have NO functional features (no login,
// no child link). They exist to:
//   1. Reserve their seat under MAX_PARENTS limit
//   2. Capture basic contact info now
//   3. Be linked to students in a future milestone
// =========================================================

const createParentError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateName = (name) => {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw createParentError(
      "INVALID_NAME",
      "Name must be at least 2 characters"
    );
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw createParentError(
      "INVALID_NAME",
      "Name cannot exceed 100 characters"
    );
  }
  return trimmed;
};

const validateEmail = (email) => {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    throw createParentError("INVALID_EMAIL", "A valid email is required");
  }
  return email.trim().toLowerCase();
};

const validatePhone = (phone) => {
  if (phone === undefined || phone === null) return null;
  if (typeof phone !== "string") {
    throw createParentError("INVALID_PHONE", "Phone must be a string");
  }
  const trimmed = phone.trim();
  if (trimmed === "") return null;
  if (trimmed.length < 7 || trimmed.length > 20) {
    throw createParentError(
      "INVALID_PHONE",
      "Phone must be 7-20 characters"
    );
  }
  return trimmed;
};

const validatePassword = (password) => {
  if (typeof password !== "string") {
    throw createParentError(
      "INVALID_PASSWORD",
      "Password must be a string"
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw createParentError(
      "INVALID_PASSWORD",
      "Password must be 8-128 characters"
    );
  }
  return password;
};

// ---------------------------------------------------------
// 1. CREATE PARENT
// ---------------------------------------------------------

const createParent = async ({
  instituteId,
  name,
  email,
  phone,
  password,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createParentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedName = validateName(name);
  const normalizedEmail = validateEmail(email);
  const normalizedPhone = validatePhone(phone);
  validatePassword(password);

  // Check email uniqueness before transaction
  const existing = await User.findOne({
    email: normalizedEmail,
  }).select("_id");
  if (existing) {
    throw createParentError(
      "EMAIL_EXISTS",
      "A user with this email already exists",
      409
    );
  }

  const hashedPassword = await hashPassword(password);

  const session = await mongoose.startSession();
  let createdParent = null;

  try {
    await session.withTransaction(async () => {
      // Reserve limit slot (atomic)
      await reserveLimit({
        instituteId: normalizedInstituteId,
        limitKey: "MAX_PARENTS",
        incrementBy: 1,
        session,
      });

      [createdParent] = await User.create(
        [
          {
            instituteId: normalizedInstituteId,
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            password: hashedPassword,
            role: "PARENT",
            isActive: true,
            accountStatus: "ACTIVE",
            isDeleted: false,
          },
        ],
        { session }
      );
    });

    return createdParent;
  } catch (error) {
    if (error.code === 11000) {
      throw createParentError(
        "EMAIL_EXISTS",
        "A user with this email already exists",
        409
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 2. LIST PARENTS
// ---------------------------------------------------------

const listParents = async ({ instituteId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  return User.find({
    instituteId: normalizedInstituteId,
    role: "PARENT",
    isDeleted: false,
  })
    .sort({ name: 1 })
    .lean();
};

// ---------------------------------------------------------
// 3. GET SINGLE PARENT
// ---------------------------------------------------------

const getParent = async ({ instituteId, parentId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!parentId || !mongoose.isValidObjectId(parentId)) {
    throw createParentError(
      "INVALID_PARENT_ID",
      "A valid parentId is required"
    );
  }

  const parent = await User.findOne({
    _id: parentId,
    instituteId: normalizedInstituteId,
    role: "PARENT",
    isDeleted: false,
  }).lean();

  if (!parent) {
    throw createParentError(
      "PARENT_NOT_FOUND",
      "Parent not found",
      404
    );
  }

  return parent;
};

// ---------------------------------------------------------
// 4. UPDATE PARENT (name/phone only)
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["name", "phone"];

const updateParent = async ({
  instituteId,
  parentId,
  updates,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!parentId || !mongoose.isValidObjectId(parentId)) {
    throw createParentError(
      "INVALID_PARENT_ID",
      "A valid parentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createParentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createParentError(
      "INVALID_UPDATES",
      "Updates must be an object"
    );
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createParentError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }

  const unknown = keys.filter(
    (k) => !ALLOWED_UPDATE_FIELDS.includes(k)
  );
  if (unknown.length > 0) {
    throw createParentError(
      "UNSUPPORTED_UPDATE_FIELDS",
      `Only name and phone can be updated. Unsupported: ${unknown.join(", ")}`
    );
  }

  const safeUpdates = {};
  if (Object.prototype.hasOwnProperty.call(updates, "name")) {
    safeUpdates.name = validateName(updates.name);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "phone")) {
    safeUpdates.phone = validatePhone(updates.phone);
  }

  const parent = await User.findOne({
    _id: parentId,
    instituteId: normalizedInstituteId,
    role: "PARENT",
    isDeleted: false,
  });

  if (!parent) {
    throw createParentError(
      "PARENT_NOT_FOUND",
      "Parent not found",
      404
    );
  }

  parent.set(safeUpdates);
  await parent.save();

  return parent;
};

// ---------------------------------------------------------
// 5. DELETE PARENT (soft)
// ---------------------------------------------------------

const deleteParent = async ({ instituteId, parentId, actorId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!parentId || !mongoose.isValidObjectId(parentId)) {
    throw createParentError(
      "INVALID_PARENT_ID",
      "A valid parentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createParentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const parent = await User.findOne({
    _id: parentId,
    instituteId: normalizedInstituteId,
    role: "PARENT",
    isDeleted: false,
  });

  if (!parent) {
    throw createParentError(
      "PARENT_NOT_FOUND",
      "Parent not found",
      404
    );
  }

  parent.isDeleted = true;
  parent.isActive = false;
  parent.accountStatus = "SUSPENDED";

  await parent.save();

  return parent;
};

module.exports = {
  createParent,
  listParents,
  getParent,
  updateParent,
  deleteParent,
};