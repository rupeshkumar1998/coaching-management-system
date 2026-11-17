require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const Fee = require("../../models/Fee");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdFeeIds = [];
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

const requestRaw = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(options.token ? { Cookie: `accessToken=${options.token}` } : {}),
    },
  });
  const contentType = res.headers.get("content-type") || "";
  const disposition = res.headers.get("content-disposition") || "";

  if (contentType.includes("text/csv")) {
    const buf = await res.arrayBuffer();
    const text = Buffer.from(buf).toString("utf8");
    return { status: res.status, contentType, disposition, text };
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, contentType, disposition, data };
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
    code: `CE_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "CSV Export Test Institute",
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
    name: `CE ${role}`,
    email: `ce-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeFee = async (instituteId, studentId, batchId, classId, ownerId, opts = {}) => {
  const id = new mongoose.Types.ObjectId();
  await Fee.collection.insertOne({
    _id: id,
    instituteId,
    studentId,
    batchId,
    classId,
    cycle: opts.cycle || `CYC-${randomUUID().slice(0, 8)}`,
    description: opts.description || `Fee ${randomUUID().slice(0, 8)}`,
    amount: opts.amount ?? 5000,
    currency: "INR",
    dueDate: new Date("2026-12-31"),
    status: opts.status || "PENDING",
    paidAmount: opts.paidAmount ?? 0,
    createdBy: ownerId,
    updatedBy: ownerId,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdFeeIds.push(id);
  return id;
};

const setupOwner = async () => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  await Institute.collection.updateOne(
    { _id: instituteId },
    { $set: { ownerId } }
  );
  const classId = await makeClass(instituteId, ownerId);
  const batchId = await makeBatch(instituteId, classId, ownerId);
  return {
    instituteId,
    ownerId,
    classId,
    batchId,
    ownerToken: makeToken(ownerId),
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
    // STUDENTS CSV (3)
    // =====================================================

    await test(
      "CS1: Students CSV returns proper headers + BOM",
      async () => {
        const ctx = await setupOwner();
        await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });

        const res = await requestRaw(
          "/api/owner/reports/export/students.csv",
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `expected 200, got ${res.status}`);
        assert(res.contentType.includes("text/csv"), `contentType: ${res.contentType}`);
        assert(res.disposition.includes("attachment"), `disposition: ${res.disposition}`);
        assert(res.text.charCodeAt(0) === 0xfeff, "BOM present");
        assert(res.text.includes("Name,Email,Phone"), "header row");
      }
    );

    await test(
      "CS2: Students CSV with batchId filter narrows results",
      async () => {
        const ctx = await setupOwner();
        const otherClassId = await makeClass(ctx.instituteId, ctx.ownerId);
        const otherBatchId = await makeBatch(ctx.instituteId, otherClassId, ctx.ownerId);

        const s1 = await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });
        const s2 = await makeUser("STUDENT", ctx.instituteId, { batchId: otherBatchId });

        const res = await requestRaw(
          `/api/owner/reports/export/students.csv?batchId=${ctx.batchId}`,
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `status ${res.status}`);
        const lines = res.text.trim().split("\r\n");
        // header + 1 data row
        assert(lines.length === 2, `expected 2 lines, got ${lines.length}`);
      }
    );

    await test(
      "CS3: Students CSV CSV-escapes commas in name",
      async () => {
        const ctx = await setupOwner();
        await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
          name: 'Kumar, Rahul "RK"',
        });

        const res = await requestRaw(
          "/api/owner/reports/export/students.csv",
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `status ${res.status}`);
        // Should contain escaped quotes
        assert(res.text.includes('""RK""'), "quotes escaped");
        assert(res.text.includes('"Kumar, Rahul'), "comma-wrapped value");
      }
    );

    // =====================================================
    // FEES CSV (2)
    // =====================================================

    await test(
      "CS4: Fees CSV returns proper headers + rows",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });
        await makeFee(ctx.instituteId, studentId, ctx.batchId, ctx.classId, ctx.ownerId);

        const res = await requestRaw(
          "/api/owner/reports/export/fees.csv",
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `status ${res.status}`);
        assert(res.text.charCodeAt(0) === 0xfeff, "BOM");
        assert(res.text.includes("Student Name,Student Email,Cycle"), "header");
        assert(res.text.includes("PENDING"), "status in data");
      }
    );

    await test(
      "CS5: Fees CSV with status filter",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });
        await makeFee(ctx.instituteId, studentId, ctx.batchId, ctx.classId, ctx.ownerId, {
          status: "PAID",
          paidAmount: 5000,
        });
        await makeFee(ctx.instituteId, studentId, ctx.batchId, ctx.classId, ctx.ownerId, {
          status: "PENDING",
          paidAmount: 0,
        });

        const res = await requestRaw(
          "/api/owner/reports/export/fees.csv?status=PAID",
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `status ${res.status}`);
        const lines = res.text.trim().split("\r\n");
        assert(lines.length === 2, `expected 2 lines, got ${lines.length}`);
        assert(res.text.includes("PAID"), "PAID present");
      }
    );

    // =====================================================
    // ATTENDANCE CSV (2)
    // =====================================================

    await test(
      "CS6: Attendance CSV with batchId + date range",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });

        const attId = new mongoose.Types.ObjectId();
        await StudentAttendance.collection.insertOne({
          _id: attId,
          instituteId: ctx.instituteId,
          studentId,
          batchId: ctx.batchId,
          attendanceDate: today,
          date: new Date(`${today}T00:00:00.000Z`),
          status: "PRESENT",
          markedBy: ctx.ownerId,
          markedVia: "MANUAL",
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        createdAttendanceIds.push(attId);

        const res = await requestRaw(
          `/api/owner/reports/export/attendance.csv?batchId=${ctx.batchId}&from=${today}&to=${today}`,
          { token: ctx.ownerToken }
        );

        assert(res.status === 200, `status ${res.status}`);
        assert(res.text.includes("Student Name,Student Email,Date"), "header");
        assert(res.text.includes("PRESENT"), "status");
      }
    );

    await test(
      "CS7: Attendance CSV missing batchId → 400",
      async () => {
        const ctx = await setupOwner();

        const res = await requestRaw(
          `/api/owner/reports/export/attendance.csv?from=${today}&to=${today}`,
          { token: ctx.ownerToken }
        );

        assert(res.status === 400, `expected 400, got ${res.status}`);
      }
    );

    // =====================================================
    // SECURITY (2)
    // =====================================================

    await test(
      "CS8: Non-owner (admin) without REPORT_EXPORT → 403",
      async () => {
        const ctx = await setupOwner();
        const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);

        const res = await requestRaw(
          "/api/owner/reports/export/students.csv",
          { token: makeToken(adminId) }
        );

        assert(res.status === 403, `expected 403, got ${res.status}`);
      }
    );

    await test(
      "CS9: No auth on CSV export → 401",
      async () => {
        const res = await requestRaw(
          "/api/owner/reports/export/students.csv"
        );
        assert(res.status === 401, `expected 401, got ${res.status}`);
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