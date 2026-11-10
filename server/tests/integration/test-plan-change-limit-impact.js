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
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

// =========================================================
// 32.16.15.16 Sprint 6B — Plan Change Impact on Limits
//
// Scenario: institute is at some usage level under plan
// version X. Super Admin upgrades or downgrades the plan
// (limit value changes). What happens?
//
// Expected:
//   - UsageCounter is keyed by (instituteId, limitKey, period)
//     — NOT by subscriptionId. So it survives plan changes.
//   - Upgrade: more slots available, counter unchanged.
//   - Downgrade: new creates blocked if already over new limit,
//     but existing records preserved.
//   - Identity (subscription._id, snapshotCapturedAt) unchanged.
//
// Simulation approach:
//   In production, plan change = new Subscription record with
//   new snapshot. For test isolation, we update the existing
//   Subscription.limits directly via raw collection update.
//   This tests the counter behavior, which is what matters.
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
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
    code: `PL_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Plan Change Test Institute",
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
    name: `PL ${role}`,
    email: `pl-${role.toLowerCase()}-${randomUUID()}@example.com`,
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

const makeSubscriptionWithMaxClasses = async (
  instituteId,
  ownerId,
  maxClasses
) => {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `PLP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Plan Change Test Plan",
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
  features.push({ key: "CLASS_MANAGEMENT", enabled: true });

  const limits = [{ key: "MAX_CLASSES", value: maxClasses }];

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

  return { subId, versionId, features };
};

