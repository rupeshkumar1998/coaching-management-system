require("dotenv").config();

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const connectTestDB = require("../helpers/connectTestDB");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const UsageCounter = require("../../models/UsageCounter");

const {
  createOwnerAdmin,
} = require("../../controllers/ownerAdminController");

const { hashPassword } = require("../../services/authService");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.16 Sprint 4B — Owner Admin create + MAX_ADMINS limit
// =========================================================

const marker = `owner-admin-test-${Date.now()}`;

const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdUserIds = [];

let passed = 0;
let failed = 0;

const runTest = async (name, testFunction) => {
  try {
    await testFunction();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

const createResponse = () => {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
};

const callController = async (tenantId, institute, user, body) => {
  const req = {
    tenantId,
    institute,
    user,
    body,
  };
  const res = createResponse();
  await createOwnerAdmin(req, res);
  return res;
};

const makeInstituteAndOwner = async (label) => {
  const instituteId = new mongoose.Types.ObjectId();
  const ownerId = new mongoose.Types.ObjectId();

  await Institute.collection.insertOne({
    _id: instituteId,
    code: `OA_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: `Owner Admin Test ${label}`,
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);

  await User.collection.insertOne({
    _id: ownerId,
    instituteId,
    name: `Owner ${label}`,
    email: `owner-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role: "INSTITUTE_OWNER",
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(ownerId);

  return {
    instituteId,
    ownerId,
    institute: {
      _id: instituteId,
      approvalStatus: "APPROVED",
      isActive: true,
    },
    user: {
      _id: ownerId,
      role: "INSTITUTE_OWNER",
    },
  };
};

const makeSubscription = async (
  instituteId,
  ownerId,
  { featureOn = true, maxAdmins = 5 } = {}
) => {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `OAP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Owner Admin Test Plan",
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
  features.push({ key: "ADMIN_MANAGEMENT", enabled: featureOn });

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
    limits: [{ key: "MAX_ADMINS", value: maxAdmins }],
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
    limits: [{ key: "MAX_ADMINS", value: maxAdmins }],
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
};

const makeAdminBody = (overrides = {}) => ({
  name: "Test Admin",
  email: `admin-${randomUUID()}@example.com`,
  phone: "+919876543210",
  password: "AdminPassword123!",
  ...overrides,
});

const run = async () => {
  try {
    await connectTestDB();

    // =====================================================
    // A. Happy path + counter
    // =====================================================

    await runTest("A1: Create admin with valid subscription → 201", async () => {
      const ctx = await makeInstituteAndOwner("A1");
      await makeSubscription(ctx.instituteId, ctx.ownerId);

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );

      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.admin.role, "INSTITUTE_ADMIN");
      assert.ok(res.body.data.admin.id);

      createdUserIds.push(new mongoose.Types.ObjectId(res.body.data.admin.id));
    });

    await runTest("A2: Counter reserved on create", async () => {
      const ctx = await makeInstituteAndOwner("A2");
      await makeSubscription(ctx.instituteId, ctx.ownerId);

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      assert.equal(res.statusCode, 201);
      createdUserIds.push(new mongoose.Types.ObjectId(res.body.data.admin.id));

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_ADMINS",
        period: "lifetime",
      }).lean();
      assert.ok(counter, "counter should exist");
      assert.equal(counter.used, 1);
    });

    // =====================================================
    // B. Limit enforcement
    // =====================================================

    await runTest("B1: LIMIT_REACHED at boundary → 403", async () => {
      const ctx = await makeInstituteAndOwner("B1");
      await makeSubscription(ctx.instituteId, ctx.ownerId, { maxAdmins: 1 });

      const first = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      assert.equal(first.statusCode, 201);
      createdUserIds.push(new mongoose.Types.ObjectId(first.body.data.admin.id));

      const second = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      assert.equal(second.statusCode, 403);
      assert.equal(second.body.code, "LIMIT_REACHED");
    });

    await runTest("B2: Rollback on LIMIT_REACHED (counter unchanged)", async () => {
      const ctx = await makeInstituteAndOwner("B2");
      await makeSubscription(ctx.instituteId, ctx.ownerId, { maxAdmins: 1 });

      const first = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      createdUserIds.push(new mongoose.Types.ObjectId(first.body.data.admin.id));

      await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );

      const counter = await UsageCounter.findOne({
        instituteId: ctx.instituteId,
        limitKey: "MAX_ADMINS",
        period: "lifetime",
      }).lean();
      assert.equal(counter.used, 1, "counter should remain 1");
    });

    // =====================================================
    // C. Feature / subscription
    // =====================================================

    await runTest("C1: FEATURE_DISABLED when ADMIN_MANAGEMENT off → 403", async () => {
      const ctx = await makeInstituteAndOwner("C1");
      await makeSubscription(ctx.instituteId, ctx.ownerId, { featureOn: false });

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "FEATURE_DISABLED");
    });

    await runTest("C2: SUBSCRIPTION_INACTIVE without subscription → 403", async () => {
      const ctx = await makeInstituteAndOwner("C2");
      // No subscription created

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody()
      );
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "SUBSCRIPTION_INACTIVE");
    });

    // =====================================================
    // D. Other validations still work
    // =====================================================

    await runTest("D1: Duplicate email → 409", async () => {
      const ctx = await makeInstituteAndOwner("D1");
      await makeSubscription(ctx.instituteId, ctx.ownerId);

      const email = `dup-${randomUUID()}@example.com`;
      const first = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody({ email })
      );
      assert.equal(first.statusCode, 201);
      createdUserIds.push(new mongoose.Types.ObjectId(first.body.data.admin.id));

      const second = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody({ email })
      );
      assert.equal(second.statusCode, 409);
    });

    await runTest("D2: Missing name → 400", async () => {
      const ctx = await makeInstituteAndOwner("D2");
      await makeSubscription(ctx.instituteId, ctx.ownerId);

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        { email: "x@example.com", password: "AdminPassword123!" }
      );
      assert.equal(res.statusCode, 400);
    });

    await runTest("D3: Invalid email → 400", async () => {
      const ctx = await makeInstituteAndOwner("D3");
      await makeSubscription(ctx.instituteId, ctx.ownerId);

      const res = await callController(
        ctx.instituteId,
        ctx.institute,
        ctx.user,
        makeAdminBody({ email: "not-an-email" })
      );
      assert.equal(res.statusCode, 400);
    });

    await runTest("D4: Missing tenant → 403", async () => {
      const res = await callController(
        null,
        null,
        null,
        makeAdminBody()
      );
      assert.equal(res.statusCode, 403);
    });
  } catch (error) {
    failed++;
    console.error("TEST SETUP ERROR:", error);
  } finally {
    try {
      if (mongoose.connection.readyState === 1) {
        if (createdUserIds.length) {
          await User.collection.deleteMany({
            _id: { $in: createdUserIds },
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
        await mongoose.disconnect();
      }
    } catch (cleanupError) {
      failed++;
      console.error("CLEANUP ERROR:", cleanupError.message);
    }

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) {
      process.exitCode = 1;
    }
  }
};

run();