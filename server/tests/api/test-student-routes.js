require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 Sprint 3 — Student Routes (HTTP-level)
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdPermissionIds = [];
const createdUserPermissionIds = [];
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
    code: `SR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Student Route Test Institute",
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
    name: `SR ${role}`,
    email: `sr-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeClass = async (instituteId, actorId, name = "Class 10") => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name,
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

const makeSubscription = async (instituteId, { featureOn = true, maxStudents = 5 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `SRP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Student Route Test Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  const features = getMandatoryFeatureKeys().map((k) => ({ key: k, enabled: true }));
  features.push({ key: "STUDENT_MANAGEMENT", enabled: featureOn });

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: 1,
    status: "PUBLISHED",
    amount: 0,
    currency: "INR",
    durationDays: 30,
    paymentRequired: false,
    features,
    limits: [{ key: "MAX_STUDENTS", value: maxStudents }],
    publishedAt: new Date(),
    publishedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdVersionIds.push(versionId);

  const now = Date.now();
  const subId = new mongoose.Types.ObjectId();
  await Subscription.collection.insertOne({
    _id: subId,
    instituteId,
    subscriptionType: "STANDARD",
    plan: "FREE",
    planVersion: 1,
    planVersionId: versionId,
    amount: 0,
    currency: "INR",
    paymentRequired: false,
    durationDays: 30,
    status: "ACTIVE",
    startDate: new Date(now - 86400000),
    endDate: new Date(now + 86400000 * 30),
    features,
    limits: [{ key: "MAX_STUDENTS", value: maxStudents }],
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
};

const setupOwnerContext = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId, ownerId);
  const batchId = await makeBatch(instituteId, classId, ownerId);
  await makeSubscription(instituteId, opts);
  return {
    instituteId,
    ownerId,
    classId,
    batchId,
    token: makeToken(ownerId),
  };
};

const makeStudentBody = (ctx, overrides = {}) => ({
  name: "Route Test Student",
  email: `route-student-${randomUUID()}@example.com`,
  phone: "+919876543210",
  classId: String(ctx.classId),
  batchId: String(ctx.batchId),
  ...overrides,
});

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await Batch.init();
  await Class.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // =====================================================
    // A. Auth
    // =====================================================

    await test("A1: no auth → 401", async () => {
      const res = await request("/api/owner/students");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: TEACHER → 403", async () => {
      const instituteId = await makeInstitute();
      const teacherId = await makeUser("TEACHER", instituteId);
      const res = await request("/api/owner/students", {
        token: makeToken(teacherId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: STUDENT → 403", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const res = await request("/api/owner/students", {
        token: makeToken(studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Owner happy path
    // =====================================================

    let createdStudentId = null;

    await test("B1: Owner create student → 201 (with temp password)", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      assert(res.data.success === true, "success");
      assert(res.data.data.student.role === "STUDENT", "role");
      assert(res.data.data.student.batchId === String(ctx.batchId), "batchId");
      assert(res.data.data.student.classId === String(ctx.classId), "classId");
      assert(res.data.data.student.mustChangePassword === true, "flag");
      assert(res.data.data.tempPassword, "tempPassword");
      assert(res.data.data.tempPassword.length === 12, "tempPassword length");
      createdStudentId = res.data.data.student.id;
      createdUserIds.push(new mongoose.Types.ObjectId(createdStudentId));
    });

    await test("B2: Owner list students → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      createdUserIds.push(new mongoose.Types.ObjectId(createRes.data.data.student.id));

      const res = await request("/api/owner/students", { token: ctx.token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.data.students), "students array");
      assert(res.data.data.students.length === 1, `expected 1, got ${res.data.data.students.length}`);
      assert(res.data.data.students[0].classId === String(ctx.classId), "derived classId");
    });

    await test("B3: Owner list with ?batchId filter", async () => {
      const ctx = await setupOwnerContext();
      const batch2 = await makeBatch(ctx.instituteId, ctx.classId, ctx.ownerId, "Batch 2");

      await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      }).then((r) => {
        if (r.status === 201) createdUserIds.push(new mongoose.Types.ObjectId(r.data.data.student.id));
      });
      await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx, { batchId: String(batch2) }),
      }).then((r) => {
        if (r.status === 201) createdUserIds.push(new mongoose.Types.ObjectId(r.data.data.student.id));
      });

      const res = await request(
        `/api/owner/students?batchId=${ctx.batchId}`,
        { token: ctx.token }
      );
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.students.length === 1, `expected 1, got ${res.data.data.students.length}`);
    });

    await test("B4: Owner get single → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      const id = createRes.data.data.student.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/students/${id}`, { token: ctx.token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.student.id === id, "id match");
    });

    await test("B5: Owner update → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      const id = createRes.data.data.student.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/students/${id}`, {
        method: "PATCH",
        token: ctx.token,
        body: { name: "Updated Name" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.student.name === "Updated Name", "name");
    });

    await test("B6: Owner assign-batch → 200", async () => {
      const ctx = await setupOwnerContext();
      const batch2 = await makeBatch(ctx.instituteId, ctx.classId, ctx.ownerId, "New Batch");

      const createRes = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      const id = createRes.data.data.student.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/students/${id}/assign-batch`, {
        method: "PATCH",
        token: ctx.token,
        body: { batchId: String(batch2) },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.student.batchId === String(batch2), "batchId");
    });

    await test("B7: Owner remove-batch → 200 (batchId null)", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      const id = createRes.data.data.student.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/students/${id}/remove-batch`, {
        method: "PATCH",
        token: ctx.token,
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.student.batchId === null, "batchId null");
    });

    // =====================================================
    // C. Limit
    // =====================================================

    await test("C1: LIMIT_REACHED at boundary → 403", async () => {
      const ctx = await setupOwnerContext({ maxStudents: 1 });

      const first = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      assert(first.status === 201, "first should succeed");
      createdUserIds.push(new mongoose.Types.ObjectId(first.data.data.student.id));

      const second = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      assert(second.status === 403, `expected 403, got ${second.status}`);
      assert(second.data.code === "LIMIT_REACHED", `expected LIMIT_REACHED, got ${second.data.code}`);
    });

    // =====================================================
    // D. Feature
    // =====================================================

    await test("D1: FEATURE_DISABLED → 403", async () => {
      const ctx = await setupOwnerContext({ featureOn: false });
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(res.data.code === "FEATURE_DISABLED", `expected FEATURE_DISABLED, got ${res.data.code}`);
    });

    // =====================================================
    // E. Validation
    // =====================================================

    await test("E1: missing name → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: { email: "x@example.com", classId: String(ctx.classId), batchId: String(ctx.batchId) },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E2: invalid email → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx, { email: "not-an-email" }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E3: missing classId → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: { name: "X", email: "x@example.com", batchId: String(ctx.batchId) },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E4: missing batchId → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: { name: "X", email: "x@example.com", classId: String(ctx.classId) },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E5: invalid studentId on get → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students/not-an-id", {
        token: ctx.token,
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    // =====================================================
    // F. 404
    // =====================================================

    await test("F1: nonexistent classId → 404", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx, { classId: String(new mongoose.Types.ObjectId()) }),
      });
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await test("F2: nonexistent studentId → 404", async () => {
      const ctx = await setupOwnerContext();
      const res = await request(
        `/api/owner/students/${new mongoose.Types.ObjectId()}`,
        { token: ctx.token }
      );
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    // =====================================================
    // G. 409
    // =====================================================

    await test("G1: BATCH_CLASS_MISMATCH → 409", async () => {
      const ctx = await setupOwnerContext();
      const otherClass = await makeClass(ctx.instituteId, ctx.ownerId, "Class Other");
      const otherBatch = await makeBatch(ctx.instituteId, otherClass, ctx.ownerId, "Batch Other");

      const res = await request("/api/owner/students", {
        method: "POST",
        token: ctx.token,
        body: makeStudentBody(ctx, { batchId: String(otherBatch) }),
      });
      assert(res.status === 409, `expected 409, got ${res.status}`);
      assert(res.data.code === "BATCH_CLASS_MISMATCH", `got ${res.data.code}`);
    });

    // =====================================================
    // H. Tenant isolation
    // =====================================================

    await test("H1: Owner A cannot see B's students", async () => {
      const ctxA = await setupOwnerContext();
      const ctxB = await setupOwnerContext();

      await request("/api/owner/students", {
        method: "POST",
        token: ctxA.token,
        body: makeStudentBody(ctxA),
      }).then((r) => {
        if (r.status === 201) createdUserIds.push(new mongoose.Types.ObjectId(r.data.data.student.id));
      });

      const listA = await request("/api/owner/students", { token: ctxA.token });
      const listB = await request("/api/owner/students", { token: ctxB.token });
      assert(listA.data.data.students.length === 1, "A has 1");
      assert(listB.data.data.students.length === 0, "B has 0");
    });

    // =====================================================
    // I. Admin with/without permission
    // =====================================================

    await test("I1: Admin with STUDENT_CREATE → 201", async () => {
      const instituteId = await makeInstitute();
      const owner = await makeUser("INSTITUTE_OWNER", instituteId);
      const admin = await makeUser("INSTITUTE_ADMIN", instituteId);
      const classId = await makeClass(instituteId, owner);
      const batchId = await makeBatch(instituteId, classId, owner);
      await makeSubscription(instituteId);

      const permissionId = await makePermission("STUDENT_CREATE");
      await makeUserPermission(admin, instituteId, permissionId);
      const token = makeToken(admin);

      const res = await request("/api/owner/students", {
        method: "POST",
        token,
        body: {
          name: "Admin Student",
          email: `admin-stu-${randomUUID()}@example.com`,
          classId: String(classId),
          batchId: String(batchId),
        },
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      createdUserIds.push(new mongoose.Types.ObjectId(res.data.data.student.id));
    });

    await test("I2: Admin without STUDENT_CREATE → 403", async () => {
      const instituteId = await makeInstitute();
      const owner = await makeUser("INSTITUTE_OWNER", instituteId);
      const admin = await makeUser("INSTITUTE_ADMIN", instituteId);
      const classId = await makeClass(instituteId, owner);
      const batchId = await makeBatch(instituteId, classId, owner);
      await makeSubscription(instituteId);
      const token = makeToken(admin);

      const res = await request("/api/owner/students", {
        method: "POST",
        token,
        body: {
          name: "Unauthorized",
          email: `unauth-${randomUUID()}@example.com`,
          classId: String(classId),
          batchId: String(batchId),
        },
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdUserPermissionIds.length) {
      await UserPermission.collection.deleteMany({ _id: { $in: createdUserPermissionIds } });
    }
    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({ _id: { $in: createdBatchIds } });
    }
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
    }
    if (createdInstituteIds.length) {
      await UsageCounter.collection.deleteMany({
        instituteId: { $in: createdInstituteIds },
      });
    }
    if (createdSubscriptionIds.length) {
      await Subscription.collection.deleteMany({ _id: { $in: createdSubscriptionIds } });
    }
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({ _id: { $in: createdVersionIds } });
    }
    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({ _id: { $in: createdPlanIds } });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({ _id: { $in: createdInstituteIds } });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdPermissionIds.length) {
      await Permission.collection.deleteMany({ _id: { $in: createdPermissionIds } });
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