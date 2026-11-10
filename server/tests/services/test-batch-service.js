require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Batch = require("../../models/Batch");
const Class = require("../../models/Class");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const User = require("../../models/User");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const {
  createBatch,
  listBatches,
  getBatch,
  updateBatch,
} = require("../../services/batchService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const createdBatchIds = [];
const createdClassIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdUserIds = [];

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
    code: `BT_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Batch Service Test Institute",
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
    name: `BT ${role}`,
    email: `bt-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscription = async (
  instituteId,
  { featureOn = true, maxBatches = 5 } = {}
) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `BSP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Batch Service Test Plan",
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
  features.push({ key: "BATCH_MANAGEMENT", enabled: featureOn });

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
    limits: [{ key: "MAX_BATCHES", value: maxBatches }],
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
    limits: [{ key: "MAX_BATCHES", value: maxBatches }],
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
  await makeSubscription(instituteId, opts);
  return { instituteId, actorId, classId };
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await Batch.init();
  await Class.init();

  try {
    // =====================================================
    // A — Create happy paths (3)
    // =====================================================

    await test("A1: Create valid batch", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "Batch A",
        actorId,
      });
      createdBatchIds.push(b._id);
      assert(b.name === "Batch A", "name");
      assert(b.status === "ACTIVE", "status");
    });

    await test("A2: Create with teachers + schedule", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const t1 = await makeUser("TEACHER", instituteId);
      const t2 = await makeUser("TEACHER", instituteId);

      const b = await createBatch({
        instituteId,
        classId,
        name: "Batch B",
        teachers: [
          { teacherId: t1, subject: "Math" },
          { teacherId: t2, subject: "Physics" },
        ],
        schedule: {
          days: ["MON", "WED"],
          startTime: "18:00",
          endTime: "19:30",
        },
        actorId,
      });
      createdBatchIds.push(b._id);
      assert(b.teachers.length === 2, "teachers");
      assert(b.schedule !== null, "schedule");
    });

    await test("A3: Counter reserved on create", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      await createBatch({ instituteId, classId, name: "Batch C", actorId })
        .then((b) => createdBatchIds.push(b._id));

      const counter = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_BATCHES",
        period: "lifetime",
      }).lean();
      assert(counter !== null, "counter exists");
      assert(counter.used === 1, `used ${counter.used}`);
    });

    // =====================================================
    // B — Limit (2)
    // =====================================================

    await test("B1: LIMIT_REACHED at boundary", async () => {
      const { instituteId, actorId, classId } = await setupContext({
        maxBatches: 1,
      });
      await createBatch({ instituteId, classId, name: "Only", actorId })
        .then((b) => createdBatchIds.push(b._id));

      await expectReject(
        () => createBatch({ instituteId, classId, name: "Second", actorId }),
        "LIMIT_REACHED"
      );
    });

    await test("B2: Rollback on LIMIT_REACHED (counter unchanged)", async () => {
      const { instituteId, actorId, classId } = await setupContext({
        maxBatches: 1,
      });
      await createBatch({ instituteId, classId, name: "First", actorId })
        .then((b) => createdBatchIds.push(b._id));

      await expectReject(
        () => createBatch({ instituteId, classId, name: "Second", actorId }),
        "LIMIT_REACHED"
      );

      const counter = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_BATCHES",
        period: "lifetime",
      }).lean();
      assert(counter.used === 1, `counter should be 1, got ${counter.used}`);
    });

    // =====================================================
    // C — Feature / subscription (2)
    // =====================================================

    await test("C1: FEATURE_DISABLED when BATCH_MANAGEMENT off", async () => {
      const { instituteId, actorId, classId } = await setupContext({
        featureOn: false,
      });
      await expectReject(
        () => createBatch({ instituteId, classId, name: "Blocked", actorId }),
        "FEATURE_DISABLED"
      );
    });

    await test("C2: SUBSCRIPTION_INACTIVE without sub", async () => {
      const instituteId = await makeInstitute();
      const actorId = await makeUser("INSTITUTE_OWNER", instituteId);
      const classId = await makeClass(instituteId, actorId);

      await expectReject(
        () => createBatch({ instituteId, classId, name: "NoSub", actorId }),
        "SUBSCRIPTION_INACTIVE"
      );
    });

    // =====================================================
    // D — Class / validation (4)
    // =====================================================

    await test("D1: CLASS_NOT_FOUND for invalid classId", async () => {
      const { instituteId, actorId } = await setupContext();
      await expectReject(
        () =>
          createBatch({
            instituteId,
            classId: new mongoose.Types.ObjectId(),
            name: "NoClass",
            actorId,
          }),
        "CLASS_NOT_FOUND"
      );
    });

    await test("D2: INVALID_BATCH_NAME for empty name", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      await expectReject(
        () => createBatch({ instituteId, classId, name: " ", actorId }),
        "INVALID_BATCH_NAME"
      );
    });

    await test("D3: BATCH_NAME_EXISTS for duplicate", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      await createBatch({ instituteId, classId, name: "Dup", actorId })
        .then((b) => createdBatchIds.push(b._id));

      await expectReject(
        () => createBatch({ instituteId, classId, name: "Dup", actorId }),
        "BATCH_NAME_EXISTS"
      );
    });

    await test("D4: Same name in different class → allowed", async () => {
      const { instituteId, actorId } = await setupContext();
      const c1 = await makeClass(instituteId, actorId, "Class A");
      const c2 = await makeClass(instituteId, actorId, "Class B");

      await createBatch({ instituteId, classId: c1, name: "BatchX", actorId })
        .then((b) => createdBatchIds.push(b._id));
      await createBatch({ instituteId, classId: c2, name: "BatchX", actorId })
        .then((b) => createdBatchIds.push(b._id));
    });

    // =====================================================
    // E — Teacher validation (3)
    // =====================================================

    await test("E1: TEACHER_NOT_FOUND for invalid teacherId", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      await expectReject(
        () =>
          createBatch({
            instituteId,
            classId,
            name: "NoTeacher",
            teachers: [{ teacherId: new mongoose.Types.ObjectId(), subject: "Math" }],
            actorId,
          }),
        "TEACHER_NOT_FOUND"
      );
    });

    await test("E2: Teacher from different institute rejected", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const otherInstituteId = await makeInstitute();
      const otherTeacher = await makeUser("TEACHER", otherInstituteId);

      await expectReject(
        () =>
          createBatch({
            instituteId,
            classId,
            name: "CrossTenantTeacher",
            teachers: [{ teacherId: otherTeacher, subject: "Math" }],
            actorId,
          }),
        "TEACHER_NOT_FOUND"
      );
    });

    await test("E3: DUPLICATE_TEACHER_SUBJECT rejected", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const t = await makeUser("TEACHER", instituteId);
      await expectReject(
        () =>
          createBatch({
            instituteId,
            classId,
            name: "DupTeachSubj",
            teachers: [
              { teacherId: t, subject: "Math" },
              { teacherId: t, subject: "Math" },
            ],
            actorId,
          }),
        "DUPLICATE_TEACHER_SUBJECT"
      );
    });

    // =====================================================
    // F — listBatches (3)
    // =====================================================

    await test("F1: listBatches returns all", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      await createBatch({ instituteId, classId, name: "L1", actorId }).then((b) => createdBatchIds.push(b._id));
      await createBatch({ instituteId, classId, name: "L2", actorId }).then((b) => createdBatchIds.push(b._id));

      const list = await listBatches({ instituteId });
      assert(list.length === 2, `expected 2, got ${list.length}`);
    });

    await test("F2: listBatches with classId filter", async () => {
      const { instituteId, actorId } = await setupContext();
      const c1 = await makeClass(instituteId, actorId, "Class P");
      const c2 = await makeClass(instituteId, actorId, "Class Q");

      await createBatch({ instituteId, classId: c1, name: "B1", actorId }).then((b) => createdBatchIds.push(b._id));
      await createBatch({ instituteId, classId: c2, name: "B2", actorId }).then((b) => createdBatchIds.push(b._id));

      const listC1 = await listBatches({ instituteId, classId: c1 });
      assert(listC1.length === 1, `expected 1 for c1, got ${listC1.length}`);
    });

    await test("F3: listBatches tenant-scoped", async () => {
      const ctxA = await setupContext();
      const ctxB = await setupContext();
      await createBatch({
        instituteId: ctxA.instituteId,
        classId: ctxA.classId,
        name: "A's Batch",
        actorId: ctxA.actorId,
      }).then((b) => createdBatchIds.push(b._id));

      const listA = await listBatches({ instituteId: ctxA.instituteId });
      const listB = await listBatches({ instituteId: ctxB.instituteId });
      assert(listA.length === 1, "A has 1");
      assert(listB.length === 0, "B has 0");
    });

    // =====================================================
    // G — getBatch (2)
    // =====================================================

    await test("G1: getBatch returns batch", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "GetMe",
        actorId,
      });
      createdBatchIds.push(b._id);

      const fetched = await getBatch({ instituteId, batchId: b._id });
      assert(String(fetched._id) === String(b._id), "id");
    });

    await test("G2: getBatch BATCH_NOT_FOUND for wrong id", async () => {
      const { instituteId } = await setupContext();
      await expectReject(
        () => getBatch({ instituteId, batchId: new mongoose.Types.ObjectId() }),
        "BATCH_NOT_FOUND"
      );
    });

    // =====================================================
    // H — updateBatch (4)
    // =====================================================

    await test("H1: Update name", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "Old",
        actorId,
      });
      createdBatchIds.push(b._id);

      const updated = await updateBatch({
        instituteId,
        batchId: b._id,
        updates: { name: "New" },
        actorId,
      });
      assert(updated.name === "New", "name");
    });

    await test("H2: Update status to INACTIVE", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "Act",
        actorId,
      });
      createdBatchIds.push(b._id);

      const updated = await updateBatch({
        instituteId,
        batchId: b._id,
        updates: { status: "INACTIVE" },
        actorId,
      });
      assert(updated.status === "INACTIVE", "status");
    });

    await test("H3: classId cannot be changed", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "ImmutableClass",
        actorId,
      });
      createdBatchIds.push(b._id);

      await expectReject(
        () =>
          updateBatch({
            instituteId,
            batchId: b._id,
            updates: { classId: new mongoose.Types.ObjectId() },
            actorId,
          }),
        "CLASS_ID_IMMUTABLE"
      );
    });

    await test("H4: Update does not change counter", async () => {
      const { instituteId, actorId, classId } = await setupContext();
      const b = await createBatch({
        instituteId,
        classId,
        name: "Counter",
        actorId,
      });
      createdBatchIds.push(b._id);

      const before = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_BATCHES",
        period: "lifetime",
      }).lean();
      await updateBatch({
        instituteId,
        batchId: b._id,
        updates: { name: "Counter2", status: "INACTIVE" },
        actorId,
      });
      const after = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_BATCHES",
        period: "lifetime",
      }).lean();
      assert(before.used === after.used, "counter unchanged");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");
    if (failed > 0) process.exitCode = 1;
  } finally {
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