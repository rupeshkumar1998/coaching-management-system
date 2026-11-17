require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Teacher = require("../../models/Teacher");
const Attendance = require("../../models/Attendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");

const createdInstituteIds = [];
const createdUserIds = [];
const createdTeacherProfileIds = [];
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

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `TL_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Teacher Late Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(id);
  return id;
};

const makeUser = async (role, instituteId) => {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: `TL ${role}`,
    email: `tl-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return id;
};

const makeTeacherProfile = async (instituteId, userId) => {
  const id = new mongoose.Types.ObjectId();
  await Teacher.collection.insertOne({
    _id: id,
    userId,
    instituteId,
    status: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdTeacherProfileIds.push(id);
  return id;
};

const setupContext = async () => {
  const instituteId = await makeInstitute();
  // Owner bypasses permission middleware (industry pattern for
  // integration tests that verify business logic, not permissions).
  // Permission tests for admin access live in test-permission-* files.
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const teacherUserId = await makeUser("TEACHER", instituteId);
  const teacherProfileId = await makeTeacherProfile(instituteId, teacherUserId);
  return {
    instituteId,
    ownerId,
    adminId: ownerId, // backwards-compat with existing test bodies
    teacherUserId,
    teacherProfileId,
    token: makeToken(ownerId),
  };
};

const run = async () => {
  await connectTestDB();
  await Attendance.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    const today = getTodayInIndia();

    // TEST 1 — Mark LATE
    await test("T1: Admin marks LATE ΓåÆ 201", async () => {
      const ctx = await setupContext();
      const res = await request("/api/admin/teacher-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          teacherId: String(ctx.teacherProfileId),
          date: today,
          status: "LATE",
          remarks: "15 minutes late",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.data.attendance.status === "LATE", `status: ${res.data.data.attendance.status}`);
      assert(res.data.data.attendance.attendanceDate === today, "attendanceDate");
      createdAttendanceIds.push(new mongoose.Types.ObjectId(res.data.data.attendance.id));
    });

    // TEST 2 — Invalid status
    await test("T2: Invalid status ΓåÆ 400", async () => {
      const ctx = await setupContext();
      const res = await request("/api/admin/teacher-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          teacherId: String(ctx.teacherProfileId),
          date: today,
          status: "UNKNOWN",
        },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    // TEST 3 — Summary counts LATE
    await test("T3: Summary includes late count", async () => {
      const ctx = await setupContext();
      const markRes = await request("/api/admin/teacher-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          teacherId: String(ctx.teacherProfileId),
          date: today,
          status: "LATE",
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(markRes.data.data.attendance.id));

      const res = await request(
        `/api/admin/teacher-attendance/teacher/${ctx.teacherProfileId}/summary`,
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.summary.late === 1, `late: ${res.data.data.summary.late}`);
      assert(res.data.data.summary.totalAttendance === 1, "total");
    });

    // TEST 4 — List filter ?status=LATE
    await test("T4: List filters LATE", async () => {
      const ctx = await setupContext();
      const markRes = await request("/api/admin/teacher-attendance", {
        method: "POST",
        token: ctx.token,
        body: {
          teacherId: String(ctx.teacherProfileId),
          date: today,
          status: "LATE",
        },
      });
      createdAttendanceIds.push(new mongoose.Types.ObjectId(markRes.data.data.attendance.id));

      const res = await request(
        "/api/admin/teacher-attendance?status=LATE",
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.data), "data is array");
      assert(res.data.data.length === 1, `expected 1, got ${res.data.data.length}`);
      assert(res.data.data[0].status === "LATE", "status");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdAttendanceIds.length) {
      await Attendance.collection.deleteMany({ _id: { $in: createdAttendanceIds } });
    }
    if (createdTeacherProfileIds.length) {
      await Teacher.collection.deleteMany({ _id: { $in: createdTeacherProfileIds } });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({ _id: { $in: createdInstituteIds } });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});