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
const Fee = require("../../models/Fee");
const Payment = require("../../models/Payment");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");
const { createFee } = require("../../services/feeService");
const { recordPayment } = require("../../services/paymentService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdFeeIds = [];
const createdPaymentIds = [];
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

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `FR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Fee Route Test Institute",
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
    name: `FR ${role}`,
    email: `fr-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const setup = async () => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId);
  const batchId = await makeBatch(instituteId, classId);
  const studentId = await makeUser("STUDENT", instituteId, { batchId });
  return {
    instituteId,
    ownerId,
    classId,
    batchId,
    studentId,
    ownerToken: makeToken(ownerId),
  };
};

const makeFeeViaService = async (ctx, overrides = {}) => {
  const fee = await createFee({
    instituteId: ctx.instituteId,
    studentId: ctx.studentId,
    cycle: overrides.cycle || "OCT-2026",
    description: overrides.description || `Fee ${randomUUID()}`,
    amount: overrides.amount ?? 5000,
    dueDate: overrides.dueDate || new Date("2026-10-31"),
    notes: overrides.notes,
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
    // A. Auth + role gate (3)
    // =====================================================

    await test("A1: No auth → 401", async () => {
      const res = await request("/api/owner/fees");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: STUDENT role → 403", async () => {
      const ctx = await setup();
      const res = await request("/api/owner/fees", {
        token: makeToken(ctx.studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: TEACHER role → 403", async () => {
      const ctx = await setup();
      const teacherId = await makeUser("TEACHER", ctx.instituteId);
      const res = await request("/api/owner/fees", {
        token: makeToken(teacherId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Create + permission (2)
    // =====================================================

    await test("B1: Admin with FEE_CREATE → 201", async () => {
      const ctx = await setup();
      const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);
      const permId = await makePermission("FEE_CREATE");
      await makeUserPermission(adminId, ctx.instituteId, permId);

      const res = await request("/api/owner/fees", {
        method: "POST",
        token: makeToken(adminId),
        body: {
          studentId: String(ctx.studentId),
          cycle: "NOV-2026",
          description: "Admin created fee",
          amount: 3000,
          dueDate: "2026-11-30",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      createdFeeIds.push(new mongoose.Types.ObjectId(res.data.data.fee.id));
    });

    await test("B2: Admin without FEE_CREATE → 403", async () => {
      const ctx = await setup();
      const adminId = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);
      // Seed the permission but don't assign
      await makePermission("FEE_CREATE");

      const res = await request("/api/owner/fees", {
        method: "POST",
        token: makeToken(adminId),
        body: {
          studentId: String(ctx.studentId),
          cycle: "NOV-2026",
          description: "Unauthorized",
          amount: 1000,
          dueDate: "2026-11-30",
        },
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // C. List + Get + Update + Delete (4)
    // =====================================================

    await test("C1: List fees → 200", async () => {
      const ctx = await setup();
      await makeFeeViaService(ctx);
      await makeFeeViaService(ctx, { cycle: "NOV-2026", description: "Second fee" });

      const res = await request("/api/owner/fees", { token: ctx.ownerToken });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.count === 2, `count ${res.data.count}`);
      assert(res.data.pagination.total === 2, "pagination total");
    });

    await test("C2: List with status filter → 200", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);
      // Pay to make it PARTIAL
      const pay = await recordPayment({
        instituteId: ctx.instituteId,
        feeId: f._id,
        amount: 1000,
        method: "MANUAL_UPI",
        actorId: ctx.ownerId,
      });
      createdPaymentIds.push(pay.payment._id);

      const res = await request("/api/owner/fees?status=PARTIAL", {
        token: ctx.ownerToken,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.count === 1, `count ${res.data.count}`);
    });

    await test("C3: Get single fee → 200", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}`, {
        token: ctx.ownerToken,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.fee.id === String(f._id), "id match");
      assert(Array.isArray(res.data.data.payments), "payments array");
    });

    await test("C4: Update fee description → 200", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}`, {
        method: "PATCH",
        token: ctx.ownerToken,
        body: { description: "Fixed typo" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.data.fee.description === "Fixed typo", "description");
    });

    // =====================================================
    // D. Delete (2)
    // =====================================================

    await test("D1: Delete fee (no payments) → 200", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}`, {
        method: "DELETE",
        token: ctx.ownerToken,
        body: { reason: "Created by mistake" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.fee.isDeleted === true, "isDeleted");
    });

    await test("D2: Delete fee with payments → 409", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);
      const pay = await recordPayment({
        instituteId: ctx.instituteId,
        feeId: f._id,
        amount: 1000,
        method: "MANUAL_UPI",
        actorId: ctx.ownerId,
      });
      createdPaymentIds.push(pay.payment._id);

      const res = await request(`/api/owner/fees/${f._id}`, {
        method: "DELETE",
        token: ctx.ownerToken,
        body: { reason: "attempt" },
      });
      assert(res.status === 409, `expected 409, got ${res.status}`);
      assert(res.data.code === "FEE_HAS_PAYMENTS", `code ${res.data.code}`);
    });

    // =====================================================
    // E. Bulk + Summary (2)
    // =====================================================

    await test("E1: Bulk create fees → 201", async () => {
      const ctx = await setup();
      await makeUser("STUDENT", ctx.instituteId, { batchId: ctx.batchId });

      const res = await request("/api/owner/fees/bulk", {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          batchId: String(ctx.batchId),
          cycle: "DEC-2026",
          description: "Bulk fee Dec",
          amount: 2000,
          dueDate: "2026-12-31",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.count === 2, `count ${res.data.count}`);
      res.data.data.fees.forEach((f) =>
        createdFeeIds.push(new mongoose.Types.ObjectId(f.id))
      );
    });

    await test("E2: Summary → 200", async () => {
      const ctx = await setup();
      await makeFeeViaService(ctx);

      const res = await request("/api/owner/fees/summary", {
        token: ctx.ownerToken,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.totalFees === 1, "totalFees");
      assert(res.data.data.totalAmount === 5000, "totalAmount");
    });

    // =====================================================
    // F. Payment flow (4)
    // =====================================================

    await test("F1: Full payment → fee becomes PAID", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}/payments`, {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          amount: 5000,
          method: "MANUAL_UPI",
          transactionId: "TXN-FULL-123",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.data.fee.status === "PAID", `status ${res.data.data.fee.status}`);
      assert(res.data.data.payment.status === "VERIFIED", "payment verified");
      createdPaymentIds.push(new mongoose.Types.ObjectId(res.data.data.payment.id));
    });

    await test("F2: Partial payment → fee becomes PARTIAL", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}/payments`, {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          amount: 2000,
          method: "BANK_TRANSFER",
        },
      });
      assert(res.status === 201, `expected 201, got ${res.status}`);
      assert(res.data.data.fee.status === "PARTIAL", `status ${res.data.data.fee.status}`);
      assert(res.data.data.fee.paidAmount === 2000, "paidAmount 2000");
      assert(res.data.data.fee.outstanding === 3000, "outstanding 3000");
      createdPaymentIds.push(new mongoose.Types.ObjectId(res.data.data.payment.id));
    });

    await test("F3: Overpayment → 409", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}/payments`, {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          amount: 6000,
          method: "MANUAL_UPI",
        },
      });
      assert(res.status === 409, `expected 409, got ${res.status}`);
      assert(res.data.code === "OVERPAYMENT", `code ${res.data.code}`);
    });

    await test("F4: Refund → fee back to PENDING", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);
      const pay = await recordPayment({
        instituteId: ctx.instituteId,
        feeId: f._id,
        amount: 2000,
        method: "MANUAL_UPI",
        actorId: ctx.ownerId,
      });
      createdPaymentIds.push(pay.payment._id);

      const res = await request(
        `/api/owner/fees/payments/${pay.payment._id}/refund`,
        {
          method: "POST",
          token: ctx.ownerToken,
          body: { reason: "Customer request" },
        }
      );
      assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.data.payment.status === "REFUNDED", "payment REFUNDED");
      assert(res.data.data.fee.status === "PENDING", "fee PENDING again");
      assert(res.data.data.fee.paidAmount === 0, "paidAmount 0");
    });

    // =====================================================
    // G. Errors + validation (4)
    // =====================================================

    await test("G1: Duplicate fee → 409", async () => {
      const ctx = await setup();
      await makeFeeViaService(ctx, {
        cycle: "SEP-2026",
        description: "Duplicate test",
      });

      const res = await request("/api/owner/fees", {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          studentId: String(ctx.studentId),
          cycle: "SEP-2026",
          description: "Duplicate test",
          amount: 5000,
          dueDate: "2026-09-30",
        },
      });
      assert(res.status === 409, `expected 409, got ${res.status}`);
      assert(res.data.code === "DUPLICATE_FEE", `code ${res.data.code}`);
    });

    await test("G2: Nonexistent student → 404", async () => {
      const ctx = await setup();
      const res = await request("/api/owner/fees", {
        method: "POST",
        token: ctx.ownerToken,
        body: {
          studentId: String(new mongoose.Types.ObjectId()),
          cycle: "NOV-2026",
          description: "Ghost",
          amount: 1000,
          dueDate: "2026-11-30",
        },
      });
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await test("G3: Update amount via patch → 400", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);

      const res = await request(`/api/owner/fees/${f._id}`, {
        method: "PATCH",
        token: ctx.ownerToken,
        body: { amount: 9999 },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("G4: Cancel fee with payments → 409", async () => {
      const ctx = await setup();
      const f = await makeFeeViaService(ctx);
      const pay = await recordPayment({
        instituteId: ctx.instituteId,
        feeId: f._id,
        amount: 1000,
        method: "MANUAL_UPI",
        actorId: ctx.ownerId,
      });
      createdPaymentIds.push(pay.payment._id);

      const res = await request(`/api/owner/fees/${f._id}`, {
        method: "PATCH",
        token: ctx.ownerToken,
        body: { status: "CANCELLED" },
      });
      assert(res.status === 409, `expected 409, got ${res.status}`);
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdPaymentIds.length) {
      await Payment.collection.deleteMany({
        _id: { $in: createdPaymentIds },
      });
    }
    if (createdFeeIds.length) {
      await Fee.collection.deleteMany({ _id: { $in: createdFeeIds } });
    }
    if (createdUserPermissionIds.length) {
      await UserPermission.collection.deleteMany({
        _id: { $in: createdUserPermissionIds },
      });
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
      await Permission.collection.deleteMany({
        _id: { $in: createdPermissionIds },
      });
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