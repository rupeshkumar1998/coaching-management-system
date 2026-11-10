require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const {
  createParent,
  listParents,
  getParent,
  updateParent,
} = require("../../services/parentService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const createdUserIds = [];
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

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `PA_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Parent Service Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(id);
  return id;
};

const makeSubscription = async (instituteId, { featureOn = true, maxParents = 5 } = {}) => {
  const actorId = new mongoose.Types.ObjectId();
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `PAP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Parent Service Test Plan",
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

const setupContext = async (opts = {}) => {
  const instituteId = await makeInstitute();
  const actorId = new mongoose.Types.ObjectId();
  await makeSubscription(instituteId, opts);
  return { instituteId, actorId };
};

const makeParentInput = (ctx, overrides = {}) => ({
  instituteId: ctx.instituteId,
  name: "Test Parent",
  email: `parent-${randomUUID()}@example.com`,
  phone: "+919876543210",
  password: "ParentPassword123!",
  actorId: ctx.actorId,
  ...overrides,
});

const run = async () => {
  await connectTestDB();

  try {
    await test("A1: Create valid parent", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      assert(parent.role === "PARENT", "role");
      assert(parent.email, "email");
      assert(parent.isActive === true, "active");
      assert(parent.accountStatus === "ACTIVE", "accountStatus");
    });

    await test("A2: Counter reserved on create", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_PARENTS",
        period: "lifetime",
      }).lean();
      assert(counter !== null, "counter exists");
      assert(counter.used === 1, `used ${counter.used}`);
    });

    await test("A3: Password is hashed", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      const reloaded = await User.findById(parent._id).select("+password");
      assert(
        reloaded.password !== "ParentPassword123!",
        "password not plain"
      );
    });

    await test("A4: LIMIT_REACHED at boundary", async () => {
      const ctx = await setupContext({ maxParents: 1 });
      const first = await createParent(makeParentInput(ctx));
      createdUserIds.push(first._id);

      await expectReject(
        () => createParent(makeParentInput(ctx)),
        "LIMIT_REACHED"
      );
    });

    await test("A5: Rollback on LIMIT_REACHED (counter unchanged)", async () => {
      const ctx = await setupContext({ maxParents: 1 });
      const first = await createParent(makeParentInput(ctx));
      createdUserIds.push(first._id);

      await expectReject(
        () => createParent(makeParentInput(ctx)),
        "LIMIT_REACHED"
      );

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_PARENTS",
        period: "lifetime",
      }).lean();
      assert(counter.used === 1, `counter should be 1, got ${counter.used}`);
    });

    await test("A6: EMAIL_EXISTS for duplicate email", async () => {
      const ctx = await setupContext();
      const email = `dup-${randomUUID()}@example.com`;
      const first = await createParent(makeParentInput(ctx, { email }));
      createdUserIds.push(first._id);

      await expectReject(
        () => createParent(makeParentInput(ctx, { email })),
        "EMAIL_EXISTS"
      );
    });

    await test("A7: FEATURE_DISABLED when PARENT_MANAGEMENT off", async () => {
      const ctx = await setupContext({ featureOn: false });
      await expectReject(
        () => createParent(makeParentInput(ctx)),
        "FEATURE_DISABLED"
      );
    });

    await test("A8: SUBSCRIPTION_INACTIVE without subscription", async () => {
      const instituteId = await makeInstitute();
      const actorId = new mongoose.Types.ObjectId();

      await expectReject(
        () =>
          createParent({
            instituteId,
            actorId,
            name: "No Sub",
            email: `nosub-${randomUUID()}@example.com`,
            password: "Password123!",
          }),
        "SUBSCRIPTION_INACTIVE"
      );
    });

    await test("B1: listParents returns all parents of institute", async () => {
      const ctx = await setupContext();
      const a = await createParent(makeParentInput(ctx, { name: "Parent A" }));
      const b = await createParent(makeParentInput(ctx, { name: "Parent B" }));
      createdUserIds.push(a._id, b._id);

      const list = await listParents({ instituteId: ctx.instituteId });
      assert(list.length === 2, `expected 2, got ${list.length}`);
    });

    await test("B2: listParents tenant-scoped", async () => {
      const ctxA = await setupContext();
      const ctxB = await setupContext();

      const a = await createParent(makeParentInput(ctxA));
      createdUserIds.push(a._id);

      const listA = await listParents({ instituteId: ctxA.instituteId });
      const listB = await listParents({ instituteId: ctxB.instituteId });
      assert(listA.length === 1, "A has 1");
      assert(listB.length === 0, "B has 0");
    });

    await test("C1: getParent returns parent", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      const fetched = await getParent({
        instituteId: ctx.instituteId,
        parentId: parent._id,
      });
      assert(String(fetched._id) === String(parent._id), "id");
    });

    await test("C2: getParent 404 for wrong id", async () => {
      const ctx = await setupContext();
      await expectReject(
        () =>
          getParent({
            instituteId: ctx.instituteId,
            parentId: new mongoose.Types.ObjectId(),
          }),
        "PARENT_NOT_FOUND"
      );
    });

    await test("D1: updateParent name", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      const updated = await updateParent({
        instituteId: ctx.instituteId,
        parentId: parent._id,
        updates: { name: "Updated Parent" },
        actorId: ctx.actorId,
      });
      assert(updated.name === "Updated Parent", "name");
    });

    await test("D2: updateParent rejects email change", async () => {
      const ctx = await setupContext();
      const parent = await createParent(makeParentInput(ctx));
      createdUserIds.push(parent._id);

      await expectReject(
        () =>
          updateParent({
            instituteId: ctx.instituteId,
            parentId: parent._id,
            updates: { email: "new@example.com" },
            actorId: ctx.actorId,
          }),
        "UNSUPPORTED_UPDATE_FIELDS"
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