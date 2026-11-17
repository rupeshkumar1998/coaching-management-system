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
    code: `CD_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "CRUD Delete Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    subscriptionStatus: "ACTIVE",
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
    name: `CD ${role}`,
    email: `cd-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeFee = async (
  instituteId,
  studentId,
  batchId,
  classId,
  ownerId,
  { paidAmount = 0, amount = 5000, status = "PENDING" } = {}
) => {
  const id = new mongoose.Types.ObjectId();
  await Fee.collection.insertOne({
    _id: id,
    instituteId,
    studentId,
    batchId,
    classId,
    cycle: `CYC-${randomUUID().slice(0, 8)}`,
    description: `Fee ${randomUUID().slice(0, 8)}`,
    amount,
    currency: "INR",
    dueDate: new Date("2026-12-31"),
    status,
    paidAmount,
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

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // =====================================================
    // STUDENT DELETES (3)
    // =====================================================

    await test(
      "S1: Delete student (no fees) → 200 soft delete",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });

        const res = await request(
          `/api/owner/students/${studentId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
            body: { reason: "Test delete" },
          }
        );

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.data.student.isDeleted === true, "isDeleted=true");
        assert(res.data.data.student.isActive === false, "isActive=false");
        assert(res.data.data.student.accountStatus === "SUSPENDED", "accountStatus=SUSPENDED");

        // Verify DB
        const dbUser = await User.findById(studentId).lean();
        assert(dbUser.isDeleted === true, "DB isDeleted=true");
        assert(dbUser.isActive === false, "DB isActive=false");
      }
    );

    await test(
      "S2: Delete student with paid fee → 409 STUDENT_HAS_PAYMENTS",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });
        await makeFee(
          ctx.instituteId,
          studentId,
          ctx.batchId,
          ctx.classId,
          ctx.ownerId,
          { paidAmount: 1000, amount: 5000, status: "PARTIAL" }
        );

        const res = await request(
          `/api/owner/students/${studentId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
          }
        );

        assert(res.status === 409, `expected 409, got ${res.status}`);
        assert(res.data.code === "STUDENT_HAS_PAYMENTS", `code: ${res.data.code}`);

        // Verify student NOT deleted
        const dbUser = await User.findById(studentId).lean();
        assert(dbUser.isDeleted === false, "DB isDeleted=false");
      }
    );

    await test(
      "S3: Delete student with unpaid fee → 200 (fee preserved)",
      async () => {
        const ctx = await setupOwner();
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });
        const feeId = await makeFee(
          ctx.instituteId,
          studentId,
          ctx.batchId,
          ctx.classId,
          ctx.ownerId,
          { paidAmount: 0, status: "PENDING" }
        );

        const res = await request(
          `/api/owner/students/${studentId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
          }
        );

        assert(res.status === 200, `expected 200, got ${res.status}`);

        // Fee preserved
        const dbFee = await Fee.findById(feeId).lean();
        assert(dbFee.isDeleted === false, "fee not touched");
      }
    );

    // =====================================================
    // BATCH DELETES (2)
    // =====================================================

    await test(
      "B1: Delete empty batch → 200 soft delete",
      async () => {
        const ctx = await setupOwner();

        const res = await request(
          `/api/owner/batches/${ctx.batchId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
          }
        );

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.data.batch.isDeleted === true, "isDeleted=true");
      }
    );

    await test(
      "B2: Delete batch with active students → 409 BATCH_HAS_STUDENTS",
      async () => {
        const ctx = await setupOwner();
        await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });

        const res = await request(
          `/api/owner/batches/${ctx.batchId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
          }
        );

        assert(res.status === 409, `expected 409, got ${res.status}`);
        assert(res.data.code === "BATCH_HAS_STUDENTS", `code: ${res.data.code}`);

        const dbBatch = await Batch.findById(ctx.batchId).lean();
        assert(dbBatch.isDeleted === false, "batch not deleted");
      }
    );

    // =====================================================
    // CLASS DELETES (2)
    // =====================================================

    await test(
      "C1: Delete class without batches → 200",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        await Institute.collection.updateOne(
          { _id: instituteId },
          { $set: { ownerId } }
        );
        const classId = await makeClass(instituteId, ownerId);

        const res = await request(`/api/owner/classes/${classId}`, {
          method: "DELETE",
          token: makeToken(ownerId),
        });

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.data.class.isDeleted === true, "isDeleted=true");
      }
    );

    await test(
      "C2: Delete class with batches → 409 CLASS_HAS_BATCHES",
      async () => {
        const ctx = await setupOwner();

        const res = await request(
          `/api/owner/classes/${ctx.classId}`,
          {
            method: "DELETE",
            token: ctx.ownerToken,
          }
        );

        assert(res.status === 409, `expected 409, got ${res.status}`);
        assert(res.data.code === "CLASS_HAS_BATCHES", `code: ${res.data.code}`);

        const dbClass = await Class.findById(ctx.classId).lean();
        assert(dbClass.isDeleted === false, "class not deleted");
      }
    );

    // =====================================================
    // PARENT DELETE (1)
    // =====================================================

    await test(
      "P1: Delete parent → 200 soft delete",
      async () => {
        const ctx = await setupOwner();
        const parentId = await makeUser("PARENT", ctx.instituteId);

        const res = await request(`/api/owner/parents/${parentId}`, {
          method: "DELETE",
          token: ctx.ownerToken,
        });

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.data.parent.isDeleted === true, "isDeleted=true");
        assert(res.data.data.parent.isActive === false, "isActive=false");
        assert(res.data.data.parent.accountStatus === "SUSPENDED", "accountStatus");
      }
    );

    // =====================================================
    // ADMIN DELETES (3)
    // =====================================================

    await test(
      "A1: Owner deletes another admin → 200",
      async () => {
        const ctx = await setupOwner();
        const admin1 = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);
        const admin2 = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);

        const res = await request(`/api/owner/admins/${admin1}`, {
          method: "DELETE",
          token: ctx.ownerToken,
        });

        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.data.admin.isDeleted === true, "isDeleted=true");

        // Verify DB
        const dbUser = await User.findById(admin1).lean();
        assert(dbUser.isDeleted === true, "DB isDeleted=true");
        assert(dbUser.accountStatus === "SUSPENDED", "DB accountStatus=SUSPENDED");
      }
    );

    await test(
      "A2: Owner cannot delete self → 403 CANNOT_DELETE_SELF",
      async () => {
        const ctx = await setupOwner();

        const res = await request(`/api/owner/admins/${ctx.ownerId}`, {
          method: "DELETE",
          token: ctx.ownerToken,
        });

        assert(res.status === 403, `expected 403, got ${res.status}`);
        assert(res.data.code === "CANNOT_DELETE_SELF", `code: ${res.data.code}`);

        // Verify owner NOT deleted
        const dbOwner = await User.findById(ctx.ownerId).lean();
        assert(dbOwner.isDeleted === false, "owner not deleted");
      }
    );

    await test(
      "A3: Cannot delete last active admin → 409 LAST_ADMIN",
      async () => {
        const ctx = await setupOwner();
        // Only 1 admin exists
        const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);

        const res = await request(`/api/owner/admins/${adminId}`, {
          method: "DELETE",
          token: ctx.ownerToken,
        });

        assert(res.status === 409, `expected 409, got ${res.status}: ${JSON.stringify(res.data)}`);
        assert(res.data.code === "LAST_ADMIN", `code: ${res.data.code}`);

        const dbUser = await User.findById(adminId).lean();
        assert(dbUser.isDeleted === false, "admin not deleted");
      }
    );

    // =====================================================
    // AUTH GUARDS (1)
    // =====================================================

    await test(
      "X1: Non-owner (admin) cannot delete student → 403",
      async () => {
        const ctx = await setupOwner();
        const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);
        const studentId = await makeUser("STUDENT", ctx.instituteId, {
          batchId: ctx.batchId,
        });

        const res = await request(`/api/owner/students/${studentId}`, {
          method: "DELETE",
          token: makeToken(adminId),
        });

        // Admin without STUDENT_DELETE permission → 403
        assert(res.status === 403, `expected 403, got ${res.status}`);

        const dbUser = await User.findById(studentId).lean();
        assert(dbUser.isDeleted === false, "student not deleted");
      }
    );

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