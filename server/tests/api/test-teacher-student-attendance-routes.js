require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Teacher = require("../../models/Teacher");
const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");

const createdInstituteIds = [];
const createdUserIds = [];
const createdTeacherProfileIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdAttendanceIds = [];
const createdPermissionIds = [];
const createdUserPermissionIds = [];

let passed = 0;
let failed = 0;
let server = null;
let baseUrl = null;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

const makeToken = (userId) =>
  jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const request = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Cookie: `accessToken=${options.token}` } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
};

const getTodayInIndia = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `TR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Teacher Attendance Route Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(id);
  return id;
};

const makeUser = async (role, instituteId, extras = {}) => {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: `TR ${role}`,
    email: `tr-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    ...extras,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return id;
};

const makeTeacherProfile = async (instituteId, userId, status = "ACTIVE") => {
  const id = new mongoose.Types.ObjectId();
  await Teacher.collection.insertOne({
    _id: id,
    userId,
    instituteId,
    status,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdTeacherProfileIds.push(id);
  return id;
};

const makeClass = async (instituteId, actorId) => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name: "Class 10",
    description: "",
    isActive: true,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClassIds.push(id);
  return id;
};

const makeBatch = async (
  instituteId,
  classId,
  actorId,
  teacherUserIds = [],
  name = "Batch A"
) => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name,
    teachers: teacherUserIds.map((tid) => ({ teacherId: tid, subject: "MATH" })),
    schedule: null,
    status: "ACTIVE",
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const makePermission = async (key) => {
  const existing = await Permission.findOne({ permissionKey: key }).lean();
  if (existing) return existing._id;
  const id = new mongoose.Types.ObjectId();
  await Permission.collection.insertOne({
    _id: id,
    permissionKey: key,
    isActive: true,
    category: "OPERATIONAL",
    resource: key.split("_")[0],
    action: key.split("_")[1],
    description: key,
    isDelegatable: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPermissionIds.push(id);
  return id;
};

const makeUserPermission = async (userId, instituteId, permissionId) => {
  const id = new mongoose.Types.ObjectId();
  await UserPermission.collection.insertOne({
    _id: id,
    userId,
    instituteId,
    permissionId,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserPermissionIds.push(id);
  return id;
};

const setupTeacher = async ({ withPermission = true } = {}) => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const teacherUserId = await makeUser("TEACHER", instituteId);
  await makeTeacherProfile(instituteId, teacherUserId);
  const classId = await makeClass(instituteId, ownerId);
  const batchId = await makeBatch(instituteId, classId, ownerId, [teacherUserId]);
  const studentId = await makeUser("STUDENT", instituteId, { batchId });

  if (withPermission) {
    for (const key of [
      "ATTENDANCE_MARK",
      "ATTENDANCE_READ",
      "ATTENDANCE_UPDATE",
    ]) {
      const p = await makePermission(key);
      await makeUserPermission(teacherUserId, instituteId, p);
    }
  }

  return {
    instituteId,
    ownerId,
    teacherUserId,
    classId,
    batchId,
    studentId,
    token: makeToken(teacherUserId),
  };
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await StudentAttendance.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    const today = getTodayInIndia();

    // =====================================================
    // A. Auth + profile resolution
    // =====================================================

    await test("A1: no auth ΓåÆ 401", async () => {
      const res = await request("/api/teacher/student-attendance");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: STUDENT role ΓåÆ 403 (requireTeacherProfile)", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const res = await request("/api/teacher/student-attendance", {
        token: makeToken(studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: TEACHER without Teacher profile ΓåÆ 403", async () => {
      const instituteId = await makeInstitute();
      const teacherUserId = await makeUser("TEACHER", instituteId);
      // No Teacher profile created

      const res = await request("/api/teacher/student-attendance", {
        token: makeToken(teacherUserId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Permission check
    // =====================================================

    await test("B1: TEACHER with profile but no ATTENDANCE_READ ΓåÆ 403", async () => {
      const ctx = await setupTeacher({ withPermission: false });
      const res = await request("/api/teacher/student-attendance", {
        token: ctx.token,
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(
        res.data.message.toLowerCase().includes("permission"),
        `message: ${res.data.message}`
      );
    });

    // =====================================================
    // C. Happy paths
    // =====================================================

    await test("C1: Teacher bulk mark own batch ΓåÆ 201", async () => {
      const ctx = await setupTeacher();
      const res = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [
            { studentId: String(ctx.studentId), status: "PRESENT" },
          ],
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.count === 1, "count");
      createdAttendanceIds.push(
        new mongoose.Types.ObjectId(res.data.data.attendance[0].id)
      );
    });

    await test("C2: Teacher list own batches ΓåÆ 200", async () => {
      const ctx = await setupTeacher();
      const markRes = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [
            { studentId: String(ctx.studentId), status: "PRESENT" },
          ],
        },
      });
      createdAttendanceIds.push(
        new mongoose.Types.ObjectId(markRes.data.data.attendance[0].id)
      );

      const res = await request("/api/teacher/student-attendance", {
        token: ctx.token,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.count === 1, "count");
    });

    // =====================================================
    // D. Patch remarks
    // =====================================================

    await test("D1: Teacher patch remarks ΓåÆ 200", async () => {
      const ctx = await setupTeacher();
      const markRes = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [
            { studentId: String(ctx.studentId), status: "PRESENT" },
          ],
        },
      });
      const attId = markRes.data.data.attendance[0].id;
      createdAttendanceIds.push(new mongoose.Types.ObjectId(attId));

      const res = await request(`/api/teacher/student-attendance/${attId}`, {
        method: "PATCH",
        token: ctx.token,
        body: { remarks: "Clarification added" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.attendance.remarks === "Clarification added", "remarks");
    });

    // =====================================================
    // E. Batch scope enforcement (Bug 1 verification)
    // =====================================================

    await test("E1: Teacher bulk mark other batch ΓåÆ 403 TEACHER_NOT_ASSIGNED", async () => {
      const ctx = await setupTeacher();
      // Create another batch NOT assigned to this teacher
      const otherBatchId = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.ownerId,
        [],              // no teachers
        "Batch Other"    // unique name (Batch A already exists)
      );
      const otherStudent = await makeUser("STUDENT", ctx.instituteId, {
        batchId: otherBatchId,
      });

      const res = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(otherBatchId),
          attendanceDate: today,
          entries: [
            { studentId: String(otherStudent), status: "PRESENT" },
          ],
        },
      });
      assert(res.status === 403, `expected 403, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(
        res.data.code === "TEACHER_NOT_ASSIGNED_TO_BATCH",
        `got ${res.data.code}`
      );
    });

        // =====================================================
    // G  Student summary (teacher scope)
    // =====================================================

    await test("G1: Teacher views own student summary ΓåÆ 200", async () => {
      const ctx = await setupTeacher();
      const markRes = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [{ studentId: String(ctx.studentId), status: "PRESENT" }],
        },
      });
      createdAttendanceIds.push(
        new mongoose.Types.ObjectId(markRes.data.data.attendance[0].id)
      );

      const res = await request(
        `/api/teacher/student-attendance/summary/student/${ctx.studentId}`,
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.summary.totalAttendance === 1, "total");
    });

    await test("G2: Teacher views student in other batch ΓåÆ 403", async () => {
      const ctx = await setupTeacher();
      const otherBatchId = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.ownerId,
        [],
        "Batch Other Student"
      );
      const otherStudent = await makeUser("STUDENT", ctx.instituteId, {
        batchId: otherBatchId,
      });

      const res = await request(
        `/api/teacher/student-attendance/summary/student/${otherStudent}`,
        { token: ctx.token }
      );
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(
        res.data.code === "TEACHER_NOT_ASSIGNED_TO_BATCH",
        `code: ${res.data.code}`
      );
    });

    // =====================================================
    // F. Status update blocked (validator)
    // =====================================================

    await test("F1: Teacher patch status ΓåÆ 400 (validator blocks)", async () => {
      const ctx = await setupTeacher();
      const markRes = await request("/api/teacher/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [
            { studentId: String(ctx.studentId), status: "PRESENT" },
          ],
        },
      });
      const attId = markRes.data.data.attendance[0].id;
      createdAttendanceIds.push(new mongoose.Types.ObjectId(attId));

      const res = await request(`/api/teacher/student-attendance/${attId}`, {
        method: "PATCH",
        token: ctx.token,
        body: { status: "ABSENT" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdAttendanceIds.length) {
      await StudentAttendance.collection.deleteMany({
        _id: { $in: createdAttendanceIds },
      });
    }
    if (createdUserPermissionIds.length) {
      await UserPermission.collection.deleteMany({ _id: { $in: createdUserPermissionIds } });
    }
    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({ _id: { $in: createdBatchIds } });
    }
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
    }
    if (createdTeacherProfileIds.length) {
      await Teacher.collection.deleteMany({ _id: { $in: createdTeacherProfileIds } });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdPermissionIds.length) {
      await Permission.collection.deleteMany({ _id: { $in: createdPermissionIds } });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({ _id: { $in: createdInstituteIds } });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});