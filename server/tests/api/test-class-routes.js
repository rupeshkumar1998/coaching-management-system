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
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");

const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 — Class Routes (HTTP-level)
//
// Covers:
//   A. Auth boundaries (401, 403)
//   B. Owner happy path (create, list, update)
//   C. Limit enforcement (LIMIT_REACHED)
//   D. Feature boundary (FEATURE_DISABLED)
//   E. Validation (400)
//   F. Tenant isolation
//   G. Admin with CLASS_CREATE permission can create
//   H. Admin WITHOUT permission gets 403
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdPermissionIds = [];
const createdUserPermissionIds = [];
const createdClassIds = [];

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
    code: `CR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Class Route Test Institute",
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
    name: `CR ${role}`,
    email: `cr-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscription = async (instituteId, { featureOn = true, maxClasses = 5 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `CRP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Class Route Test Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  const features = getMandatoryFeatureKeys().map((k) => ({
    key: k,
    enabled: true,
  }));
  features.push({ key: "CLASS_MANAGEMENT", enabled: featureOn });

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
    limits: [{ key: "MAX_CLASSES", value: maxClasses }],
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
    limits: [{ key: "MAX_CLASSES", value: maxClasses }],
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
  return { subId, versionId };
};

const setupOwnerContext = async (opts = {}) => {
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
  await Class.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // =====================================================
    // A. Auth boundaries
    // =====================================================

    await test("A1: no auth → 401", async () => {
      const res = await request("/api/owner/classes");
      assert(res.status === 401, `expected 401, got ${res.status}`);
    });

    await test("A2: TEACHER → 403", async () => {
      const instituteId = await makeInstitute();
      const teacherId = await makeUser("TEACHER", instituteId);
      const token = makeToken(teacherId);
      const res = await request("/api/owner/classes", { token });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    await test("A3: STUDENT → 403", async () => {
      const instituteId = await makeInstitute();
      const studentId = await makeUser("STUDENT", instituteId);
      const token = makeToken(studentId);
      const res = await request("/api/owner/classes", { token });
      assert(res.status === 403, `expected 403, got ${res.status}`);
    });

    // =====================================================
    // B. Owner happy path
    // =====================================================

    let createdClassId = null;

    await test("B1: Owner create class → 201", async () => {
      const { token } = await setupOwnerContext();
      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Class 10", description: "Test class" },
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      assert(res.data.success === true, "success");
      assert(res.data.data.class.name === "Class 10", "name");
      createdClassId = res.data.data.class.id;
      createdClassIds.push(new mongoose.Types.ObjectId(createdClassId));
    });

    await test("B2: Owner list classes → 200", async () => {
      const { token } = await setupOwnerContext();
      await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Class 11" },
      }).then((r) => {
        if (r.status === 201) {
          createdClassIds.push(new mongoose.Types.ObjectId(r.data.data.class.id));
        }
      });

      const res = await request("/api/owner/classes", { token });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.data.data.classes), "classes array");
      assert(res.data.data.classes.length === 1, `expected 1, got ${res.data.data.classes.length}`);
    });

    await test("B3: Owner update class → 200", async () => {
      const { token } = await setupOwnerContext();
      const createRes = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Old Name" },
      });
      createdClassIds.push(new mongoose.Types.ObjectId(createRes.data.data.class.id));
      const classId = createRes.data.data.class.id;

      const updateRes = await request(`/api/owner/classes/${classId}`, {
        method: "PATCH",
        token,
        body: { name: "New Name" },
      });
      assert(updateRes.status === 200, `expected 200, got ${updateRes.status}`);
      assert(updateRes.data.data.class.name === "New Name", "name updated");
    });

    // =====================================================
    // C. Limit enforcement
    // =====================================================

    await test("C1: LIMIT_REACHED after MAX_CLASSES → 403", async () => {
      const { token } = await setupOwnerContext({ maxClasses: 1 });

      const first = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "OnlyOne" },
      });
      assert(first.status === 201, "first create should succeed");
      createdClassIds.push(new mongoose.Types.ObjectId(first.data.data.class.id));

      const second = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Second" },
      });
      assert(second.status === 403, `expected 403, got ${second.status}`);
      assert(second.data.code === "LIMIT_REACHED", `expected LIMIT_REACHED, got ${second.data.code}`);
    });

    // =====================================================
    // D. Feature boundary
    // =====================================================

    await test("D1: FEATURE_DISABLED → 403", async () => {
      const { token } = await setupOwnerContext({ featureOn: false });
      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Blocked" },
      });
      assert(res.status === 403, `expected 403, got ${res.status}`);
      assert(res.data.code === "FEATURE_DISABLED", `expected FEATURE_DISABLED, got ${res.data.code}`);
    });

    // =====================================================
    // E. Validation
    // =====================================================

    await test("E1: missing name → 400", async () => {
      const { token } = await setupOwnerContext();
      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { description: "No name" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E2: short name → 400", async () => {
      const { token } = await setupOwnerContext();
      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "A" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    await test("E3: invalid classId on update → 400", async () => {
      const { token } = await setupOwnerContext();
      const res = await request("/api/owner/classes/not-an-id", {
        method: "PATCH",
        token,
        body: { name: "Whatever" },
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
    });

    // =====================================================
    // F. Tenant isolation
    // =====================================================

    await test("F1: Owner A cannot see B's classes", async () => {
      const ctxA = await setupOwnerContext();
      const ctxB = await setupOwnerContext();

      await request("/api/owner/classes", {
        method: "POST",
        token: ctxA.token,
        body: { name: "A's Class" },
      }).then((r) => {
        if (r.status === 201) {
          createdClassIds.push(new mongoose.Types.ObjectId(r.data.data.class.id));
        }
      });

      const listA = await request("/api/owner/classes", { token: ctxA.token });
      const listB = await request("/api/owner/classes", { token: ctxB.token });

      assert(listA.data.data.classes.length === 1, "A has 1");
      assert(listB.data.data.classes.length === 0, "B has 0");
    });

    // =====================================================
    // G. Admin WITH permission can create
    // =====================================================

    await test("G1: Admin with CLASS_CREATE → 201", async () => {
      const instituteId = await makeInstitute();
      const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      const permissionId = await makePermission("CLASS_CREATE");
      await makeUserPermission(adminId, instituteId, permissionId);
      const token = makeToken(adminId);

      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Admin Class" },
      });
      assert(
        res.status === 201,
        `expected 201, got ${res.status}: ${JSON.stringify(res.data)}`
      );
      createdClassIds.push(new mongoose.Types.ObjectId(res.data.data.class.id));
    });

    // =====================================================
    // H. Admin WITHOUT permission → 403
    // =====================================================

    await test("H1: Admin without CLASS_CREATE → 403", async () => {
      const instituteId = await makeInstitute();
      const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
      await makeSubscription(instituteId);
      // No permission assigned
      const token = makeToken(adminId);

      const res = await request("/api/owner/classes", {
        method: "POST",
        token,
        body: { name: "Unauthorized" },
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
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
    }
    if (createdInstituteIds.length) {
      await UsageCounter.collection.deleteMany({ instituteId: { $in: createdInstituteIds } });
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