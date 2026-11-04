const assert = require("assert");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const controller = require("../../controllers/instituteSubscriptionPlanController");

const { getAvailablePlans, getPlanDetails } = controller;

// ------------------------------------------
// Save originals for restore in finally
// ------------------------------------------
const originalPlanFind = SubscriptionPlan.find;
const originalPlanFindOne = SubscriptionPlan.findOne;
const originalVersionFind = SubscriptionPlanVersion.find;
const originalVersionFindOne = SubscriptionPlanVersion.findOne;

// ------------------------------------------
// Test fixtures
// ------------------------------------------
const planAId = "507f1f77bcf86cd799439011";
const planBId = "507f1f77bcf86cd799439021";
const versionAId = "507f1f77bcf86cd799439012";
const versionBId = "507f1f77bcf86cd799439022";

const makePlan = (overrides = {}) => ({
  _id: planAId,
  code: "BASIC",
  name: "Basic Plan",
  description: "Basic features",
  isActive: true,
  currentPublishedVersion: versionAId,
  createdBy: "user-created",
  updatedBy: "user-updated",
  ...overrides,
});

const makeVersion = (overrides = {}) => ({
  _id: versionAId,
  planId: planAId,
  status: "PUBLISHED",
  version: 2,
  amount: 1200,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: [{ key: "ANALYTICS", enabled: true }],
  limits: [{ key: "MAX_STUDENTS", value: 1000 }],
  publishedAt: new Date("2026-01-01"),
  publishedBy: "user-publisher",
  retiredAt: null,
  retiredBy: null,
  createdBy: "user-created",
  updatedBy: "user-updated",
  ...overrides,
});

// ------------------------------------------
// Mock helpers
// ------------------------------------------
const makeRes = () => {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
};

const makeFindQuery = (result) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => result,
});

const makeFindOneQuery = (result) => ({
  lean: async () => result,
});

