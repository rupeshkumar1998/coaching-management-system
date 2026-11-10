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
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 Sprint 4C — Parent Routes (HTTP-level)
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
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

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `PR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Parent Route Test Institute",
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
    name: `PR ${role}`,
    email: `pr-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscription = async (instituteId, { featureOn = true, maxParents = 5 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `PRP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Parent Route Test Plan",
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
  features.push({ key: "PARENT_MANAGEMENT", enabled: featureOn });

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
    limits: [{ key: "MAX_PARENTS", value: maxParents }],
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
    limits: [{ key: "MAX_PARENTS", value: maxParents }],
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
};

const setupOwnerContext = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  await makeSubscription(instituteId, opts);
  return { instituteId, ownerId, token: makeToken(ownerId) };
};

const makeParentBody = (overrides = {}) => ({
  name: "Route Test Parent",
  email: `route-parent-${randomUUID()}@example.com`,
  phone: "+919876543210",
  password: "ParentPassword123!",
  ...overrides,
});

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
    // A. Auth
    // =====================================================

    await test("A1: no auth → 401", async () => {
      const res = await request("/api/owner/parents");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: TEACHER → 403", async () => {
      const instituteId = await makeInstitute();
      const teacherId = await makeUser("TEACHER", instituteId);
      const res = await request("/api/owner/parents", {
        token: makeToken(teacherId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: STUDENT → 403", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const res = await request("/api/owner/parents", {
        token: makeToken(studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Owner happy path
    // =====================================================

    await test("B1: Owner create parent → 201", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      assert(res.data.success === true, "success");
      assert(res.data.data.parent.role === "PARENT", "role");
      assert(res.data.data.parent.email, "email");
      createdUserIds.push(new mongoose.Types.ObjectId(res.data.data.parent.id));
    });

    await test("B2: Owner list → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      createdUserIds.push(new mongoose.Types.ObjectId(createRes.data.data.parent.id));

      const res = await request("/api/owner/parents", { token: ctx.token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.data.parents), "parents array");
      assert(res.data.data.parents.length === 1, `expected 1, got ${res.data.data.parents.length}`);
    });

    await test("B3: Owner get single → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      const id = createRes.data.data.parent.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/parents/${id}`, { token: ctx.token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.parent.id === id, "id match");
    });

    await test("B4: Owner update → 200", async () => {
      const ctx = await setupOwnerContext();
      const createRes = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      const id = createRes.data.data.parent.id;
      createdUserIds.push(new mongoose.Types.ObjectId(id));

      const res = await request(`/api/owner/parents/${id}`, {
        method: "PATCH",
        token: ctx.token,
        body: { name: "Updated Parent Name" },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(res.data.data.parent.name === "Updated Parent Name", "name");
    });

    // =====================================================
    // C. Limit
    // =====================================================

    await test("C1: LIMIT_REACHED at boundary → 403", async () => {
      const ctx = await setupOwnerContext({ maxParents: 1 });

      const first = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      assert(first.status === 201, "first should succeed");
      createdUserIds.push(new mongoose.Types.ObjectId(first.data.data.parent.id));

      const second = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      assert(second.status === 403, `expected 403, got ${second.status}`);
      assert(second.data.code === "LIMIT_REACHED", `expected LIMIT_REACHED, got ${second.data.code}`);
    });

    // =====================================================
    // D. Feature
    // =====================================================

    await test("D1: FEATURE_DISABLED → 403", async () => {
      const ctx = await setupOwnerContext({ featureOn: false });
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody(),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(res.data.code === "FEATURE_DISABLED", `expected FEATURE_DISABLED, got ${res.data.code}`);
    });

    // =====================================================
    // E. Validation
    // =====================================================

    await test("E1: missing name → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: { email: "x@example.com", password: "Password123!" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E2: invalid email → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody({ email: "not-an-email" }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E3: missing password → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: { name: "Test", email: "x@example.com" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E4: short password → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody({ password: "short" }),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E5: invalid parentId on get → 400", async () => {
      const ctx = await setupOwnerContext();
      const res = await request("/api/owner/parents/not-an-id", {
        token: ctx.token,
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    // =====================================================
    // F. 404 and 409
    // =====================================================

    await test("F1: nonexistent parentId → 404", async () => {
      const ctx = await setupOwnerContext();
      const res = await request(
        `/api/owner/parents/${new mongoose.Types.ObjectId()}`,
        { token: ctx.token }
      );
      assert(res.status === 404, `expected 404, got ${res.status}`);
    });

    await test("F2: duplicate email → 409", async () => {
      const ctx = await setupOwnerContext();
      const email = `dup-${randomUUID()}@example.com`;

      const first = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody({ email }),
      });
      createdUserIds.push(new mongoose.Types.ObjectId(first.data.data.parent.id));

      const second = await request("/api/owner/parents", {
        method: "POST",
        token: ctx.token,
        body: makeParentBody({ email }),
      });
      assert(second.status === 409, `expected 409, got ${second.status}`);
    });

    // =====================================================
    // G. Tenant isolation
    // =====================================================

    await test("G1: Owner A cannot see B's parents", async () => {
      const ctxA = await setupOwnerContext();
      const ctxB = await setupOwnerContext();

      await request("/api/owner/parents", {
        method: "POST",
        token: ctxA.token,
        body: makeParentBody(),
      }).then((r) => {
        if (r.status === 201) createdUserIds.push(new mongoose.Types.ObjectId(r.data.data.parent.id));
      });

      const listA = await request("/api/owner/parents", { token: ctxA.token });
      const listB = await request("/api/owner/parents", { token: ctxB.token });
      assert(listA.data.data.parents.length === 1, "A has 1");
      assert(listB.data.data.parents.length === 0, "B has 0");
    });

    // =====================================================
    // H. Admin with/without permission
    // =====================================================

    await test("H1: Admin with PARENT_CREATE → 201", async () => {
      const instituteId = await makeInstitute();
      await makeUser("INSTITUTE_OWNER", instituteId);
      const admin = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      const permissionId = await makePermission("PARENT_CREATE");
      await makeUserPermission(admin, instituteId, permissionId);
      const token = makeToken(admin);

      const res = await request("/api/owner/parents", {
        method: "POST",
        token,
        body: makeParentBody(),
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      createdUserIds.push(new mongoose.Types.ObjectId(res.data.data.parent.id));
    });

    await test("H2: Admin without PARENT_CREATE → 403", async () => {
      const instituteId = await makeInstitute();
      await makeUser("INSTITUTE_OWNER", instituteId);
      const admin = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      const token = makeToken(admin);

      const res = await request("/api/owner/parents", {
        method: "POST",
        token,
        body: makeParentBody(),
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
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
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