require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Batch = require("../../models/Batch");
const Class = require("../../models/Class");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  assignBatch,
  removeBatch,
} = require("../../services/studentService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const createdUserIds = [];
const createdBatchIds = [];
const createdClassIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectReject = async (fn, expectedCode) => {
  let threw = false;
  let code = null;
  try {
    await fn();
  } catch (e) {
    threw = true;
    code = e.code;
  }
  assert(threw, `expected rejection "${expectedCode}", succeeded`);
  if (expectedCode) {
    assert(code === expectedCode, `expected "${expectedCode}", got "${code}"`);
  }
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

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `ST_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Student Service Test Institute",
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
    name: `ST ${role}`,
    email: `st-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeClass = async (instituteId, actorId, name = "Class 10", isActive = true) => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name,
    description: "",
    isActive,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClassIds.push(id);
  return id;
};

const makeBatch = async (instituteId, classId, actorId, name = "Batch A", status = "ACTIVE") => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name,
    teachers: [],
    schedule: null,
    status,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const makeSubscription = async (instituteId, { featureOn = true, maxStudents = 5 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `STP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Student Service Test Plan",
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

const setupContext = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const actorId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId, actorId);
  const batchId = await makeBatch(instituteId, classId, actorId);
  await makeSubscription(instituteId, opts);
  return { instituteId, actorId, classId, batchId };
};

const makeStudentInput = (ctx, overrides = {}) => ({
  instituteId: ctx.instituteId,
  name: "Test Student",
  email: `student-${randomUUID()}@example.com`,
  phone: "+919876543210",
  classId: ctx.classId,
  batchId: ctx.batchId,
  actorId: ctx.actorId,
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
    // =====================================================
    // A — Create student (6)
    // =====================================================

    await test("A1: Create valid student (returns temp password)", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      assert(result.student.role === "STUDENT", "role");
      assert(result.student.email, "email");
      assert(
        String(result.student.batchId) === String(ctx.batchId),
        "batchId"
      );
      assert(
        String(result.classId) === String(ctx.classId),
        "derived classId"
      );
      assert(result.tempPassword, "tempPassword");
      assert(
        result.tempPassword.length === 12,
        `tempPassword length: ${result.tempPassword.length}`
      );
      assert(
        result.student.mustChangePassword === true,
        "mustChangePassword"
      );
    });

    await test("A2: Counter reserved on create", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
      }).lean();
      assert(counter !== null, "counter exists");
      assert(counter.used === 1, `used ${counter.used}`);
    });

    await test("A3: LIMIT_REACHED at boundary", async () => {
      const ctx = await setupContext({ maxStudents: 1 });
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      await expectReject(
        () => createStudent(makeStudentInput(ctx)),
        "LIMIT_REACHED"
      );
    });

    await test("A4: Rollback on LIMIT_REACHED (counter unchanged)", async () => {
      const ctx = await setupContext({ maxStudents: 1 });
      const first = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(first.student._id);

      await expectReject(
        () => createStudent(makeStudentInput(ctx)),
        "LIMIT_REACHED"
      );

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
      }).lean();
      assert(counter.used === 1, `counter should be 1, got ${counter.used}`);
    });

    await test("A5: EMAIL_EXISTS for duplicate email", async () => {
      const ctx = await setupContext();
      const email = `dup-${randomUUID()}@example.com`;
      const first = await createStudent(makeStudentInput(ctx, { email }));
      createdUserIds.push(first.student._id);

      await expectReject(
        () => createStudent(makeStudentInput(ctx, { email })),
        "EMAIL_EXISTS"
      );
    });

    await test("A6: FEATURE_DISABLED when STUDENT_MANAGEMENT off", async () => {
      const ctx = await setupContext({ featureOn: false });
      await expectReject(
        () => createStudent(makeStudentInput(ctx)),
        "FEATURE_DISABLED"
      );
    });

    // =====================================================
    // B — Batch/Class validation (3)
    // =====================================================

    await test("B1: BATCH_CLASS_MISMATCH when batch not in class", async () => {
      const ctx = await setupContext();
      const otherClass = await makeClass(
        ctx.instituteId,
        ctx.actorId,
        "Other Class"
      );
      const otherBatch = await makeBatch(
        ctx.instituteId,
        otherClass,
        ctx.actorId
      );

      await expectReject(
        () =>
          createStudent(
            makeStudentInput(ctx, {
              classId: ctx.classId,
              batchId: otherBatch,
            })
          ),
        "BATCH_CLASS_MISMATCH"
      );
    });

    await test("B2: CLASS_NOT_FOUND for nonexistent classId", async () => {
      const ctx = await setupContext();
      await expectReject(
        () =>
          createStudent(
            makeStudentInput(ctx, {
              classId: new mongoose.Types.ObjectId(),
            })
          ),
        "CLASS_NOT_FOUND"
      );
    });

    await test("B3: BATCH_NOT_FOUND for nonexistent batchId", async () => {
      const ctx = await setupContext();
      await expectReject(
        () =>
          createStudent(
            makeStudentInput(ctx, {
              batchId: new mongoose.Types.ObjectId(),
            })
          ),
        "BATCH_NOT_FOUND"
      );
    });

    // =====================================================
    // C — List/Get (4)
    // =====================================================

    await test("C1: listStudents returns all students of institute", async () => {
      const ctx = await setupContext();
      const a = await createStudent(makeStudentInput(ctx, { name: "S1" }));
      const b = await createStudent(makeStudentInput(ctx, { name: "S2" }));
      createdUserIds.push(a.student._id, b.student._id);

      const list = await listStudents({ instituteId: ctx.instituteId });
      assert(list.length === 2, `expected 2, got ${list.length}`);
    });

    await test("C2: listStudents with batchId filter", async () => {
      const ctx = await setupContext();
      const otherBatch = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.actorId,
        "Batch 2"
      );

      const a = await createStudent(makeStudentInput(ctx));
      const b = await createStudent(
        makeStudentInput(ctx, { batchId: otherBatch })
      );
      createdUserIds.push(a.student._id, b.student._id);

      const list = await listStudents({
        instituteId: ctx.instituteId,
        batchId: ctx.batchId,
      });
      assert(list.length === 1, `expected 1, got ${list.length}`);
    });

    await test("C3: listStudents with classId filter (derives batches)", async () => {
      const ctx = await setupContext();
      const otherClass = await makeClass(
        ctx.instituteId,
        ctx.actorId,
        "Other Class"
      );
      const otherBatch = await makeBatch(
        ctx.instituteId,
        otherClass,
        ctx.actorId
      );

      const a = await createStudent(makeStudentInput(ctx));
      const b = await createStudent(
        makeStudentInput(ctx, {
          classId: otherClass,
          batchId: otherBatch,
        })
      );
      createdUserIds.push(a.student._id, b.student._id);

      const list = await listStudents({
        instituteId: ctx.instituteId,
        classId: ctx.classId,
      });
      assert(list.length === 1, `expected 1, got ${list.length}`);
    });

    await test("C4: getStudent returns student with derived classId", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      const fetched = await getStudent({
        instituteId: ctx.instituteId,
        studentId: result.student._id,
      });

      assert(fetched.student._id, "id");
      assert(
        String(fetched.classId) === String(ctx.classId),
        "derived classId"
      );
    });

    // =====================================================
    // D — Update (2)
    // =====================================================

    await test("D1: updateStudent name", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      const updated = await updateStudent({
        instituteId: ctx.instituteId,
        studentId: result.student._id,
        updates: { name: "Updated Name" },
        actorId: ctx.actorId,
      });
      assert(updated.name === "Updated Name", "name");
    });

    await test("D2: updateStudent rejects batchId change", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      await expectReject(
        () =>
          updateStudent({
            instituteId: ctx.instituteId,
            studentId: result.student._id,
            updates: { batchId: new mongoose.Types.ObjectId() },
            actorId: ctx.actorId,
          }),
        "UNSUPPORTED_UPDATE_FIELDS"
      );
    });

    // =====================================================
    // E — Assign batch (3)
    // =====================================================

    await test("E1: assignBatch to different batch", async () => {
      const ctx = await setupContext();
      const newBatch = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.actorId,
        "Batch New"
      );

      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      const updated = await assignBatch({
        instituteId: ctx.instituteId,
        studentId: result.student._id,
        batchId: newBatch,
        actorId: ctx.actorId,
      });
      assert(
        String(updated.student.batchId) === String(newBatch),
        "batchId updated"
      );
    });

    await test("E2: assignBatch BATCH_NOT_FOUND for invalid id", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      await expectReject(
        () =>
          assignBatch({
            instituteId: ctx.instituteId,
            studentId: result.student._id,
            batchId: new mongoose.Types.ObjectId(),
            actorId: ctx.actorId,
          }),
        "BATCH_NOT_FOUND"
      );
    });

    await test("E3: assignBatch BATCH_INACTIVE for inactive batch", async () => {
      const ctx = await setupContext();
      const inactiveBatch = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.actorId,
        "Batch Inactive",
        "INACTIVE"
      );

      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      await expectReject(
        () =>
          assignBatch({
            instituteId: ctx.instituteId,
            studentId: result.student._id,
            batchId: inactiveBatch,
            actorId: ctx.actorId,
          }),
        "BATCH_INACTIVE"
      );
    });

    // =====================================================
    // F — Remove batch (2)
    // =====================================================

    await test("F1: removeBatch sets batchId to null", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      const updated = await removeBatch({
        instituteId: ctx.instituteId,
        studentId: result.student._id,
        actorId: ctx.actorId,
      });
      assert(updated.batchId === null, "batchId null");
    });

    await test("F2: removeBatch NO_BATCH_ASSIGNED after removal", async () => {
      const ctx = await setupContext();
      const result = await createStudent(makeStudentInput(ctx));
      createdUserIds.push(result.student._id);

      await removeBatch({
        instituteId: ctx.instituteId,
        studentId: result.student._id,
        actorId: ctx.actorId,
      });

      await expectReject(
        () =>
          removeBatch({
            instituteId: ctx.instituteId,
            studentId: result.student._id,
            actorId: ctx.actorId,
          }),
        "NO_BATCH_ASSIGNED"
      );
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
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