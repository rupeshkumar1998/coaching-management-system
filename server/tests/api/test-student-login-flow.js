require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdClassIds = [];
const createdBatchIds = [];

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

const loginViaHttp = async (email, password) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/accessToken=([^;]+)/);
  return { status: res.status, data, token: m ? m[1] : null };
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `SL_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Student Login Flow Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(id);
  return id;
};

const makeClass = async (instituteId) => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name: "Class 10",
    description: "",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClassIds.push(id);
  return id;
};

const makeBatch = async (instituteId, classId) => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name: "Batch A",
    teachers: [],
    schedule: null,
    status: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const makeStudent = async (
  instituteId,
  batchId,
  { mustChangePassword = false, password = "TempPass1234" } = {}
) => {
  const id = new mongoose.Types.ObjectId();
  const email = `student-${randomUUID()}@example.com`;
  const hashed = await hashPassword(password);
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: "Test Student",
    email,
    password: hashed,
    role: "STUDENT",
    batchId,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    mustChangePassword,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return { id, email, password };
};

const setupStudent = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const classId = await makeClass(instituteId);
  const batchId = await makeBatch(instituteId, classId);
  const student = await makeStudent(instituteId, batchId, opts);
  return { instituteId, classId, batchId, ...student };
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

    // T1: Login with mustChangePassword=true ΓåÆ flag in response
    await test("T1: Login returns mustChangePassword=true", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const res = await loginViaHttp(ctx.email, ctx.password);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.mustChangePassword === true, "flag true");
      assert(res.token !== null, "cookie set");
    });

    // T2: Login with mustChangePassword=false ΓåÆ flag false
    await test("T2: Login returns mustChangePassword=false", async () => {
      const ctx = await setupStudent({ mustChangePassword: false });
      const res = await loginViaHttp(ctx.email, ctx.password);
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.mustChangePassword === false, "flag false");
    });

    // T3: /me bypasses password gate
    await test("T3: /me works even when flag=true", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const login = await loginViaHttp(ctx.email, ctx.password);
      const me = await request("/api/student/me", { token: login.token });
      assert(me.status === 200, `expected 200, got ${me.status}`);
      assert(me.data.data.mustChangePassword === true, "flag returned");
    });

    // T4: /me returns batchId and derived classId
    await test("T4: /me returns batchId + classId", async () => {
      const ctx = await setupStudent();
      const login = await loginViaHttp(ctx.email, ctx.password);
      const me = await request("/api/student/me", { token: login.token });
      assert(me.status === 200, `expected 200, got ${me.status}`);
      assert(me.data.data.batchId === String(ctx.batchId), "batchId");
      assert(me.data.data.classId === String(ctx.classId), "classId");
    });

    // T5: /attendance blocked when flag=true
    await test("T5: /attendance ΓåÆ 403 PASSWORD_CHANGE_REQUIRED", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const login = await loginViaHttp(ctx.email, ctx.password);
      const res = await request("/api/student/attendance", { token: login.token });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(res.data.code === "PASSWORD_CHANGE_REQUIRED", `code: ${res.data.code}`);
    });

    // T6: /attendance/summary blocked when flag=true
    await test("T6: /attendance/summary ΓåÆ 403 PASSWORD_CHANGE_REQUIRED", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const login = await loginViaHttp(ctx.email, ctx.password);
      const res = await request("/api/student/attendance/summary", { token: login.token });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(res.data.code === "PASSWORD_CHANGE_REQUIRED", `code: ${res.data.code}`);
    });

    // T7: change-password clears flag
    await test("T7: change-password clears flag", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const login = await loginViaHttp(ctx.email, ctx.password);
      const cp = await request("/api/auth/change-password", {
        method: "POST",
        token: login.token,
        body: { currentPassword: ctx.password, newPassword: "NewSecurePass5678" },
      });
      assert(cp.status === 200, `cp expected 200, got ${cp.status}`);
      // Same token should now succeed on gated route
      const gated = await request("/api/student/attendance", { token: login.token });
      assert(gated.status === 200, `gated expected 200, got ${gated.status}: ${JSON.stringify(gated.data)}`);
    });

    // T8: change-password wrong current ΓåÆ 401
    await test("T8: change-password wrong current ΓåÆ 401", async () => {
      const ctx = await setupStudent({ mustChangePassword: true });
      const login = await loginViaHttp(ctx.email, ctx.password);
      const cp = await request("/api/auth/change-password", {
        method: "POST",
        token: login.token,
        body: { currentPassword: "WrongPassword", newPassword: "NewSecurePass5678" },
      });
      assert(cp.status === 401, `expected 401, got ${cp.status}`);
    });

    // T9: no token on /me ΓåÆ 401
    await test("T9: no token on /me ΓåÆ 401", async () => {
      const res = await request("/api/student/me");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    // T10: non-student ΓåÆ 403
    await test("T10: non-student on /api/student/me ΓåÆ 403", async () => {
      const instituteId = await makeInstitute();
      const teacherId = new mongoose.Types.ObjectId();
      const hashed = await hashPassword("TempPass1234");
      await User.collection.insertOne({
        _id: teacherId,
        instituteId,
        name: "Teacher",
        email: `t-${randomUUID()}@example.com`,
        password: hashed,
        role: "TEACHER",
        isActive: true,
        accountStatus: "ACTIVE",
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdUserIds.push(teacherId);
      const login = await loginViaHttp(
        (await User.findById(teacherId).lean()).email,
        "TempPass1234"
      );
      const res = await request("/api/student/me", { token: login.token });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({ _id: { $in: createdBatchIds } });
    }
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
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