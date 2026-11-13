require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");

const createdInstituteIds = [];
const createdUserIds = [];
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

const shiftDate = (base, days) => {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `AR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Attendance Route Test Institute",
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
    name: `AR ${role}`,
    email: `ar-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeBatch = async (instituteId, classId, actorId, name = "Batch A") => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name,
    teachers: [],
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

const setupOwner = async () => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId, ownerId);
  const batchId = await makeBatch(instituteId, classId, ownerId);
  const studentId = await makeUser("STUDENT", instituteId, { batchId });
  return {
    instituteId,
    ownerId,
    classId,
    batchId,
    studentId,
    token: makeToken(ownerId),
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
    // A. Auth + role gate
    // =====================================================

    await test("A1: no auth ΓåÆ 401", async () => {
      const res = await request("/api/owner/student-attendance");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: STUDENT role ΓåÆ 403", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const res = await request("/api/owner/student-attendance", {
        token: makeToken(studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: TEACHER with ATTENDANCE_MARK ΓåÆ 403 (role gate blocks owner route)", async () => {
      const instituteId = await makeInstitute();
      const teacherUserId = await makeUser("TEACHER", instituteId);
      const permId = await makePermission("ATTENDANCE_MARK");
      await makeUserPermission(teacherUserId, instituteId, permId);

      const res = await request("/api/owner/student-attendance", {
        token: makeToken(teacherUserId),
      });
      assert(
        res.status === 403,
        `expected 403 (role gate), got ${res.status}: ${JSON.stringify(res.data)}`
      );
    });

    // =====================================================
    // B. Owner happy paths
    // =====================================================

    await test("B1: Owner mark attendance ΓåÆ 201", async () => {
      const ctx = await setupOwner();
      const res = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
          remarks: "On time",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.data.attendance.status === "PRESENT", "status");
      assert(res.data.data.attendance.markedVia === "MANUAL", "markedVia");
      createdAttendanceIds.push(new mongoose.Types.ObjectId(res.data.data.attendance.id));
    });

    await test("B2: Owner bulk mark ΓåÆ 201", async () => {
      const ctx = await setupOwner();
      const s2 = await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });
      const s3 = await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });

      const res = await request("/api/owner/student-attendance/bulk", {
        method: "POST",
        token: ctx.token,
        body: {
          batchId: String(ctx.batchId),
          attendanceDate: today,
          entries: [
            { studentId: String(ctx.studentId), status: "PRESENT" },
            { studentId: String(s2), status: "ABSENT" },
            { studentId: String(s3), status: "LATE", remarks: "10 min" },
          ],
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(res.data.count === 3, `expected 3, got ${res.data.count}`);
      res.data.data.attendance.forEach((a) =>
        createdAttendanceIds.push(new mongoose.Types.ObjectId(a.id))
      );
    });

    await test("B3: Owner list ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(markRes.data.data.attendance.id));

      const res = await request("/api/owner/student-attendance", { token: ctx.token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.count === 1, `expected 1, got ${res.data.count}`);
      assert(res.data.pagination.total === 1, "pagination");
    });

    await test("B4: Owner get single ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      const attId = markRes.data.data.attendance.id;
      createdAttendanceIds.push(new mongoose.Types.ObjectId(attId));

      const res = await request(`/api/owner/student-attendance/${attId}`, {
        token: ctx.token,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.attendance.id === attId, "id");
      assert(res.data.data.attendance.studentId.name, "populated studentId");
    });

    await test("B5: Owner patch status ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      const attId = markRes.data.data.attendance.id;
      createdAttendanceIds.push(new mongoose.Types.ObjectId(attId));

      const res = await request(`/api/owner/student-attendance/${attId}`, {
        method: "PATCH",
        token: ctx.token,
        body: { status: "LATE" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.attendance.status === "LATE", "status updated");
    });

    await test("B6: Owner delete (soft) + re-mark ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "ABSENT",
          attendanceDate: today,
        },
      });
      const attId = markRes.data.data.attendance.id;
      createdAttendanceIds.push(new mongoose.Types.ObjectId(attId));

      const delRes = await request(`/api/owner/student-attendance/${attId}`, {
        method: "DELETE",
        token: ctx.token,
        body: { reason: "Wrong entry" },
      });
      assert(delRes.status === 200, `del expected 200, got ${delRes.status}`);
      assert(delRes.data.data.attendance.isDeleted === true, "isDeleted");

      const reMarkRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      assert(reMarkRes.status === 201, `re-mark expected 201, got ${reMarkRes.status}`);
      createdAttendanceIds.push(new mongoose.Types.ObjectId(reMarkRes.data.data.attendance.id));
    });

    // =====================================================
    // C. Summaries
    // =====================================================

    await test("C1: Owner student summary ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(markRes.data.data.attendance.id));

      const res = await request(
        `/api/owner/student-attendance/summary/student/${ctx.studentId}`,
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.summary.totalAttendance === 1, "total");
      assert(res.data.data.summary.present === 1, "present");
    });

    await test("C2: Owner batch summary ΓåÆ 200", async () => {
      const ctx = await setupOwner();
      const s2 = await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });

      const markRes = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(markRes.data.data.attendance.id));

      const res = await request(
        `/api/owner/student-attendance/summary/batch/${ctx.batchId}?date=${today}`,
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.totalStudents === 2, `total ${res.data.data.totalStudents}`);
      assert(res.data.data.marked === 1, "marked");
      assert(res.data.data.unmarked === 1, "unmarked");
    });

    // =====================================================
    // D. Errors
    // =====================================================

    await test("D1: duplicate attendance ΓåÆ 409", async () => {
      const ctx = await setupOwner();
      const first = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "PRESENT",
          attendanceDate: today,
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(first.data.data.attendance.id));

      const second = await request("/api/owner/student-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          studentId: String(ctx.studentId),
          status: "ABSENT",
          attendanceDate: today,
        },
      });
      assert(second.status === 409, `expected 409, got ${second.status}`);
      assert(second.data.code === "DUPLICATE_ATTENDANCE", `got ${second.data.code}`);
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