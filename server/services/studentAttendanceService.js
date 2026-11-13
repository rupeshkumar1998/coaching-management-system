const mongoose = require("mongoose");

const StudentAttendance = require("../models/StudentAttendance");
const User = require("../models/User");
const Batch = require("../models/Batch");

const { validateInstituteId } = require("./entitlementService");

// =========================================================
// 32.16.17 ΓÇö Student Attendance Service
//
// Business logic for student attendance management.
//
// Design rules (from .17.9 contract):
//   - All-or-nothing bulk marking (transaction)
//   - batchId snapshot from student's CURRENT batch (trusted DB)
//   - Duplicate attendance ΓåÆ 409 (partial success never allowed)
//   - Update: status + remarks only (immutable date/student/batch)
//   - Soft delete only (isDeleted flag)
//   - markedVia always "MANUAL" for now (QR future)
// =========================================================

const createAttendanceError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// ---------------------------------------------------------
// Date + status + remarks validators
// ---------------------------------------------------------

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidCalendarDate = (dateString) => {
  if (
    typeof dateString !== "string" ||
    !DATE_ONLY_PATTERN.test(dateString)
  ) {
    return false;
  }
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const getTodayInIndia = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const validateAttendanceDate = (date) => {
  if (!isValidCalendarDate(date)) {
    throw createAttendanceError(
      "INVALID_ATTENDANCE_DATE",
      "attendanceDate must be a valid YYYY-MM-DD date"
    );
  }
  const today = getTodayInIndia();
  if (date > today) {
    throw createAttendanceError(
      "FUTURE_ATTENDANCE_DATE",
      "Attendance date cannot be in the future"
    );
  }
  return date;
};

const ATTENDANCE_STATUSES = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "LEAVE",
  "HALF_DAY",
];

const validateStatus = (status) => {
  if (!ATTENDANCE_STATUSES.includes(status)) {
    throw createAttendanceError(
      "INVALID_STATUS",
      `status must be one of ${ATTENDANCE_STATUSES.join(", ")}`
    );
  }
  return status;
};

const validateRemarks = (remarks) => {
  if (remarks === undefined || remarks === null) return null;
  if (typeof remarks !== "string") {
    throw createAttendanceError(
      "INVALID_REMARKS",
      "Remarks must be a string or null"
    );
  }
  const trimmed = remarks.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 500) {
    throw createAttendanceError(
      "INVALID_REMARKS",
      "Remarks cannot exceed 500 characters"
    );
  }
  return trimmed;
};

const toDateField = (dateString) =>
  new Date(`${dateString}T00:00:00.000Z`);

// ---------------------------------------------------------
// Student validator (single mark path)
// ---------------------------------------------------------

const validateStudent = async (studentId, instituteId, session = null) => {
  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createAttendanceError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  let query = User.findOne({
    _id: studentId,
    instituteId,
    role: "STUDENT",
    isDeleted: false,
  }).select("_id name batchId isActive accountStatus");

  if (session) query = query.session(session);
  const student = await query;

  if (!student) {
    throw createAttendanceError(
      "STUDENT_NOT_FOUND",
      "Student not found in this institute",
      404
    );
  }
  if (!student.isActive || student.accountStatus !== "ACTIVE") {
    throw createAttendanceError(
      "STUDENT_INACTIVE",
      "Student account is not active",
      409
    );
  }
  if (!student.batchId) {
    throw createAttendanceError(
      "NO_BATCH_ASSIGNED",
      "Student is not assigned to any batch",
      409
    );
  }

  return student;
};

// ---------------------------------------------------------
// 1. MARK SINGLE STUDENT ATTENDANCE
// ---------------------------------------------------------

