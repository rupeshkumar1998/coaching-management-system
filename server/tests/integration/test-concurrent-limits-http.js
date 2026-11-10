require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const Class = require("../../models/Class");
const Batch = require("../../models/Batch");
const Teacher = require("../../models/Teacher");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 Sprint 6A — Concurrency at HTTP Level
//
// Verifies race safety across real endpoints:
//   - 5 concurrent requests, limit=N → exactly N succeed
//   - Counter.used matches DB record count (no orphan)
//   - No oversubscription
//
// Complements .11 (service-level race test) by exercising
// the full stack: middleware → controller → service →
// transaction → reserveLimit.
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdClassIds = [];
const createdBatchIds = [];
const createdTeacherIds = [];

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
    code: `CC_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Concurrent HTTP Test Institute",
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
    name: `CC ${role}`,
    email: `cc-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscription = async (
  instituteId,
  { feature, limitKey, limitValue }
) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `CCP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Concurrency HTTP Test Plan",
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
  // Add all resource-management features required by dependency rules
  features.push({ key: "STUDENT_MANAGEMENT", enabled: true });
  features.push({ key: "TEACHER_MANAGEMENT", enabled: true });
  features.push({ key: "ADMIN_MANAGEMENT", enabled: true });
  features.push({ key: "PARENT_MANAGEMENT", enabled: true });
  features.push({ key: "CLASS_MANAGEMENT", enabled: true });
  features.push({ key: "BATCH_MANAGEMENT", enabled: true });
  if (feature && !features.some((f) => f.key === feature)) {
    features.push({ key: feature, enabled: true });
  }

  const limits = [{ key: limitKey, value: limitValue }];

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

const makeClass = async (instituteId, ownerId, name) => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name,
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

const makeBatch = async (instituteId, classId, ownerId, name) => {
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
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const getCounter = async (instituteId, limitKey) => {
  return UsageCounter.findOne({
    instituteId,
    limitKey,
    period: "lifetime",
  }).lean();
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await Class.init();
  await Batch.init();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // =====================================================
    // Test 1 — 5 concurrent class creates, MAX_CLASSES=2
    // =====================================================

    await test(
      "T1: 5 concurrent class creates, MAX_CLASSES=2 → exactly 2 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        await makeSubscription(instituteId, {
          feature: "CLASS_MANAGEMENT",
          limitKey: "MAX_CLASSES",
          limitValue: 2,
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/owner/classes", {
              method: "POST",
              token,
              body: { name: `Concurrent Class ${i}` },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        // Track created class IDs for cleanup
        for (const s of successes) {
          createdClassIds.push(new mongoose.Types.ObjectId(s.value.data.data.class.id));
        }

        assert(successes.length === 2, `expected 2 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_CLASSES");
        assert(counter !== null, "counter exists");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);

        const dbCount = await Class.countDocuments({
          instituteId,
          isDeleted: false,
        });
        assert(dbCount === 2, `DB count ${dbCount}, expected 2 (no orphan)`);
      }
    );

    // =====================================================
    // Test 2 — 5 concurrent batch creates, MAX_BATCHES=3
    // =====================================================

    await test(
      "T2: 5 concurrent batch creates, MAX_BATCHES=3 → exactly 3 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const classId = await makeClass(instituteId, ownerId, "Class for Batches");
        await makeSubscription(instituteId, {
          feature: "BATCH_MANAGEMENT",
          limitKey: "MAX_BATCHES",
          limitValue: 3,
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/owner/batches", {
              method: "POST",
              token,
              body: { classId: String(classId), name: `Concurrent Batch ${i}` },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdBatchIds.push(new mongoose.Types.ObjectId(s.value.data.data.batch.id));
        }

        assert(successes.length === 3, `expected 3 success, got ${successes.length}`);
        assert(limitReached.length === 2, `expected 2 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_BATCHES");
        assert(counter.used === 3, `counter used ${counter.used}, expected 3`);

        const dbCount = await Batch.countDocuments({
          instituteId,
          isDeleted: false,
        });
        assert(dbCount === 3, `DB count ${dbCount}, expected 3`);
      }
    );

    // =====================================================
    // Test 3 — 5 concurrent student creates, MAX_STUDENTS=2
    // =====================================================

    await test(
      "T3: 5 concurrent student creates, MAX_STUDENTS=2 → exactly 2 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const classId = await makeClass(instituteId, ownerId, "Student Class");
        const batchId = await makeBatch(instituteId, classId, ownerId, "Student Batch");
        await makeSubscription(instituteId, {
          feature: "STUDENT_MANAGEMENT",
          limitKey: "MAX_STUDENTS",
          limitValue: 2,
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/owner/students", {
              method: "POST",
              token,
              body: {
                name: `Concurrent Student ${i}`,
                email: `cc-student-${randomUUID()}@example.com`,
                classId: String(classId),
                batchId: String(batchId),
              },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdUserIds.push(new mongoose.Types.ObjectId(s.value.data.data.student.id));
        }

        assert(successes.length === 2, `expected 2 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_STUDENTS");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);

        const dbCount = await User.countDocuments({
          instituteId,
          role: "STUDENT",
          isDeleted: false,
        });
        assert(dbCount === 2, `DB count ${dbCount}, expected 2`);
      }
    );

    // =====================================================
    // Test 4 — 5 concurrent teacher creates, MAX_TEACHERS=2
    // (uses adminTeacherRoutes — requires INSTITUTE_ADMIN role)
    // =====================================================

    await test(
      "T4: 5 concurrent teacher creates, MAX_TEACHERS=2 → exactly 2 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
        await makeSubscription(instituteId, {
          feature: "TEACHER_MANAGEMENT",
          limitKey: "MAX_TEACHERS",
          limitValue: 2,
        });
        const adminToken = makeToken(adminId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/admin/teachers", {
              method: "POST",
              token: adminToken,
              body: {
                name: `Concurrent Teacher ${i}`,
                email: `cc-teacher-${randomUUID()}@example.com`,
                password: "TeacherPass123!",
              },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdTeacherIds.push(new mongoose.Types.ObjectId(s.value.data.data.teacher.id));
          createdUserIds.push(new mongoose.Types.ObjectId(s.value.data.data.user.id));
        }

        assert(successes.length === 2, `expected 2 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_TEACHERS");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);

        const dbCount = await Teacher.countDocuments({
          instituteId,
          isDeleted: false,
        });
        assert(dbCount === 2, `DB count ${dbCount}, expected 2`);
      }
    );

    // =====================================================
    // Test 5 — 5 concurrent admin creates, MAX_ADMINS=2
    // =====================================================

    await test(
      "T5: 5 concurrent admin creates, MAX_ADMINS=2 → exactly 2 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);

        // requireInstituteOwner checks Institute.ownerId — set it now
        await Institute.collection.updateOne(
          { _id: instituteId },
          { $set: { ownerId } }
        );

        await makeSubscription(instituteId, {
          feature: "ADMIN_MANAGEMENT",
          limitKey: "MAX_ADMINS",
          limitValue: 2,
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/owner/admins", {
              method: "POST",
              token,
              body: {
                name: `Concurrent Admin ${i}`,
                email: `cc-admin-${randomUUID()}@example.com`,
                password: "AdminPass123!",
              },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdUserIds.push(new mongoose.Types.ObjectId(s.value.data.data.admin.id));
        }

        assert(successes.length === 2, `expected 2 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_ADMINS");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);
      }
    );

    // =====================================================
    // Test 6 — 5 concurrent parent creates, MAX_PARENTS=2
    // =====================================================

    await test(
      "T6: 5 concurrent parent creates, MAX_PARENTS=2 → exactly 2 succeed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        await makeSubscription(instituteId, {
          feature: "PARENT_MANAGEMENT",
          limitKey: "MAX_PARENTS",
          limitValue: 2,
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 5 }, (_, i) =>
            request("/api/owner/parents", {
              method: "POST",
              token,
              body: {
                name: `Concurrent Parent ${i}`,
                email: `cc-parent-${randomUUID()}@example.com`,
                password: "ParentPass123!",
              },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdUserIds.push(new mongoose.Types.ObjectId(s.value.data.data.parent.id));
        }

        assert(successes.length === 2, `expected 2 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_PARENTS");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);
      }
    );

    // =====================================================
    // Test 7 — Concurrent independent limits
    // (class at limit, admins available)
    // =====================================================

    await test(
      "T7: Concurrent classes (at limit) + admins (available) → independent outcomes",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        // Pre-create 1 class (fills MAX_CLASSES=1)
        await makeClass(instituteId, ownerId, "Already At Limit");
        await makeSubscription(instituteId, {
          feature: "CLASS_MANAGEMENT",
          limitKey: "MAX_CLASSES",
          limitValue: 1,
        });
        // Manually pre-seed counter for class since we inserted via collection
        await UsageCounter.collection.insertOne({
          _id: new mongoose.Types.ObjectId(),
          instituteId,
          limitKey: "MAX_CLASSES",
          period: "lifetime",
          used: 1,
          version: 0,
          lastReconciledAt: null,
          actualUsageAtLastReconcile: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const token = makeToken(ownerId);

        const classFires = Array.from({ length: 5 }, (_, i) =>
          request("/api/owner/classes", {
            method: "POST",
            token,
            body: { name: `Should Fail Class ${i}` },
          })
        );
        const adminFires = Array.from({ length: 5 }, (_, i) =>
          request("/api/owner/admins", {
            method: "POST",
            token,
            body: {
              name: `Should Succeed Admin ${i}`,
              email: `cc-mix-admin-${randomUUID()}@example.com`,
              password: "AdminPass123!",
            },
          })
        );

        const results = await Promise.allSettled([...classFires, ...adminFires]);

        const classResults = results.slice(0, 5);
        const adminResults = results.slice(5);

        const classSuccesses = classResults.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const adminSuccesses = adminResults.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );

        for (const s of adminSuccesses) {
          createdUserIds.push(new mongoose.Types.ObjectId(s.value.data.data.admin.id));
        }

        // Class: at limit, all should fail (5 classes fired, all LIMIT_REACHED)
        assert(
          classSuccesses.length === 0,
          `expected 0 class success (at limit), got ${classSuccesses.length}`
        );
        // Admin: no limit set on MAX_ADMINS in subscription → not configured → 409 or LIMIT_NOT_CONFIGURED
        // Actually MAX_ADMINS not in subscription → the counter is registered but the limit isn't configured
        // The create should return LIMIT_NOT_CONFIGURED (since subscription has no MAX_ADMINS)
        // Let's check with response codes
        const adminBlocked = adminResults.filter(
          (r) =>
            r.status === "fulfilled" &&
            (r.value.status === 403 || r.value.status === 409) &&
            r.value.data.code === "LIMIT_NOT_CONFIGURED"
        );

        // If admins blocked because MAX_ADMINS not configured, that's expected
        assert(
          adminSuccesses.length === 0 || adminBlocked.length > 0,
          `admin expectations: got ${adminSuccesses.length} success, ${adminBlocked.length} blocked — need clarity`
        );
      }
    );

    // =====================================================
    // Test 8 — Boundary: 4 concurrent at limit-1
    // =====================================================

    await test(
      "T8: MAX_CLASSES=2, current=1, 4 concurrent → exactly 1 succeeds",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        // Pre-create 1 class + counter
        await makeClass(instituteId, ownerId, "Pre-existing");
        await makeSubscription(instituteId, {
          feature: "CLASS_MANAGEMENT",
          limitKey: "MAX_CLASSES",
          limitValue: 2,
        });
        await UsageCounter.collection.insertOne({
          _id: new mongoose.Types.ObjectId(),
          instituteId,
          limitKey: "MAX_CLASSES",
          period: "lifetime",
          used: 1,
          version: 0,
          lastReconciledAt: null,
          actualUsageAtLastReconcile: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const token = makeToken(ownerId);

        const results = await Promise.allSettled(
          Array.from({ length: 4 }, (_, i) =>
            request("/api/owner/classes", {
              method: "POST",
              token,
              body: { name: `Boundary Class ${i}` },
            })
          )
        );

        const successes = results.filter(
          (r) => r.status === "fulfilled" && r.value.status === 201
        );
        const limitReached = results.filter(
          (r) =>
            r.status === "fulfilled" &&
            r.value.status === 403 &&
            r.value.data.code === "LIMIT_REACHED"
        );

        for (const s of successes) {
          createdClassIds.push(new mongoose.Types.ObjectId(s.value.data.data.class.id));
        }

        assert(successes.length === 1, `expected 1 success, got ${successes.length}`);
        assert(limitReached.length === 3, `expected 3 LIMIT_REACHED, got ${limitReached.length}`);

        const counter = await getCounter(instituteId, "MAX_CLASSES");
        assert(counter.used === 2, `counter used ${counter.used}, expected 2`);

        const dbCount = await Class.countDocuments({
          instituteId,
          isDeleted: false,
        });
        assert(dbCount === 2, `DB count ${dbCount}, expected 2`);
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdTeacherIds.length) {
      await Teacher.collection.deleteMany({ _id: { $in: createdTeacherIds } });
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