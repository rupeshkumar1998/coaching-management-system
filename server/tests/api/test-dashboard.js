require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Teacher = require("../../models/Teacher");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdTeacherIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdAttendanceIds = [];

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
    code: `DB_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Dashboard Test Institute",
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
  const hashed = await hashPassword("TempPass1234");
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: `DB ${role}`,
    email: `db-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: hashed,
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
  createdTeacherIds.push(id);
  return id;
};

const makeClass = async (instituteId, ownerId) => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name: `Class ${randomUUID().slice(0, 8)}`,
    description: "",
    isActive: true,
    isDeleted: false,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClassIds.push(id);
  return id;
};

const makeBatch = async (instituteId, classId, ownerId) => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name: `Batch ${randomUUID().slice(0, 8)}`,
    teachers: [],
    schedule: null,
    status: "ACTIVE",
    isDeleted: false,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const setupOwner = async () => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  await Institute.collection.updateOne(
    { _id: instituteId },
    { $set: { ownerId } }
  );
  return { instituteId, ownerId, ownerToken: makeToken(ownerId) };
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

    // D1: No auth → 401
    await test("D1: No auth → 401", async () => {
      const res = await request("/api/owner/dashboard/summary");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    // D2: Shape + all 7 sections present
    await test(
      "D2: Dashboard returns 7 sections with correct shape",
      async () => {
        const ctx = await setupOwner();
        const res = await request("/api/owner/dashboard/summary", {
          token: ctx.ownerToken,
        });

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        const d = res.data.data;

        assert(d.students && typeof d.students.total === "number", "students");
        assert(d.teachers && typeof d.teachers.total === "number", "teachers");
        assert(d.batches && typeof d.batches.total === "number", "batches");
        assert(d.classes && typeof d.classes.total === "number", "classes");
        assert(d.fees && typeof d.fees.totalFees === "number", "fees");
        assert(d.attendance && d.attendance.today, "attendance.today");
        assert(d.attendance && d.attendance.last7Days, "attendance.last7Days");
        assert(d.subscription !== undefined, "subscription field exists");
      }
    );

    // D3: Counts accurate
    await test(
      "D3: Students/teachers/batches/classes counts accurate",
      async () => {
        const ctx = await setupOwner();

        // 2 active students
        await makeUser("STUDENT", ctx.instituteId);
        await makeUser("STUDENT", ctx.instituteId);
        // 1 inactive student (isDeleted=false but isActive=false)
        await makeUser("STUDENT", ctx.instituteId, {
          isActive: false,
          accountStatus: "SUSPENDED",
        });

        // 2 active teachers, 1 on leave
        const t1 = await makeUser("TEACHER", ctx.instituteId);
        const t2 = await makeUser("TEACHER", ctx.instituteId);
        const t3 = await makeUser("TEACHER", ctx.instituteId);
        await makeTeacherProfile(ctx.instituteId, t1, "ACTIVE");
        await makeTeacherProfile(ctx.instituteId, t2, "ACTIVE");
        await makeTeacherProfile(ctx.instituteId, t3, "ON_LEAVE");

        // 1 class + 2 batches (1 active, 1 inactive)
        const classId = await makeClass(ctx.instituteId, ctx.ownerId);
        await makeBatch(ctx.instituteId, classId, ctx.ownerId);
        const inactiveBatchId = new mongoose.Types.ObjectId();
        await Batch.collection.insertOne({
          _id: inactiveBatchId,
          instituteId: ctx.instituteId,
          classId,
          name: `Inactive ${randomUUID().slice(0, 8)}`,
          teachers: [],
          schedule: null,
          status: "INACTIVE",
          isDeleted: false,
          createdBy: ctx.ownerId,
          updatedBy: ctx.ownerId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdBatchIds.push(inactiveBatchId);

        const res = await request("/api/owner/dashboard/summary", {
          token: ctx.ownerToken,
        });

        assert(res.status === 200, `status ${res.status}`);
        const d = res.data.data;

        assert(d.students.total === 3, `students.total ${d.students.total}`);
        assert(d.students.active === 2, `students.active ${d.students.active}`);
        assert(d.students.inactive === 1, `students.inactive ${d.students.inactive}`);
        assert(d.teachers.total === 3, `teachers.total ${d.teachers.total}`);
        assert(d.teachers.active === 2, `teachers.active ${d.teachers.active}`);
        assert(d.teachers.onLeave === 1, `teachers.onLeave ${d.teachers.onLeave}`);
        assert(d.classes.total === 1, `classes.total ${d.classes.total}`);
        assert(d.batches.total === 2, `batches.total ${d.batches.total}`);
        assert(d.batches.active === 1, `batches.active ${d.batches.active}`);
      }
    );

    // D4: Attendance today + last7Days
    await test(
      "D4: Attendance today + last7Days populated correctly",
      async () => {
        const ctx = await setupOwner();
        const classId = await makeClass(ctx.instituteId, ctx.ownerId);
        const batchId = await makeBatch(ctx.instituteId, classId, ctx.ownerId);

        // 2 students
        const s1 = await makeUser("STUDENT", ctx.instituteId, { batchId });
        const s2 = await makeUser("STUDENT", ctx.instituteId, { batchId });

        // 2 attendance today: PRESENT, ABSENT
        const a1 = new mongoose.Types.ObjectId();
        await StudentAttendance.collection.insertOne({
          _id: a1,
          instituteId: ctx.instituteId,
          studentId: s1,
          batchId,
          attendanceDate: today,
          date: new Date(`${today}T00:00:00.000Z`),
          status: "PRESENT",
          markedBy: ctx.ownerId,
          markedVia: "MANUAL",
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdAttendanceIds.push(a1);

        const a2 = new mongoose.Types.ObjectId();
        await StudentAttendance.collection.insertOne({
          _id: a2,
          instituteId: ctx.instituteId,
          studentId: s2,
          batchId,
          attendanceDate: today,
          date: new Date(`${today}T00:00:00.000Z`),
          status: "ABSENT",
          markedBy: ctx.ownerId,
          markedVia: "MANUAL",
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdAttendanceIds.push(a2);

        const res = await request("/api/owner/dashboard/summary", {
          token: ctx.ownerToken,
        });

        assert(res.status === 200, `status ${res.status}`);
        const att = res.data.data.attendance;

        assert(att.today.date === today, "today date");
        assert(att.today.marked === 2, `today.marked ${att.today.marked}`);
        assert(att.today.present === 1, `today.present ${att.today.present}`);
        assert(att.today.absent === 1, `today.absent ${att.today.absent}`);
        assert(att.last7Days.totalRecords === 2, `last7Days.totalRecords ${att.last7Days.totalRecords}`);
      }
    );

    // D5: Admin without DASHBOARD_READ → 403
    await test(
      "D5: Admin without DASHBOARD_READ → 403",
      async () => {
        const ctx = await setupOwner();
        const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);

        const res = await request("/api/owner/dashboard/summary", {
          token: makeToken(adminId),
        });

        assert(res.status === 403, `expected 403, got ${res.status}`);
      }
    );

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
    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({ _id: { $in: createdBatchIds } });
    }
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
    }
    if (createdTeacherIds.length) {
      await Teacher.collection.deleteMany({ _id: { $in: createdTeacherIds } });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});