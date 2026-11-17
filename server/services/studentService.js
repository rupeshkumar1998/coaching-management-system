const mongoose = require("mongoose");
const crypto = require("crypto");

const User = require("../models/User");
const Batch = require("../models/Batch");
const Class = require("../models/Class");

const { validateInstituteId } = require("./entitlementService");
const { reserveLimit } = require("./limitService");
const { hashPassword } = require("./authService");

// =========================================================
// 32.16.16 Sprint 3 — Student Service
//
// Student enrollment with MAX_STUDENTS enforcement.
//
// Design rules (from Sprint 3 contract):
//   - role MUST be STUDENT
//   - classId + batchId both mandatory at creation
//   - batch must belong to class (validated)
//   - auto-generated 12-char base64url temp password
//   - mustChangePassword: true on creation
//   - User stores only batchId (class derived from batch)
//   - MAX_STUDENTS counter reserved atomically in transaction
// =========================================================

const createStudentError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// ---------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateName = (name) => {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw createStudentError(
      "INVALID_NAME",
      "Name must be at least 2 characters"
    );
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw createStudentError(
      "INVALID_NAME",
      "Name cannot exceed 100 characters"
    );
  }
  return trimmed;
};

const validateEmail = (email) => {
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    throw createStudentError("INVALID_EMAIL", "A valid email is required");
  }
  return email.trim().toLowerCase();
};

const validatePhone = (phone) => {
  if (phone === undefined || phone === null) return null;
  if (typeof phone !== "string") {
    throw createStudentError(
      "INVALID_PHONE",
      "Phone must be a string"
    );
  }
  const trimmed = phone.trim();
  if (trimmed === "") return null;
  if (trimmed.length < 7 || trimmed.length > 20) {
    throw createStudentError(
      "INVALID_PHONE",
      "Phone must be 7-20 characters"
    );
  }
  return trimmed;
};

// ---------------------------------------------------------
// Temp password generator — 12 chars, base64url
// ---------------------------------------------------------

const generateTempPassword = () => {
  // 9 bytes → 72 bits → 12 base64url chars
  const bytes = crypto.randomBytes(9);
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

// ---------------------------------------------------------
// Class + Batch validation helpers
// ---------------------------------------------------------

const validateClass = async (classId, instituteId, session = null) => {
  if (!classId || !mongoose.isValidObjectId(classId)) {
    throw createStudentError(
      "INVALID_CLASS_ID",
      "A valid classId is required"
    );
  }
  let query = Class.findOne({
    _id: classId,
    instituteId,
    isDeleted: false,
  }).select("_id isActive");
  if (session) query = query.session(session);
  const cls = await query;
  if (!cls) {
    throw createStudentError(
      "CLASS_NOT_FOUND",
      "Class not found in this institute",
      404
    );
  }
  if (!cls.isActive) {
    throw createStudentError(
      "CLASS_INACTIVE",
      "Cannot enroll students into an inactive class",
      409
    );
  }
  return cls;
};

const validateBatch = async (
  batchId,
  classId,
  instituteId,
  session = null
) => {
  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createStudentError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }
  let query = Batch.findOne({
    _id: batchId,
    instituteId,
    isDeleted: false,
  }).select("_id classId status");
  if (session) query = query.session(session);
  const batch = await query;
  if (!batch) {
    throw createStudentError(
      "BATCH_NOT_FOUND",
      "Batch not found in this institute",
      404
    );
  }
  if (batch.status !== "ACTIVE") {
    throw createStudentError(
      "BATCH_INACTIVE",
      "Cannot enroll students into an inactive batch",
      409
    );
  }
  if (String(batch.classId) !== String(classId)) {
    throw createStudentError(
      "BATCH_CLASS_MISMATCH",
      "Batch does not belong to the specified class",
      409
    );
  }
  return batch;
};

// ---------------------------------------------------------
// 1. CREATE STUDENT
// ---------------------------------------------------------