const markStudentAttendance = async ({
  instituteId,
  studentId,
  status,
  remarks,
  attendanceDate,
  markedBy,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!markedBy || !mongoose.isValidObjectId(markedBy)) {
    throw createAttendanceError(
      "INVALID_MARKED_BY",
      "A valid markedBy user ID is required"
    );
  }

  const normalizedDate = validateAttendanceDate(attendanceDate);
  const normalizedStatus = validateStatus(status);
  const normalizedRemarks = validateRemarks(remarks);

  const student = await validateStudent(
    studentId,
    normalizedInstituteId
  );

  const session = await mongoose.startSession();
  let created = null;

  try {
    await session.withTransaction(async () => {
      const existing = await StudentAttendance.findOne({
        instituteId: normalizedInstituteId,
        studentId: student._id,
        attendanceDate: normalizedDate,
        isDeleted: false,
      }).session(session);

      if (existing) {
        throw createAttendanceError(
          "DUPLICATE_ATTENDANCE",
          "Attendance already marked for this student on this date",
          409
        );
      }

      [created] = await StudentAttendance.create(
        [
          {
            studentId: student._id,
            instituteId: normalizedInstituteId,
            batchId: student.batchId,
            attendanceDate: normalizedDate,
            date: toDateField(normalizedDate),
            status: normalizedStatus,
            remarks: normalizedRemarks,
            markedBy,
            markedVia: "MANUAL",
          },
        ],
        { session }
      );
    });

    return created;
  } catch (error) {
    if (error.code === 11000) {
      throw createAttendanceError(
        "DUPLICATE_ATTENDANCE",
        "Attendance already marked for this student on this date",
        409
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 2. BULK MARK (all-or-nothing transaction)
// ---------------------------------------------------------

const bulkMarkStudentAttendance = async ({
  instituteId,
  batchId,
  attendanceDate,
  entries,
  markedBy,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!markedBy || !mongoose.isValidObjectId(markedBy)) {
    throw createAttendanceError(
      "INVALID_MARKED_BY",
      "A valid markedBy user ID is required"
    );
  }

  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createAttendanceError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const normalizedDate = validateAttendanceDate(attendanceDate);

  if (!Array.isArray(entries) || entries.length === 0) {
    throw createAttendanceError(
      "INVALID_ENTRIES",
      "entries must be a non-empty array"
    );
  }

  // Pre-validate batch (active + same institute)
  const batch = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  })
    .select("_id classId status")
    .lean();

  if (!batch) {
    throw createAttendanceError(
      "BATCH_NOT_FOUND",
      "Batch not found in this institute",
      404
    );
  }
  if (batch.status !== "ACTIVE") {
    throw createAttendanceError(
      "BATCH_INACTIVE",
      "Cannot mark attendance for an inactive batch",
      409
    );
  }

  // Normalize + validate entries
  const seenStudentIds = new Set();
  const normalizedEntries = entries.map((entry, idx) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw createAttendanceError(
        "INVALID_ENTRY",
        `Entry at index ${idx} must be an object`
      );
    }
    if (
      !entry.studentId ||
      !mongoose.isValidObjectId(entry.studentId)
    ) {
      throw createAttendanceError(
        "INVALID_STUDENT_ID",
        `Invalid studentId at index ${idx}`
      );
    }
    const key = String(entry.studentId);
    if (seenStudentIds.has(key)) {
      throw createAttendanceError(
        "DUPLICATE_STUDENT_IN_BATCH",
        `Duplicate studentId at index ${idx}`
      );
    }
    seenStudentIds.add(key);

    return {
      studentId: entry.studentId,
      status: validateStatus(entry.status),
      remarks: validateRemarks(entry.remarks),
    };
  });

  // Verify all students: exist, active, in this batch
  const studentIds = normalizedEntries.map((e) => e.studentId);
  const students = await User.find({
    _id: { $in: studentIds },
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  })
    .select("_id batchId isActive accountStatus")
    .lean();

  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  for (const entry of normalizedEntries) {
    const student = studentMap.get(String(entry.studentId));
    if (!student) {
      throw createAttendanceError(
        "STUDENT_NOT_FOUND",
        `Student ${entry.studentId} not found in this institute`,
        404
      );
    }
    if (!student.isActive || student.accountStatus !== "ACTIVE") {
      throw createAttendanceError(
        "STUDENT_INACTIVE",
        `Student ${entry.studentId} is not active`,
        409
      );
    }
    if (String(student.batchId) !== String(batchId)) {
      throw createAttendanceError(
        "BATCH_MISMATCH",
        `Student ${entry.studentId} is not in the specified batch`,
        409
      );
    }
  }

  // Pre-check duplicate (avoid full transaction if known-conflict)
  const existing = await StudentAttendance.find({
    instituteId: normalizedInstituteId,
    studentId: { $in: studentIds },
    attendanceDate: normalizedDate,
    isDeleted: false,
  })
    .select("studentId")
    .lean();

  if (existing.length > 0) {
    const conflictIds = existing.map((e) => String(e.studentId));
    throw createAttendanceError(
      "DUPLICATE_ATTENDANCE",
      `Attendance already marked for ${conflictIds.length} student(s): ${conflictIds.join(", ")}`,
      409
    );
  }

  // Atomic bulk insert (all-or-nothing)
  const session = await mongoose.startSession();
  let created = [];

  try {
    await session.withTransaction(async () => {
      const docs = normalizedEntries.map((e) => ({
        studentId: e.studentId,
        instituteId: normalizedInstituteId,
        batchId,
        attendanceDate: normalizedDate,
        date: toDateField(normalizedDate),
        status: e.status,
        remarks: e.remarks,
        markedBy,
        markedVia: "MANUAL",
      }));

      created = await StudentAttendance.insertMany(docs, { session });
    });

    return created;
  } catch (error) {
    if (error.code === 11000) {
      throw createAttendanceError(
        "DUPLICATE_ATTENDANCE",
        "Attendance already marked for one or more students on this date",
        409
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

// ---------------------------------------------------------
// 3. LIST (paginated, filters)
// ---------------------------------------------------------

const listStudentAttendance = async ({
  instituteId,
  studentId,
  batchId,
  allowedBatchIds,
  from,
  to,
  status,
  page = 1,
  limit = 50,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  const filter = {
    instituteId: normalizedInstituteId,
    isDeleted: false,
  };

  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      throw createAttendanceError(
        "INVALID_STUDENT_ID",
        "Invalid studentId"
      );
    }
    filter.studentId = studentId;
  }

  if (allowedBatchIds && Array.isArray(allowedBatchIds)) {
    // Teacher scope: restrict to assigned batches
    if (batchId) {
      if (!mongoose.isValidObjectId(batchId)) {
        throw createAttendanceError(
          "INVALID_BATCH_ID",
          "Invalid batchId"
        );
      }
      if (
        !allowedBatchIds.some(
          (id) => String(id) === String(batchId)
        )
      ) {
        throw createAttendanceError(
          "TEACHER_NOT_ASSIGNED_TO_BATCH",
          "Teacher is not assigned to this batch",
          403
        );
      }
      filter.batchId = batchId;
    } else {
      filter.batchId = { $in: allowedBatchIds };
    }
  } else if (batchId) {
    if (!mongoose.isValidObjectId(batchId)) {
      throw createAttendanceError(
        "INVALID_BATCH_ID",
        "Invalid batchId"
      );
    }
    filter.batchId = batchId;
  }

  if (from || to) {
    if (
      (from && !isValidCalendarDate(from)) ||
      (to && !isValidCalendarDate(to))
    ) {
      throw createAttendanceError(
        "INVALID_DATE_RANGE",
        "from/to must be valid YYYY-MM-DD dates"
      );
    }
    if (from && to && from > to) {
      throw createAttendanceError(
        "INVALID_DATE_RANGE",
        "from date cannot be after to date"
      );
    }
    filter.attendanceDate = {};
    if (from) filter.attendanceDate.$gte = from;
    if (to) filter.attendanceDate.$lte = to;
  }

  if (status) {
    filter.status = validateStatus(status);
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    StudentAttendance.find(filter)
      .populate({
        path: "studentId",
        select: "name email batchId",
      })
      .populate({
        path: "markedBy",
        select: "name email role",
      })
      .sort({ attendanceDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    StudentAttendance.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};

// ---------------------------------------------------------
// 4. GET SINGLE
// ---------------------------------------------------------

const getStudentAttendance = async ({ instituteId, attendanceId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!attendanceId || !mongoose.isValidObjectId(attendanceId)) {
    throw createAttendanceError(
      "INVALID_ATTENDANCE_ID",
      "A valid attendanceId is required"
    );
  }

  const attendance = await StudentAttendance.findOne({
    _id: attendanceId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  })
    .populate({
      path: "studentId",
      select: "name email batchId",
    })
    .populate({
      path: "markedBy",
      select: "name email role",
    })
    .lean();

  if (!attendance) {
    throw createAttendanceError(
      "ATTENDANCE_NOT_FOUND",
      "Attendance record not found",
      404
    );
  }

  return attendance;
};

// ---------------------------------------------------------
// 5. UPDATE (status + remarks only)
// ---------------------------------------------------------

const ALLOWED_UPDATE_FIELDS = ["status", "remarks"];
const IMMUTABLE_FIELDS = [
  "attendanceDate",
  "studentId",
  "batchId",
  "instituteId",
  "markedBy",
];

const updateStudentAttendance = async ({
  instituteId,
  attendanceId,
  updates,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!attendanceId || !mongoose.isValidObjectId(attendanceId)) {
    throw createAttendanceError(
      "INVALID_ATTENDANCE_ID",
      "A valid attendanceId is required"
    );
  }

  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw createAttendanceError(
      "INVALID_UPDATES",
      "Updates must be an object"
    );
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw createAttendanceError(
      "EMPTY_UPDATES",
      "At least one update field is required"
    );
  }

  for (const field of IMMUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      throw createAttendanceError(
        "IMMUTABLE_FIELD",
        `${field} cannot be changed; delete and re-mark instead`
      );
    }
  }

  const unknown = keys.filter(
    (k) => !ALLOWED_UPDATE_FIELDS.includes(k)
  );
  if (unknown.length > 0) {
    throw createAttendanceError(
      "UNSUPPORTED_UPDATE_FIELDS",
      `Unsupported fields: ${unknown.join(", ")}`
    );
  }

  const safeUpdates = {};
  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    safeUpdates.status = validateStatus(updates.status);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "remarks")) {
    safeUpdates.remarks = validateRemarks(updates.remarks);
  }

  const attendance = await StudentAttendance.findOne({
    _id: attendanceId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!attendance) {
    throw createAttendanceError(
      "ATTENDANCE_NOT_FOUND",
      "Attendance record not found",
      404
    );
  }

  attendance.set(safeUpdates);
  await attendance.save();

  return attendance;
};

// ---------------------------------------------------------
// 6. DELETE (soft delete)
// ---------------------------------------------------------

const deleteStudentAttendance = async ({
  instituteId,
  attendanceId,
  reason,
  actorId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!attendanceId || !mongoose.isValidObjectId(attendanceId)) {
    throw createAttendanceError(
      "INVALID_ATTENDANCE_ID",
      "A valid attendanceId is required"
    );
  }

  if (!actorId || !mongoose.isValidObjectId(actorId)) {
    throw createAttendanceError(
      "INVALID_ACTOR_ID",
      "A valid actor ID is required"
    );
  }

  if (
    reason !== undefined &&
    reason !== null &&
    typeof reason !== "string"
  ) {
    throw createAttendanceError(
      "INVALID_REASON",
      "Delete reason must be a string or null"
    );
  }

  const attendance = await StudentAttendance.findOne({
    _id: attendanceId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  });

  if (!attendance) {
    throw createAttendanceError(
      "ATTENDANCE_NOT_FOUND",
      "Attendance record not found",
      404
    );
  }

  attendance.isDeleted = true;
  attendance.deletedBy = actorId;
  attendance.deletedAt = new Date();
  attendance.deleteReason =
    reason === undefined || reason === null || reason.trim() === ""
      ? null
      : reason.trim();

  await attendance.save();

  return attendance;
};

// ---------------------------------------------------------
// 7. SUMMARY BY STUDENT
// ---------------------------------------------------------

const getStudentAttendanceSummary = async ({
  instituteId,
  studentId,
  from,
  to,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!studentId || !mongoose.isValidObjectId(studentId)) {
    throw createAttendanceError(
      "INVALID_STUDENT_ID",
      "A valid studentId is required"
    );
  }

  const student = await User.findOne({
    _id: studentId,
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    isDeleted: false,
  })
    .select("_id name email batchId")
    .lean();

  if (!student) {
    throw createAttendanceError(
      "STUDENT_NOT_FOUND",
      "Student not found in this institute",
      404
    );
  }

  if (
    (from && !isValidCalendarDate(from)) ||
    (to && !isValidCalendarDate(to))
  ) {
    throw createAttendanceError(
      "INVALID_DATE_RANGE",
      "from/to must be valid YYYY-MM-DD dates"
    );
  }
  if (from && to && from > to) {
    throw createAttendanceError(
      "INVALID_DATE_RANGE",
      "from date cannot be after to date"
    );
  }

  const match = {
    studentId: student._id,
    instituteId: new mongoose.Types.ObjectId(String(normalizedInstituteId)),
    isDeleted: false,
  };

  if (from || to) {
    match.attendanceDate = {};
    if (from) match.attendanceDate.$gte = from;
    if (to) match.attendanceDate.$lte = to;
  }

  const aggregation = await StudentAttendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = {
    PRESENT: 0,
    ABSENT: 0,
    LATE: 0,
    LEAVE: 0,
    HALF_DAY: 0,
  };

  for (const item of aggregation) {
    if (Object.prototype.hasOwnProperty.call(counts, item._id)) {
      counts[item._id] = item.count;
    }
  }

  const totalAttendance = Object.values(counts).reduce(
    (a, b) => a + b,
    0
  );

  return {
    student: {
      id: student._id,
      name: student.name,
      email: student.email,
      batchId: student.batchId,
    },
    filters: {
      from: from || null,
      to: to || null,
    },
    summary: {
      totalAttendance,
      present: counts.PRESENT,
      absent: counts.ABSENT,
      late: counts.LATE,
      leave: counts.LEAVE,
      halfDay: counts.HALF_DAY,
    },
  };
};

// ---------------------------------------------------------
// 8. SUMMARY BY BATCH PER DATE (roster view)
// ---------------------------------------------------------

const getBatchAttendanceSummary = async ({
  instituteId,
  batchId,
  attendanceDate,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createAttendanceError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const normalizedDate = validateAttendanceDate(attendanceDate);

  const batch = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
  })
    .select("_id name classId status")
    .lean();

  if (!batch) {
    throw createAttendanceError(
      "BATCH_NOT_FOUND",
      "Batch not found in this institute",
      404
    );
  }

  const totalStudents = await User.countDocuments({
    instituteId: normalizedInstituteId,
    role: "STUDENT",
    batchId,
    isDeleted: false,
    isActive: true,
    accountStatus: "ACTIVE",
  });

 const aggregation = await StudentAttendance.aggregate([
    {
      $match: {
        instituteId: new mongoose.Types.ObjectId(String(normalizedInstituteId)),
        batchId: new mongoose.Types.ObjectId(String(batchId)),
        attendanceDate: normalizedDate,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = {
    PRESENT: 0,
    ABSENT: 0,
    LATE: 0,
    LEAVE: 0,
    HALF_DAY: 0,
  };

  for (const item of aggregation) {
    if (Object.prototype.hasOwnProperty.call(counts, item._id)) {
      counts[item._id] = item.count;
    }
  }

  const marked = Object.values(counts).reduce((a, b) => a + b, 0);
  const unmarked = Math.max(totalStudents - marked, 0);

  return {
    batch: {
      id: batch._id,
      name: batch.name,
      classId: batch.classId,
      status: batch.status,
    },
    date: normalizedDate,
    totalStudents,
    marked,
    unmarked,
    present: counts.PRESENT,
    absent: counts.ABSENT,
    late: counts.LATE,
    leave: counts.LEAVE,
    halfDay: counts.HALF_DAY,
  };
};


// ---------------------------------------------------------
// 9. TEACHER SCOPE HELPERS (.17.12)
// ---------------------------------------------------------

/*
 * Returns IDs of all batches where the teacher is assigned
 * (via Batch.teachers[].teacherId).
 */
const getTeacherBatchIds = async ({ instituteId, teacherId }) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
    throw createAttendanceError(
      "INVALID_TEACHER_ID",
      "A valid teacherId is required"
    );
  }

  const batches = await Batch.find({
    instituteId: normalizedInstituteId,
    isDeleted: false,
    "teachers.teacherId": teacherId,
  })
    .select("_id")
    .lean();

  return batches.map((b) => b._id);
};

/*
 * Asserts that the teacher is assigned to the given batch.
 * Throws 403 TEACHER_NOT_ASSIGNED_TO_BATCH if not.
 */
const assertTeacherOwnsBatch = async ({
  instituteId,
  teacherId,
  batchId,
}) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
    throw createAttendanceError(
      "INVALID_TEACHER_ID",
      "A valid teacherId is required"
    );
  }
  if (!batchId || !mongoose.isValidObjectId(batchId)) {
    throw createAttendanceError(
      "INVALID_BATCH_ID",
      "A valid batchId is required"
    );
  }

  const batch = await Batch.findOne({
    _id: batchId,
    instituteId: normalizedInstituteId,
    isDeleted: false,
    "teachers.teacherId": teacherId,
  })
    .select("_id")
    .lean();

  if (!batch) {
    throw createAttendanceError(
      "TEACHER_NOT_ASSIGNED_TO_BATCH",
      "Teacher is not assigned to this batch",
      403
    );
  }

  return batch;
};

module.exports = {
  markStudentAttendance,
  bulkMarkStudentAttendance,
  listStudentAttendance,
  getStudentAttendance,
  updateStudentAttendance,
  deleteStudentAttendance,
  getStudentAttendanceSummary,
  getBatchAttendanceSummary,
  getTeacherBatchIds,
  assertTeacherOwnsBatch,
};