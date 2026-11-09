require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Class = require("../../models/Class");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const User = require("../../models/User");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createClass,
  listClasses,
  updateClass,
} = require("../../services/classService");

const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 — Class Service Tests
//
// Covers:
//   A. createClass — happy path + limit enforcement
//   B. createClass — feature/subscription/validation failures
//   C. createClass — teacher validation
//   D. listClasses — tenant isolation
//   E. updateClass — happy path + validations
//   F. updateClass — duplicate name protection
// =========================================================

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
  assert(threw, `expected rejection with code "${expectedCode}", succeeded`);
  if (expectedCode) {
    assert(
      code === expectedCode,
      `expected code "${expectedCode}", got "${code}"`
    );
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
    code: `CLS_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Class Service Test Institute",
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
    name: `Test ${role}`,
    email: `cls-${role.toLowerCase()}-${randomUUID()}@example.com`,
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
  { featureOn = true, maxClasses = 5 }
) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `CS_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Class Test Plan",
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

  return { subId, planId, versionId };
};

const setupContext = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const actorId = await makeUser("INSTITUTE_OWNER", instituteId);
  await makeSubscription(instituteId, opts);
  return { instituteId, actorId };
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // Wait for unique indexes
    await Class.init();

    // =====================================================
    // Section A — createClass happy path (3)
    // =====================================================

    await test("A1: Create valid class", async () => {
      const { instituteId, actorId } = await setupContext();

      const cls = await createClass({
        instituteId,
        name: "Class 10",
        description: "First class",
        actorId,
      });
      createdClassIds.push(cls._id);

      assert(cls.name === "Class 10", "name");
      assert(cls.description === "First class", "description");
      assert(cls.isActive === true, "active");
    });

    await test("A2: Create class with teacher + capacity", async () => {
      const { instituteId, actorId } = await setupContext();
      const teacherId = await makeUser("TEACHER", instituteId);

      const cls = await createClass({
        instituteId,
        name: "Class 11",
        classTeacherId: teacherId,
        capacity: 50,
        sortOrder: 11,
        actorId,
      });
      createdClassIds.push(cls._id);

      assert(
        String(cls.classTeacherId) === String(teacherId),
        "teacher"
      );
      assert(cls.capacity === 50, "capacity");
      assert(cls.sortOrder === 11, "sortOrder");
    });

    await test("A3: Class creation reserves MAX_CLASSES counter", async () => {
      const { instituteId, actorId } = await setupContext();

      await createClass({
        instituteId,
        name: "Class 12",
        actorId,
      }).then((c) => createdClassIds.push(c._id));

      const counter = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_CLASSES",
        period: "lifetime",
      }).lean();

      assert(counter !== null, "counter created");
      assert(counter.used === 1, `used ${counter.used}`);
    });

    // =====================================================
    // Section B — Limit enforcement (2)
    // =====================================================

    await test("B1: LIMIT_REACHED when at MAX_CLASSES", async () => {
      const { instituteId, actorId } = await setupContext({
        maxClasses: 2,
      });

      await createClass({ instituteId, name: "C1", actorId }).then((c) =>
        createdClassIds.push(c._id)
      );
      await createClass({ instituteId, name: "C2", actorId }).then((c) =>
        createdClassIds.push(c._id)
      );

      await expectReject(
        () => createClass({ instituteId, name: "C3", actorId }),
        "LIMIT_REACHED"
      );
    });

    await test(
      "B2: LIMIT_REACHED does not increment counter (rollback)",
      async () => {
        const { instituteId, actorId } = await setupContext({
          maxClasses: 1,
        });

        await createClass({ instituteId, name: "OnlyOne", actorId }).then(
          (c) => createdClassIds.push(c._id)
        );

        const before = await UsageCounter.findOne({
          instituteId,
          limitKey: "MAX_CLASSES",
          period: "lifetime",
        }).lean();
        assert(before.used === 1, "used should be 1");

        await expectReject(
          () => createClass({ instituteId, name: "Second", actorId }),
          "LIMIT_REACHED"
        );

        const after = await UsageCounter.findOne({
          instituteId,
          limitKey: "MAX_CLASSES",
          period: "lifetime",
        }).lean();
        assert(after.used === 1, `used should remain 1, got ${after.used}`);
      }
    );

    // =====================================================
    // Section C — Feature / subscription failures (2)
    // =====================================================

    await test("C1: FEATURE_DISABLED when CLASS_MANAGEMENT off", async () => {
      const { instituteId, actorId } = await setupContext({
        featureOn: false,
      });

      await expectReject(
        () => createClass({ instituteId, name: "Blocked", actorId }),
        "FEATURE_DISABLED"
      );
    });

    await test("C2: SUBSCRIPTION_INACTIVE without subscription", async () => {
      const instituteId = await makeInstitute();
      const actorId = await makeUser("INSTITUTE_OWNER", instituteId);

      await expectReject(
        () => createClass({ instituteId, name: "NoSub", actorId }),
        "SUBSCRIPTION_INACTIVE"
      );
    });

    // =====================================================
    // Section D — Validation failures (4)
    // =====================================================

    await test("D1: INVALID_CLASS_NAME for empty name", async () => {
      const { instituteId, actorId } = await setupContext();

      await expectReject(
        () => createClass({ instituteId, name: " ", actorId }),
        "INVALID_CLASS_NAME"
      );
    });

    await test("D2: CLASS_NAME_EXISTS for duplicate name", async () => {
      const { instituteId, actorId } = await setupContext();

      await createClass({ instituteId, name: "Dup", actorId }).then((c) =>
        createdClassIds.push(c._id)
      );

      await expectReject(
        () => createClass({ instituteId, name: "Dup", actorId }),
        "CLASS_NAME_EXISTS"
      );
    });

    await test("D3: CLASS_TEACHER_NOT_FOUND for invalid teacher", async () => {
      const { instituteId, actorId } = await setupContext();

      await expectReject(
        () =>
          createClass({
            instituteId,
            name: "WithBadTeacher",
            classTeacherId: new mongoose.Types.ObjectId(),
            actorId,
          }),
        "CLASS_TEACHER_NOT_FOUND"
      );
    });

    await test("D4: INVALID_ACTOR_ID rejected", async () => {
      const { instituteId } = await setupContext();

      await expectReject(
        () =>
          createClass({
            instituteId,
            name: "NoActor",
            actorId: "invalid",
          }),
        "INVALID_ACTOR_ID"
      );
    });

    // =====================================================
    // Section E — listClasses (2)
    // =====================================================

    await test("E1: listClasses returns all for institute", async () => {
      const { instituteId, actorId } = await setupContext();

      await createClass({ instituteId, name: "Class A", actorId }).then((c) =>
        createdClassIds.push(c._id)
      );
      await createClass({ instituteId, name: "Class B", actorId }).then((c) =>
        createdClassIds.push(c._id)
      );

      const list = await listClasses({ instituteId });
      assert(list.length === 2, `expected 2, got ${list.length}`);
    });

    await test("E2: listClasses tenant-scoped", async () => {
      const ctxA = await setupContext();
      const ctxB = await setupContext();

      await createClass({
        instituteId: ctxA.instituteId,
        name: "A's Class",
        actorId: ctxA.actorId,
      }).then((c) => createdClassIds.push(c._id));

      const listA = await listClasses({ instituteId: ctxA.instituteId });
      const listB = await listClasses({ instituteId: ctxB.instituteId });

      assert(listA.length === 1, "A has 1");
      assert(listB.length === 0, "B has 0");
    });

    // =====================================================
    // Section F — updateClass (5)
    // =====================================================

    await test("F1: Update name successfully", async () => {
      const { instituteId, actorId } = await setupContext();

      const cls = await createClass({
        instituteId,
        name: "Old Name",
        actorId,
      });
      createdClassIds.push(cls._id);

      const updated = await updateClass({
        instituteId,
        classId: cls._id,
        updates: { name: "New Name" },
        actorId,
      });

      assert(updated.name === "New Name", `name ${updated.name}`);
    });

    await test("F2: Update isActive=false", async () => {
      const { instituteId, actorId } = await setupContext();

      const cls = await createClass({
        instituteId,
        name: "ActiveClass",
        actorId,
      });
      createdClassIds.push(cls._id);

      const updated = await updateClass({
        instituteId,
        classId: cls._id,
        updates: { isActive: false },
        actorId,
      });

      assert(updated.isActive === false, "inactive");
    });

    await test("F3: Update to duplicate name rejected", async () => {
      const { instituteId, actorId } = await setupContext();

      const c1 = await createClass({ instituteId, name: "ClassA", actorId });
      const c2 = await createClass({ instituteId, name: "ClassB", actorId });
      createdClassIds.push(c1._id, c2._id);

      await expectReject(
        () =>
          updateClass({
            instituteId,
            classId: c2._id,
            updates: { name: "ClassA" },
            actorId,
          }),
        "CLASS_NAME_EXISTS"
      );
    });

    await test("F4: Update nonexistent class → CLASS_NOT_FOUND", async () => {
      const { instituteId, actorId } = await setupContext();

      await expectReject(
        () =>
          updateClass({
            instituteId,
            classId: new mongoose.Types.ObjectId(),
            updates: { name: "Whatever" },
            actorId,
          }),
        "CLASS_NOT_FOUND"
      );
    });

    await test("F5: Update does NOT change counter", async () => {
      const { instituteId, actorId } = await setupContext();

      const cls = await createClass({
        instituteId,
        name: "CounterCheck",
        actorId,
      });
      createdClassIds.push(cls._id);

      const before = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_CLASSES",
        period: "lifetime",
      }).lean();

      await updateClass({
        instituteId,
        classId: cls._id,
        updates: { name: "CounterCheckRenamed", isActive: false },
        actorId,
      });

      const after = await UsageCounter.findOne({
        instituteId,
        limitKey: "MAX_CLASSES",
        period: "lifetime",
      }).lean();

      assert(
        before.used === after.used,
        `update should not change counter (before=${before.used}, after=${after.used})`
      );
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdClassIds.length) {
      await Class.collection.deleteMany({
        _id: { $in: createdClassIds },
      });
    }
    if (createdInstituteIds.length) {
      await UsageCounter.collection.deleteMany({
        instituteId: { $in: createdInstituteIds },
      });
    }
    if (createdSubscriptionIds.length) {
      await Subscription.collection.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
    }
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }
    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
      });
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