// ------------------------------------------
// Runner
// ------------------------------------------
async function run() {
  let plansResult = [];
  let versionsResult = [];
  let planFindOneResult = null;
  let versionFindOneResult = null;

  // -----------------------------
  // Structural test:
  // Controller must expose only read-only functions.
  // -----------------------------
  const exportedKeys = Object.keys(controller).sort();
  assert.deepStrictEqual(
    exportedKeys,
    ["getAvailablePlans", "getPlanDetails"].sort(),
    "Controller must export only read-only functions"
  );
  console.log("PASS: Controller exposes only read-only functions");

  // Setup mocks
  SubscriptionPlan.find = () => makeFindQuery(plansResult);
  SubscriptionPlan.findOne = () => makeFindOneQuery(planFindOneResult);
  SubscriptionPlanVersion.find = () => makeFindQuery(versionsResult);
  SubscriptionPlanVersion.findOne = () => makeFindOneQuery(versionFindOneResult);

  try {
    // ========================================
    // getAvailablePlans tests
    // ========================================

    // 1. Missing tenant context
    {
      const req = {};
      const res = makeRes();
      await getAvailablePlans(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      console.log("PASS: getAvailablePlans rejects missing tenant context");
    }

    // 2. No plans in DB
    plansResult = [];
    versionsResult = [];
    {
      const req = { tenantId: "tenant-1" };
      const res = makeRes();
      await getAvailablePlans(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.count, 0);
      assert.deepStrictEqual(res.body.data.plans, []);
      console.log("PASS: getAvailablePlans returns empty list");
    }

    // 3. Success with one valid plan + one plan missing version
    plansResult = [
      makePlan(),
      makePlan({
        _id: planBId,
        code: "PRO",
        name: "Pro Plan",
        currentPublishedVersion: versionBId,
      }),
    ];
    // Only PLAN A's version is present. PLAN B's version is missing.
    versionsResult = [makeVersion()];
    {
      const req = { tenantId: "tenant-1" };
      const res = makeRes();
      await getAvailablePlans(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.count, 1);
      assert.strictEqual(res.body.data.plans.length, 1);

      const entry = res.body.data.plans[0];

      // Plan fields present, audit fields absent
      assert.strictEqual(entry.plan.code, "BASIC");
      assert.strictEqual(entry.plan.name, "Basic Plan");
      assert.strictEqual(entry.plan.isActive, true);
      assert.strictEqual(entry.plan._id, undefined);
      assert.strictEqual(entry.plan.createdBy, undefined);
      assert.strictEqual(entry.plan.updatedBy, undefined);
      assert.strictEqual(entry.plan.currentPublishedVersion, undefined);

      // Version fields present, audit fields absent
      assert.strictEqual(entry.version.version, 2);
      assert.strictEqual(entry.version.amount, 1200);
      assert.strictEqual(entry.version.currency, "INR");
      assert.strictEqual(entry.version._id, undefined);
      assert.strictEqual(entry.version.publishedBy, undefined);
      assert.strictEqual(entry.version.retiredBy, undefined);
      assert.strictEqual(entry.version.createdBy, undefined);
      assert.strictEqual(entry.version.updatedBy, undefined);

      console.log("PASS: getAvailablePlans sanitizes and filters correctly");
    }

    // 4. DB error → 500
    SubscriptionPlan.find = () => {
      throw new Error("DB error");
    };
    {
      const req = { tenantId: "tenant-1" };
      const res = makeRes();
      await getAvailablePlans(req, res);
      assert.strictEqual(res.statusCode, 500);
      assert.strictEqual(res.body.success, false);
      console.log("PASS: getAvailablePlans handles DB error");
    }

    // Restore find mock
    SubscriptionPlan.find = () => makeFindQuery(plansResult);

    // ========================================
    // getPlanDetails tests
    // ========================================

    // 1. Missing tenant context
    {
      const req = { params: { planCode: "BASIC" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 403);
      console.log("PASS: getPlanDetails rejects missing tenant context");
    }

    // 2. Invalid planCode (whitespace only)
    {
      const req = { tenantId: "tenant-1", params: { planCode: "   " } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 400);
      console.log("PASS: getPlanDetails rejects invalid plan code");
    }

    // 3. Plan not found (service 404)
    planFindOneResult = null;
    versionFindOneResult = null;
    {
      const req = { tenantId: "tenant-1", params: { planCode: "UNKNOWN" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 404);
      console.log("PASS: getPlanDetails returns 404 for unknown plan");
    }

    // 4. Plan inactive (service 409)
    planFindOneResult = makePlan({ isActive: false });
    versionFindOneResult = null;
    {
      const req = { tenantId: "tenant-1", params: { planCode: "BASIC" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 409);
      console.log("PASS: getPlanDetails returns 409 for inactive plan");
    }

    // 5. Plan has no published version (service 409)
    planFindOneResult = makePlan({ currentPublishedVersion: null });
    {
      const req = { tenantId: "tenant-1", params: { planCode: "BASIC" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 409);
      console.log("PASS: getPlanDetails returns 409 when no published version");
    }

    // 6. Version reference is inconsistent (DRAFT / wrong plan / missing)
    planFindOneResult = makePlan();
    versionFindOneResult = null; // triggers PUBLISHED_VERSION_INCONSISTENT
    {
      const req = { tenantId: "tenant-1", params: { planCode: "BASIC" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 409);
      console.log("PASS: getPlanDetails returns 409 on inconsistent version");
    }

    // 7. Success — sanitized payload, no audit fields
    planFindOneResult = makePlan();
    versionFindOneResult = makeVersion();
    {
      const req = { tenantId: "tenant-1", params: { planCode: "basic" } };
      const res = makeRes();
      await getPlanDetails(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.plan.code, "BASIC");
      assert.strictEqual(res.body.data.plan.createdBy, undefined);
      assert.strictEqual(res.body.data.version.version, 2);
      assert.strictEqual(res.body.data.version.publishedBy, undefined);
      assert.strictEqual(res.body.data.version.retiredAt, undefined);
      console.log("PASS: getPlanDetails returns sanitized published version");
    }

    console.log("\nAll institute subscription plan controller tests passed.");
  } finally {
    // Restore all mocks
    SubscriptionPlan.find = originalPlanFind;
    SubscriptionPlan.findOne = originalPlanFindOne;
    SubscriptionPlanVersion.find = originalVersionFind;
    SubscriptionPlanVersion.findOne = originalVersionFindOne;
  }
}

run().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});