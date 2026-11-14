require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const Fee = require("../../models/Fee");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");
const { createFee } = require("../../services/feeService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdFeeIds = [];

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

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `SF_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Student Fee Route Institute",
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
    name: `SF ${role}`,
    email: `sf-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const setup = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId);
  const batchId = await makeBatch(instituteId, classId);
  const studentA = await makeUser("STUDENT", instituteId, {
    batchId,
    mustChangePassword: opts.mustChangePassword === true,
  });
  const studentB = await makeUser("STUDENT", instituteId, { batchId });
  return {
    instituteId,
    ownerId,
    classId,
    batchId,
    studentA,
    studentB,
    studentAToken: makeToken(studentA),
    studentBToken: makeToken(studentB),
  };
};

const makeFeeViaService = async (ctx, studentId, overrides = {}) => {
  const fee = await createFee({
    instituteId: ctx.instituteId,
    studentId,
    cycle: overrides.cycle || "OCT-2026",
    description: overrides.description || `Fee ${randomUUID()}`,
    amount: overrides.amount ?? 5000,
    dueDate: overrides.dueDate || new Date("2026-10-31"),
    actorId: ctx.ownerId,
  });
  createdFeeIds.push(fee._id);
  return fee;
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await Fee.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // =====================================================
    // A. Auth (2)
    // =====================================================

    await test("A1: No auth → 401", async () => {
      const res = await request("/api/student/fees");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: TEACHER → 403", async () => {
      const ctx = await setup();
      const teacherId = await makeUser("TEACHER", ctx.instituteId);
      const res = await request("/api/student/fees", {
        token: makeToken(teacherId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Happy paths (2)
    // =====================================================

    await test("B1: Student lists own fees → 200", async () => {
      const ctx = await setup();
      await makeFeeViaService(ctx, ctx.studentA);
      await makeFeeViaService(ctx, ctx.studentA, {
        cycle: "NOV-2026",
        description: "Second",
      });
      await makeFeeViaService(ctx, ctx.studentB);

      const res = await request("/api/student/fees", {
        token: ctx.studentAToken,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.count === 2, `count ${res.data.count}`);
    });

    await test("B2: Student gets own fee detail → 200", async () => {
      const ctx = await setup();
      const fee = await makeFeeViaService(ctx, ctx.studentA);

      const res = await request(`/api/student/fees/${fee._id}`, {
        token: ctx.studentAToken,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.fee.id === String(fee._id), "id");
      assert(Array.isArray(res.data.data.payments), "payments");
    });

    // =====================================================
    // C. Security (1)
    // =====================================================

    await test("C1: Student cannot see other student's fee → 404", async () => {
      const ctx = await setup();
      const fee = await makeFeeViaService(ctx, ctx.studentB);

      const res = await request(`/api/student/fees/${fee._id}`, {
        token: ctx.studentAToken,
      });
      assert(res.status === 404, `expected 404, got ${res.status}`);
      assert(res.data.code === "FEE_NOT_FOUND", `code ${res.data.code}`);
    });

    // =====================================================
    // D. Password gate (1)
    // =====================================================

    await test("D1: mustChangePassword=true → 403 PASSWORD_CHANGE_REQUIRED", async () => {
      const ctx = await setup({ mustChangePassword: true });

      const res = await request("/api/student/fees", {
        token: ctx.studentAToken,
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(
        res.data.code === "PASSWORD_CHANGE_REQUIRED",
        `code ${res.data.code}`
      );
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdFeeIds.length) {
      await Fee.collection.deleteMany({ _id: { $in: createdFeeIds } });
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