const createClass = async (instituteId, ownerId, name) => {
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

const preSeedCounter = async (instituteId, limitKey, used) => {
  await UsageCounter.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    instituteId,
    limitKey,
    period: "lifetime",
    used,
    version: 0,
    lastReconciledAt: null,
    actualUsageAtLastReconcile: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

const getCounter = async (instituteId, limitKey) => {
  return UsageCounter.findOne({
    instituteId,
    limitKey,
    period: "lifetime",
  }).lean();
};

const updateSubscriptionLimit = async (subId, limitKey, newValue) => {
  const sub = await Subscription.findById(subId);
  const updatedLimits = sub.limits.map((l) =>
    l.key === limitKey ? { key: l.key, value: newValue } : l
  );
  await Subscription.collection.updateOne(
    { _id: subId },
    { $set: { limits: updatedLimits } }
  );
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
    // Test 1 — Upgrade: limit 2 → 10
    // =====================================================

    await test(
      "T1: Upgrade (limit 2→10) — counter preserved, 8 more creates allowed",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const { subId } = await makeSubscriptionWithMaxClasses(
          instituteId,
          ownerId,
          2
        );
        const token = makeToken(ownerId);

        // Create 2 classes → at limit
        await createClass(instituteId, ownerId, "Class A");
        await createClass(instituteId, ownerId, "Class B");
        await preSeedCounter(instituteId, "MAX_CLASSES", 2);

        // Verify at limit — create blocked
        const blocked = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Should Fail" },
        });
        assert(blocked.status === 403, "Expected 403 at limit");
        assert(blocked.data.code === "LIMIT_REACHED", "Expected LIMIT_REACHED");

        // Upgrade: limit 2 → 10
        await updateSubscriptionLimit(subId, "MAX_CLASSES", 10);

        // Now create 2 more — should succeed
        const create1 = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Class C" },
        });
        assert(create1.status === 201, `Expected 201, got ${create1.status}`);
        createdClassIds.push(new mongoose.Types.ObjectId(create1.data.data.class.id));

        const create2 = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Class D" },
        });
        assert(create2.status === 201, `Expected 201, got ${create2.status}`);
        createdClassIds.push(new mongoose.Types.ObjectId(create2.data.data.class.id));

        // Counter should be 4
        const counter = await getCounter(instituteId, "MAX_CLASSES");
        assert(counter.used === 4, `counter used ${counter.used}, expected 4`);

        const dbCount = await Class.countDocuments({ instituteId, isDeleted: false });
        assert(dbCount === 4, `DB count ${dbCount}, expected 4`);
      }
    );

    // =====================================================
    // Test 2 — Downgrade: limit 10 → 2 with current=5
    // =====================================================

    await test(
      "T2: Downgrade (limit 10→2, current=5) — new creates blocked",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const { subId } = await makeSubscriptionWithMaxClasses(
          instituteId,
          ownerId,
          10
        );
        const token = makeToken(ownerId);

        // Create 5 classes → under limit
        for (let i = 1; i <= 5; i++) {
          await createClass(instituteId, ownerId, `Class ${i}`);
        }
        await preSeedCounter(instituteId, "MAX_CLASSES", 5);

        // Downgrade: limit 10 → 2
        await updateSubscriptionLimit(subId, "MAX_CLASSES", 2);

        // Try create — should be blocked (current 5 > limit 2)
        const res = await request("/api/owner/classes", {
          method: "POST",
          token,
          body: { name: "Should Fail After Downgrade" },
        });
        assert(res.status === 403, `Expected 403, got ${res.status}`);
        assert(res.data.code === "LIMIT_REACHED", `Expected LIMIT_REACHED, got ${res.data.code}`);

        // Counter still 5
        const counter = await getCounter(instituteId, "MAX_CLASSES");
        assert(counter.used === 5, `counter used ${counter.used}, expected 5`);

        // DB still has 5 classes (untouched)
        const dbCount = await Class.countDocuments({ instituteId, isDeleted: false });
        assert(dbCount === 5, `DB count ${dbCount}, expected 5`);
      }
    );

    // =====================================================
    // Test 3 — getAllLimitStatuses shows remaining=0 after downgrade
    // =====================================================

    await test(
      "T3: Dashboard shows remaining=0 when current > limit after downgrade",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const { subId } = await makeSubscriptionWithMaxClasses(
          instituteId,
          ownerId,
          10
        );
        const token = makeToken(ownerId);

        // Create 5 classes, counter=5
        for (let i = 1; i <= 5; i++) {
          await createClass(instituteId, ownerId, `Class ${i}`);
        }
        await preSeedCounter(instituteId, "MAX_CLASSES", 5);

        // Downgrade to 2
        await updateSubscriptionLimit(subId, "MAX_CLASSES", 2);

        // Get usage
        const res = await request("/api/owner/subscription-usage", { token });
        assert(res.status === 200, `Expected 200, got ${res.status}`);

        const classLimit = res.data.data.limits.find(
          (l) => l.limitKey === "MAX_CLASSES"
        );
        assert(classLimit, "MAX_CLASSES not in response");
        assert(classLimit.limit === 2, `limit ${classLimit.limit}, expected 2`);
        assert(classLimit.current === 5, `current ${classLimit.current}, expected 5`);
        assert(
          classLimit.remaining === 0,
          `remaining ${classLimit.remaining}, expected 0 (max(0, 2-5))`
        );
      }
    );

    // =====================================================
    // Test 4 — Existing data unchanged after downgrade
    // =====================================================

    await test(
      "T4: Existing classes untouched after downgrade",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const { subId } = await makeSubscriptionWithMaxClasses(
          instituteId,
          ownerId,
          10
        );

        const createdIds = [];
        for (let i = 1; i <= 3; i++) {
          const id = await createClass(instituteId, ownerId, `Class ${i}`);
          createdIds.push(id);
        }
        await preSeedCounter(instituteId, "MAX_CLASSES", 3);

        // Downgrade to 1
        await updateSubscriptionLimit(subId, "MAX_CLASSES", 1);

        // Verify each existing class is still present, active, not deleted
        for (const id of createdIds) {
          const cls = await Class.findById(id).lean();
          assert(cls !== null, `Class ${id} missing`);
          assert(cls.isActive === true, `Class ${id} isActive changed`);
          assert(cls.isDeleted === false, `Class ${id} isDeleted changed`);
        }
      }
    );

    // =====================================================
    // Test 5 — Subscription identity unchanged
    // =====================================================

    await test(
      "T5: Subscription _id, snapshotCapturedAt, planVersionId unchanged after limit update",
      async () => {
        const instituteId = await makeInstitute();
        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);
        const { subId, versionId } = await makeSubscriptionWithMaxClasses(
          instituteId,
          ownerId,
          10
        );

        const before = await Subscription.findById(subId).lean();

        await updateSubscriptionLimit(subId, "MAX_CLASSES", 5);

        const after = await Subscription.findById(subId).lean();

        assert(
          String(after._id) === String(before._id),
          "subscription _id changed"
        );
        assert(
          String(after.planVersionId) === String(versionId),
          "planVersionId changed"
        );
        assert(
          String(after.snapshotCapturedAt) === String(before.snapshotCapturedAt),
          "snapshotCapturedAt changed"
        );
        assert(after.amount === before.amount, "amount changed");
        assert(after.currency === before.currency, "currency changed");
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

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