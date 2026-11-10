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
// 32.16.16 Sprint 5B — Subscription Usage Route Tests
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
    code: `SU_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Subscription Usage Test Institute",
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
    name: `SU ${role}`,
    email: `su-${role.toLowerCase()}-${randomUUID()}@example.com`,
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
    action: key.split("_").slice(1).join("_"),
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

const makeSubscription = async (instituteId, { maxStudents = 100, maxTeachers = 20 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `SUP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Subscription Usage Test Plan",
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
  features.push({ key: "STUDENT_MANAGEMENT", enabled: true });
  features.push({ key: "TEACHER_MANAGEMENT", enabled: true });

  const limits = [
    { key: "MAX_STUDENTS", value: maxStudents },
    { key: "MAX_TEACHERS", value: maxTeachers },
  ];

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
    limits,
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
    limits,
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
};

const setupOwnerWithSub = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
  await makeSubscription(instituteId, opts);
  return { instituteId, ownerId, token: makeToken(ownerId) };
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
    // A. Auth
    // =====================================================

    await test("A1: no auth → 401", async () => {
      const res = await request("/api/owner/subscription-usage");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: TEACHER → 403", async () => {
      const instituteId = await makeInstitute();
      const teacherId = await makeUser("TEACHER", instituteId);
      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(teacherId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: STUDENT → 403", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(studentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A4: PARENT → 403", async () => {
      const instituteId = await makeInstitute();
      const parentId = await makeUser("PARENT", instituteId);
      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(parentId),
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Owner — happy path
    // =====================================================

    await test("B1: Owner → 200 with subscription + limits data", async () => {
      const ctx = await setupOwnerWithSub({
        maxStudents: 100,
        maxTeachers: 20,
      });

      const res = await request("/api/owner/subscription-usage", {
        token: ctx.token,
      });

      assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert(res.data.success === true, "success");
      assert(res.data.data.subscription, "subscription object");
      assert(res.data.data.subscription.plan === "FREE", "plan");
      assert(res.data.data.subscription.status === "ACTIVE", "status");
      assert(Array.isArray(res.data.data.limits), "limits array");
      assert(res.data.data.limits.length > 0, "limits not empty");

      // Find MAX_STUDENTS status
      const maxStudents = res.data.data.limits.find(
        (l) => l.limitKey === "MAX_STUDENTS"
      );
      assert(maxStudents, "MAX_STUDENTS in response");
      assert(maxStudents.limit === 100, `MAX_STUDENTS limit ${maxStudents.limit}`);
      assert(maxStudents.current === 0, `MAX_STUDENTS current ${maxStudents.current}`);
      assert(maxStudents.remaining === 100, `MAX_STUDENTS remaining ${maxStudents.remaining}`);
      assert(maxStudents.unlimited === false, "unlimited false");
      assert(maxStudents.implemented === true, "implemented true");
    });

    await test("B2: Owner sees all 13 catalog limits", async () => {
      const ctx = await setupOwnerWithSub();

      const res = await request("/api/owner/subscription-usage", {
        token: ctx.token,
      });

      assert(res.status === 200, `expected 200, got ${res.status}`);
      // Catalog has 13 limits (some not configured → implemented: false)
      assert(
        res.data.data.limits.length === 13,
        `expected 13 limits (full catalog), got ${res.data.data.limits.length}`
      );
    });

    // =====================================================
    // C. Owner — no subscription
    // =====================================================

    await test("C1: Owner with no subscription → 403 SUBSCRIPTION_INACTIVE", async () => {
      const instituteId = await makeInstitute();
      const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
      // No subscription created

      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(ownerId),
      });

      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(
        res.data.code === "SUBSCRIPTION_INACTIVE",
        `expected SUBSCRIPTION_INACTIVE, got ${res.data.code}`
      );
    });

    // =====================================================
    // D. Admin with/without DASHBOARD_READ
    // =====================================================

    await test("D1: Admin with DASHBOARD_READ → 200", async () => {
      const instituteId = await makeInstitute();
      await makeUser("INSTITUTE_OWNER", instituteId);
      const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      const permissionId = await makePermission("DASHBOARD_READ");
      await makeUserPermission(adminId, instituteId, permissionId);

      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(adminId),
      });

      assert(
        res.status === 200,
        `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      assert(res.data.success === true, "success");
    });

    await test("D2: Admin without DASHBOARD_READ → 403", async () => {
      const instituteId = await makeInstitute();
      await makeUser("INSTITUTE_OWNER", instituteId);
      const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      // No permission assigned

      const res = await request("/api/owner/subscription-usage", {
        token: makeToken(adminId),
      });

      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // E. Tenant isolation
    // =====================================================

    await test("E1: Owner A sees only A's usage, not B's", async () => {
      const ctxA = await setupOwnerWithSub({ maxStudents: 50 });
      const ctxB = await setupOwnerWithSub({ maxStudents: 500 });

      const resA = await request("/api/owner/subscription-usage", {
        token: ctxA.token,
      });
      const resB = await request("/api/owner/subscription-usage", {
        token: ctxB.token,
      });

      assert(resA.status === 200, `A: expected 200, got ${resA.status}`);
      assert(resB.status === 200, `B: expected 200, got ${resB.status}`);

      const aStudents = resA.data.data.limits.find(
        (l) => l.limitKey === "MAX_STUDENTS"
      );
      const bStudents = resB.data.data.limits.find(
        (l) => l.limitKey === "MAX_STUDENTS"
      );

      assert(
        aStudents.limit === 50,
        `A: MAX_STUDENTS limit should be 50, got ${aStudents.limit}`
      );
      assert(
        bStudents.limit === 500,
        `B: MAX_STUDENTS limit should be 500, got ${bStudents.limit}`
      );
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