const createStudent = async ({
  instituteId,
  name,
  email,
  phone,
  classId,
  batchId,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const normalizedName = validateName(name);
  const normalizedEmail = validateEmail(email);
  const normalizedPhone = validatePhone(phone);

  // Validate class + batch (both mandatory)
  await validateClass(classId, normalizedInstituteId);
  await validateBatch(batchId, classId, normalizedInstituteId);

  // Check email uniqueness before opening transaction
  const existingUser = await User.findOne({
    email: normalizedEmail,
  }).select("_id");
  if (existingUser) {
    throw createStudentError(
      "EMAIL_EXISTS",
      "A user with this email already exists",
      409
    );
  }

  // Generate and hash temp password
  const tempPassword = generateTempPassword();
  const hashedPassword = await hashPassword(tempPassword);

  const session = await mongoose.startSession();
  let createdStudent = null;

  try {
    await session.withTransaction(async () => {
      // Reserve limit slot (atomic)
      await reserveLimit({
        instituteId: normalizedInstituteId,
        limitKey: "MAX_STUDENTS",
        incrementBy: 1,
        session,
      });

      [createdStudent] = await User.create(
        [
          {
            instituteId: normalizedInstituteId,
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            password: hashedPassword,
            role: "STUDENT",
            batchId,
            isActive: true,
            accountStatus: "ACTIVE",
            isDeleted: false,
            mustChangePassword: true,
          },
        ],
        { session }
      );
    });

    // Derive classId from batch for response
    const batch = await Batch.findById(batchId).select("classId").lean();

    return {
      student: createdStudent,
      tempPassword,
      classId: batch ? batch.classId : null,
    };
  } catch (error) {
    if (error.code === 11000) {
      throw createStudentError(
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
// 2. LIST STUDENTS
// ---------------------------------------------------------

const listStudents = async ({ instituteId, classId, batchId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  const filter = {
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  };

  if (batchId !== undefined && batchId !== null) {
    if (!mongoose.isValidObjectId(batchId)) {
      throw createStudentError(
        "INVALID_BATCH_ID",
        "A valid batchId is required"
      );
    }
    filter.batchId = batchId;
  } else if (classId !== undefined && classId !== null) {
    if (!mongoose.isValidObjectId(classId)) {
      throw createStudentError(
        "INVALID_CLASS_ID",
        "A valid classId is required"
      );
    }
    const batches = await Batch.find({
      classId,
      instituteId: normalizedInstituteId,
      isDeleted: false,
    })
      .select("_id")
      .lean();
    const batchIds = batches.map((b) => b._id);
    filter.batchId = { $in: batchIds };
  }

  return User.find(filter).sort({ name: 1 }).lean();
};

// ---------------------------------------------------------
// 3. GET SINGLE STUDENT
// ---------------------------------------------------------

const getStudent = async ({ instituteId, studentId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  }).lean();

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  // Derive class from batch
  let classId = null;
  if (student.batchId) {
    const batch = await Batch.findById(student.batchId)
      .select("classId")
      .lean();
    classId = batch ? batch.classId : null;
  }

  return { student, classId };
};

// ---------------------------------------------------------
// 4. UPDATE STUDENT (name/phone only)
// ---------------------------------------------------------

const updateStudent = async ({
  instituteId,
  studentId,
  updates,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createStudentError(
      "INVALID_UPDATES",
      "Updates must be an object"
    );
  }

  const allowedFields = ["name", "phone"];
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createStudentError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }
  const unknown = keys.filter((k) => !allowedFields.includes(k));
  if (unknown.length > 0) {
    throw createStudentError(
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

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  });

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  student.set(safeUpdates);
  await student.save();

  return student;
};

// ---------------------------------------------------------
// 5. ASSIGN BATCH (enroll / reassign)
// ---------------------------------------------------------

const assignBatch = async ({
  instituteId,
  studentId,
  batchId,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createStudentError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  });

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  // Validate batch (same institute, active)
  const batch = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  }).select("_id classId status").lean();

  if (!batch) {
    throw createStudentError(
      "BATCH_NOT_FOUND",
      "Batch not found",
      404
    );
  }
  if (batch.status !== "ACTIVE") {
    throw createStudentError(
      "BATCH_INACTIVE",
      "Cannot assign student to an inactive batch",
      409
    );
  }

  student.batchId = batchId;
  await student.save();

  return { student, classId: batch.classId };
};

// ---------------------------------------------------------
// 6. REMOVE BATCH (unassign)
// ---------------------------------------------------------

const removeBatch = async ({ instituteId, studentId, actorId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  });

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  if (!student.batchId) {
    throw createStudentError(
      "NO_BATCH_ASSIGNED",
      "Student is not currently assigned to any batch",
      409
    );
  }

  student.batchId = null;
  await student.save();

  return student;
};

// ---------------------------------------------------------
// 7. DELETE STUDENT (soft)
// ---------------------------------------------------------

const deleteStudent = async ({ instituteId, studentId, actorId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  // Block if student has any VERIFIED-or-partial payment (fee with paidAmount > 0)
  const Fee = require("../models/Fee");
  const hasPayments = await Fee.exists({
    instituteId: normalizedInstituteId,
    studentId,
    isDeleted: false,
    paidAmount: { $gt: 0 },
  });

  if (hasPayments) {
    throw createStudentError(
      "STUDENT_HAS_PAYMENTS",
      "Cannot delete student with recorded payments. Cancel fees first.",
      409
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  });

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  student.isDeleted = true;
  student.isActive = false;
  student.accountStatus = "SUSPENDED";

  await student.save();

  return student;
};

// ---------------------------------------------------------
// 8. RESET STUDENT PASSWORD
// ---------------------------------------------------------

const resetStudentPassword = async ({
  instituteId,
  studentId,
  newPassword,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createStudentError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createStudentError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (
    typeof newPassword !== "string" ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    throw createStudentError(
      "INVALID_PASSWORD",
      "Password must be 8-128 characters"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  }).select("+password");

  if (!student) {
    throw createStudentError(
      "STUDENT_NOT_FOUND",
      "Student not found",
      404
    );
  }

  if (!student.isActive || student.accountStatus !== "ACTIVE") {
    throw createStudentError(
      "STUDENT_INACTIVE",
      "Cannot reset password for an inactive student",
      409
    );
  }

  const hashedPassword = await hashPassword(newPassword);
  student.password = hashedPassword;
  student.mustChangePassword = true;

  await student.save();

  return student;
};
module.exports = {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  assignBatch,
  removeBatch,
  deleteStudent,
  resetStudentPassword,
};