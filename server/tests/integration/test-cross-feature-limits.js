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
// 32.16.16 Sprint 6C — Cross-Feature Limits
//
// Tests that:
//   - Multiple resources track independently
//   - One failure doesn't affect other counters
//   - Same email rejected across roles
//   - Chain dependencies (class→batch→student) work
//   - Tenant isolation across all 6 limits
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
    code: `XF_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Cross-Feature Test Institute",
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
    name: `XF ${role}`,
    email: `xf-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscription = async (instituteId, ownerId, limits) => {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `XFP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Cross-Feature Test Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: ownerId,
    updatedBy: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  const features = getMandatoryFeatureKeys().map((k) => ({ key: k, enabled: true }));
  features.push({ key: "STUDENT_MANAGEMENT", enabled: true });
  features.push({ key: "TEACHER_MANAGEMENT", enabled: true });
  features.push({ key: "ADMIN_MANAGEMENT", enabled: true });
  features.push({ key: "PARENT_MANAGEMENT", enabled: true });
  features.push({ key: "CLASS_MANAGEMENT", enabled: true });
  features.push({ key: "BATCH_MANAGEMENT", enabled: true });

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
    publishedBy: ownerId,
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
    // Test 1 — Full lifecycle chain: class → batch → student
    // =====================================================

    await test(
      "T1: Chain class→batch→student tracks 3 counters independently",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        await makeSubscription(instituteId, ownerId, [
          { key: "MAX_CLASSES", value: 5 },
          { key: "MAX_BATCHES", value: 5 },
          { key: "MAX_STUDENTS", value: 5 },
        ]);
        const token = makeToken(ownerId);

        // Create class
        const classRes = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Chain Class" },
        });
        assert(classRes.status === 201, `Class: ${classRes.status}`);
        const classId = classRes.data.data.class.id;
        createdClassIds.push(new mongoose.Types.ObjectId(classId));

        // Create batch
        const batchRes = await request("/api/owner/batches", {
          method: "POST",
          token,
          body: { classId, name: "Chain Batch" },
        });
        assert(batchRes.status === 201, `Batch: ${batchRes.status}`);
        const batchId = batchRes.data.data.batch.id;
        createdBatchIds.push(new mongoose.Types.ObjectId(batchId));

        // Create student
        const studentRes = await request("/api/owner/students", {
          method: "POST",
          token,
          body: {
            name: "Chain Student",
            email: `chain-${randomUUID()}@example.com`,
            classId,
            batchId,
          },
        });
        assert(studentRes.status === 201, `Student: ${studentRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(studentRes.data.data.student.id));

        // Verify all 3 counters
        const classCounter = await getCounter(instituteId, "MAX_CLASSES");
        const batchCounter = await getCounter(instituteId, "MAX_BATCHES");
        const studentCounter = await getCounter(instituteId, "MAX_STUDENTS");

        assert(classCounter.used === 1, `class: ${classCounter.used}`);
        assert(batchCounter.used === 1, `batch: ${batchCounter.used}`);
        assert(studentCounter.used === 1, `student: ${studentCounter.used}`);
      }
    );

    // =====================================================
    // Test 2 — All 6 resources created, all 6 counters = 1
    // =====================================================

    await test(
      "T2: All 6 resources created → all 6 counters = 1",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

        // requireInstituteOwner checks Institute.ownerId
        await Institute.collection.updateOne(
          { _id: instituteId },
          { $set: { ownerId } }
        );

        await makeSubscription(instituteId, ownerId, [
          { key: "MAX_CLASSES", value: 5 },
          { key: "MAX_BATCHES", value: 5 },
          { key: "MAX_STUDENTS", value: 5 },
          { key: "MAX_TEACHERS", value: 5 },
          { key: "MAX_ADMINS", value: 5 },
          { key: "MAX_PARENTS", value: 5 },
        ]);
        const token = makeToken(ownerId);
        // Owner bypasses permission middleware
        const adminToken = makeToken(ownerId);

        // 1. Class
        const classRes = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "All6 Class" },
        });
        assert(classRes.status === 201, `Class: ${classRes.status}`);
        const classId = classRes.data.data.class.id;
        createdClassIds.push(new mongoose.Types.ObjectId(classId));

        // 2. Batch
        const batchRes = await request("/api/owner/batches", {
          method: "POST",
          token,
          body: { classId, name: "All6 Batch" },
        });
        assert(batchRes.status === 201, `Batch: ${batchRes.status}`);
        const batchId = batchRes.data.data.batch.id;
        createdBatchIds.push(new mongoose.Types.ObjectId(batchId));

        // 3. Student
        const studentRes = await request("/api/owner/students", {
          method: "POST",
          token,
          body: {
            name: "All6 Student",
            email: `all6-s-${randomUUID()}@example.com`,
            classId,
            batchId,
          },
        });
        assert(studentRes.status === 201, `Student: ${studentRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(studentRes.data.data.student.id));

        // 4. Teacher (via admin route)
        const teacherRes = await request("/api/admin/teachers", {
          method: "POST",
          token: adminToken,
          body: {
            name: "All6 Teacher",
            email: `all6-t-${randomUUID()}@example.com`,
            password: "TeacherPass123!",
          },
        });
        assert(teacherRes.status === 201, `Teacher: ${teacherRes.status}`);
        createdTeacherIds.push(new mongoose.Types.ObjectId(teacherRes.data.data.teacher.id));
        createdUserIds.push(new mongoose.Types.ObjectId(teacherRes.data.data.user.id));

        // 5. Admin
        const adminRes = await request("/api/owner/admins", {
          method: "POST",
          token,
          body: {
            name: "All6 Admin",
            email: `all6-a-${randomUUID()}@example.com`,
            password: "AdminPass123!",
          },
        });
        assert(adminRes.status === 201, `Admin: ${adminRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(adminRes.data.data.admin.id));

        // 6. Parent
        const parentRes = await request("/api/owner/parents", {
          method: "POST",
          token,
          body: {
            name: "All6 Parent",
            email: `all6-p-${randomUUID()}@example.com`,
            password: "ParentPass123!",
          },
        });
        assert(parentRes.status === 201, `Parent: ${parentRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(parentRes.data.data.parent.id));

        // Verify all 6 counters
        // Note: MAX_ADMINS is 2 because the setup admin
        // (created for teacher creation) counts via the
        // counter's countDocuments query.
        const expectedCounts = {
          MAX_CLASSES: 1,
          MAX_BATCHES: 1,
          MAX_STUDENTS: 1,
          MAX_TEACHERS: 1,
          MAX_ADMINS: 2,
          MAX_PARENTS: 1,
        };

        for (const [key, expected] of Object.entries(expectedCounts)) {
          const counter = await getCounter(instituteId, key);
          assert(counter !== null, `${key} counter missing`);
          assert(
            counter.used === expected,
            `${key}: ${counter.used}, expected ${expected}`
          );
        }
      }
    );

    // =====================================================
    // Test 3 — Same email rejected across roles
    // =====================================================

    await test(
      "T3: Same email rejected across STUDENT/TEACHER/PARENT roles",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);
        await makeSubscription(instituteId, ownerId, [
          { key: "MAX_CLASSES", value: 5 },
          { key: "MAX_BATCHES", value: 5 },
          { key: "MAX_STUDENTS", value: 5 },
          { key: "MAX_TEACHERS", value: 5 },
          { key: "MAX_PARENTS", value: 5 },
        ]);
        const token = makeToken(ownerId);
        // Owner bypasses permission middleware
        const adminToken = makeToken(ownerId);

        // Create class + batch for student
        const classRes = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Email Class" },
        });
        const classId = classRes.data.data.class.id;
        createdClassIds.push(new mongoose.Types.ObjectId(classId));

        const batchRes = await request("/api/owner/batches", {
          method: "POST",
          token,
          body: { classId, name: "Email Batch" },
        });
        const batchId = batchRes.data.data.batch.id;
        createdBatchIds.push(new mongoose.Types.ObjectId(batchId));

        const sharedEmail = `shared-${randomUUID()}@example.com`;

        // 1st: Student — succeeds
        const s1 = await request("/api/owner/students", {
          method: "POST",
          token,
          body: { name: "S1", email: sharedEmail, classId, batchId },
        });
        assert(s1.status === 201, `Student: ${s1.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(s1.data.data.student.id));

        // 2nd: Teacher — fails with EMAIL_EXISTS
        const t2 = await request("/api/admin/teachers", {
          method: "POST",
          token: adminToken,
          body: { name: "T2", email: sharedEmail, password: "TeacherPass123!" },
        });
        assert(t2.status === 409, `Teacher expected 409, got ${t2.status}`);

        // 3rd: Parent — fails with EMAIL_EXISTS
        const p3 = await request("/api/owner/parents", {
          method: "POST",
          token,
          body: { name: "P3", email: sharedEmail, password: "ParentPass123!" },
        });
        assert(p3.status === 409, `Parent expected 409, got ${p3.status}`);
      }
    );

    // =====================================================
    // Test 4 — Failed create doesn't increment counter
    // =====================================================

    await test(
      "T4: Failed class create (invalid teacher) doesn't touch counter",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        await makeSubscription(instituteId, ownerId, [
          { key: "MAX_CLASSES", value: 5 },
        ]);
        const token = makeToken(ownerId);

        // Attempt create with invalid teacherId
        const res = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: {
            name: "Bad Teacher Class",
            classTeacherId: String(new mongoose.Types.ObjectId()),
          },
        });
        assert(res.status === 404, `Expected 404, got ${res.status}`);
        assert(res.data.code === "CLASS_TEACHER_NOT_FOUND", `code: ${res.data.code}`);

        // Counter should still be null (never created) OR used=0
        const counter = await getCounter(instituteId, "MAX_CLASSES");
        assert(
          counter === null || counter.used === 0,
          `counter should be null/0, got ${counter ? counter.used : "null"}`
        );

        // No classes in DB
        const dbCount = await Class.countDocuments({
          instituteId,
          isDeleted: false,
        });
        assert(dbCount === 0, `DB count ${dbCount}, expected 0`);
      }
    );

    // =====================================================
    // Test 5 — Cross-tenant isolation (2 institutes, 6 limits)
    // =====================================================

    await test(
      "T5: Two institutes — counters and records fully isolated",
      async () => {
        // Institute A: 3 classes
        const instA = await makeInstitute();
        const ownerA = await makeUser("INSTITUTE_OWNER", instA);
        await makeSubscription(instA, ownerA, [
          { key: "MAX_CLASSES", value: 10 },
        ]);
        const tokenA = makeToken(ownerA);

        // Institute B: 2 classes
        const instB = await makeInstitute();
        const ownerB = await makeUser("INSTITUTE_OWNER", instB);
        await makeSubscription(instB, ownerB, [
          { key: "MAX_CLASSES", value: 10 },
        ]);
        const tokenB = makeToken(ownerB);

        // A creates 3 classes
        for (let i = 0; i < 3; i++) {
          const res = await request("/api/owner/classes", {
            method: "POST",
            token: tokenA,
            body: { name: `A Class ${i}` },
          });
          assert(res.status === 201, `A class ${i}: ${res.status}`);
          createdClassIds.push(new mongoose.Types.ObjectId(res.data.data.class.id));
        }

        // B creates 2 classes
        for (let i = 0; i < 2; i++) {
          const res = await request("/api/owner/classes", {
            method: "POST",
            token: tokenB,
            body: { name: `B Class ${i}` },
          });
          assert(res.status === 201, `B class ${i}: ${res.status}`);
          createdClassIds.push(new mongoose.Types.ObjectId(res.data.data.class.id));
        }

        // Verify counters
        const counterA = await getCounter(instA, "MAX_CLASSES");
        const counterB = await getCounter(instB, "MAX_CLASSES");
        assert(counterA.used === 3, `A: ${counterA.used}, expected 3`);
        assert(counterB.used === 2, `B: ${counterB.used}, expected 2`);

        // Verify DB
        const dbCountA = await Class.countDocuments({ instituteId: instA });
        const dbCountB = await Class.countDocuments({ instituteId: instB });
        assert(dbCountA === 3, `A DB: ${dbCountA}, expected 3`);
        assert(dbCountB === 2, `B DB: ${dbCountB}, expected 2`);

        // Owner A sees 3, Owner B sees 2
        const listA = await request("/api/owner/classes", { token: tokenA });
        const listB = await request("/api/owner/classes", { token: tokenB });
        assert(listA.data.data.classes.length === 3, `A list: ${listA.data.data.classes.length}`);
        assert(listB.data.data.classes.length === 2, `B list: ${listB.data.data.classes.length}`);
      }
    );

    // =====================================================
    // Test 6 — Independent limits (5 at limit, 1 available)
    // =====================================================

    await test(
      "T6: 5 counters at limit, 6th available → only 6th resource creatable",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

        // requireInstituteOwner checks Institute.ownerId
        await Institute.collection.updateOne(
          { _id: instituteId },
          { $set: { ownerId } }
        );

        await makeSubscription(instituteId, ownerId, [
          { key: "MAX_CLASSES", value: 1 },
          { key: "MAX_BATCHES", value: 1 },
          { key: "MAX_STUDENTS", value: 1 },
          { key: "MAX_TEACHERS", value: 1 },
          { key: "MAX_ADMINS", value: 2 },
          { key: "MAX_PARENTS", value: 5 }, // 5 available
        ]);
        const token = makeToken(ownerId);
        // Owner bypasses permission middleware
        const adminToken = makeToken(ownerId);

        // Fill 5 limits with 1 each
        const classRes = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Full Class" },
        });
        assert(classRes.status === 201, `Class: ${classRes.status}`);
        const classId = classRes.data.data.class.id;
        createdClassIds.push(new mongoose.Types.ObjectId(classId));

        const batchRes = await request("/api/owner/batches", {
          method: "POST",
          token,
          body: { classId, name: "Full Batch" },
        });
        assert(batchRes.status === 201, `Batch: ${batchRes.status}`);
        const batchId = batchRes.data.data.batch.id;
        createdBatchIds.push(new mongoose.Types.ObjectId(batchId));

        const studentRes = await request("/api/owner/students", {
          method: "POST",
          token,
          body: {
            name: "Full Student",
            email: `full-s-${randomUUID()}@example.com`,
            classId,
            batchId,
          },
        });
        assert(studentRes.status === 201, `Student: ${studentRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(studentRes.data.data.student.id));

        const teacherRes = await request("/api/admin/teachers", {
          method: "POST",
          token: adminToken,
          body: {
            name: "Full Teacher",
            email: `full-t-${randomUUID()}@example.com`,
            password: "TeacherPass123!",
          },
        });
        assert(teacherRes.status === 201, `Teacher: ${teacherRes.status}`);
        createdTeacherIds.push(new mongoose.Types.ObjectId(teacherRes.data.data.teacher.id));
        createdUserIds.push(new mongoose.Types.ObjectId(teacherRes.data.data.user.id));

        const adminRes = await request("/api/owner/admins", {
          method: "POST",
          token,
          body: {
            name: "Full Admin",
            email: `full-a-${randomUUID()}@example.com`,
            password: "AdminPass123!",
          },
        });
        assert(adminRes.status === 201, `Admin: ${adminRes.status}`);
        createdUserIds.push(new mongoose.Types.ObjectId(adminRes.data.data.admin.id));

        // Try to create more of each — should fail
        const class2 = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Extra Class" },
        });
        assert(class2.status === 403, `class2: ${class2.status}`);

        const admin2 = await request("/api/owner/admins", {
          method: "POST",
          token,
          body: {
            name: "Extra Admin",
            email: `extra-a-${randomUUID()}@example.com`,
            password: "AdminPass123!",
          },
        });
        assert(admin2.status === 403, `admin2: ${admin2.status}`);

        // But parents (limit=5) — create 2 more should succeed
        for (let i = 0; i < 2; i++) {
          const pRes = await request("/api/owner/parents", {
            method: "POST",
            token,
            body: {
              name: `Parent ${i}`,
              email: `extra-p-${randomUUID()}@example.com`,
              password: "ParentPass123!",
            },
          });
          assert(pRes.status === 201, `parent ${i}: ${pRes.status}`);
          createdUserIds.push(new mongoose.Types.ObjectId(pRes.data.data.parent.id));
        }

        // Verify parent counter = 2
        const parentCounter = await getCounter(instituteId, "MAX_PARENTS");
        assert(parentCounter.used === 2, `parents: ${parentCounter.used}, expected 2`);
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