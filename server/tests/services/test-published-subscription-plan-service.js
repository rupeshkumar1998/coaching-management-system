
const assert = require("assert");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const {
  getPublishedSubscriptionPlan,
} = require("../../services/publishedSubscriptionPlanService");

const originalPlanFindOne = SubscriptionPlan.findOne;
const originalVersionFindOne = SubscriptionPlanVersion.findOne;

const planId = "507f1f77bcf86cd799439011";
const versionId = "507f1f77bcf86cd799439012";

const makePlan = (overrides = {}) => ({
  _id: planId,
  code: "BASIC",
  isActive: true,
  currentPublishedVersion: versionId,
  ...overrides,
});

const makeVersion = (overrides = {}) => ({
  _id: versionId,
  planId,
  status: "PUBLISHED",
  version: 2,
  amount: 1200,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: [],
  limits: [],
  ...overrides,
});

async function expectError(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error.code, expectedCode);
    return true;
  });
}

async function run() {
  let planResult;
  let versionResult;
  let versionQuery;

  SubscriptionPlan.findOne = (query) => {
    assert.deepStrictEqual(query, { code: "BASIC" });
    return { lean: async () => planResult };
  };


  SubscriptionPlanVersion.findOne = (query) => {
    versionQuery = query;

    return {
      lean: async () => {
        if (!versionResult) {
          return null;
        }

        const sameId =
          String(versionResult._id) === String(query._id);

        const samePlan =
          String(versionResult.planId) === String(query.planId);

        const sameStatus =
          versionResult.status === query.status;

        return sameId && samePlan && sameStatus
          ? versionResult
          : null;
      },
    };
  };


  try {
    planResult = makePlan();
    versionResult = makeVersion();

    const result = await getPublishedSubscriptionPlan(" basic ");

    assert.strictEqual(result.plan, planResult);
    assert.strictEqual(result.version, versionResult);
    assert.deepStrictEqual(versionQuery, {
      _id: versionId,
      planId,
      status: "PUBLISHED",
    });
    console.log("PASS: Active plan returns its published version");

    await expectError(
      getPublishedSubscriptionPlan(" "),
      "INVALID_PLAN_CODE"
    );
    console.log("PASS: Empty plan code is rejected");

    planResult = null;
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PLAN_NOT_FOUND"
    );
    console.log("PASS: Unknown plan is rejected");

    planResult = makePlan({ isActive: false });
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PLAN_INACTIVE"
    );
    console.log("PASS: Inactive plan is rejected");

    planResult = makePlan({ currentPublishedVersion: null });
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PUBLISHED_VERSION_NOT_FOUND"
    );
    console.log("PASS: Plan without published version is rejected");

    planResult = makePlan();
    versionResult = null;
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PUBLISHED_VERSION_INCONSISTENT"
    );
    console.log("PASS: Missing referenced version is rejected");

    versionResult = makeVersion({ planId: "507f191e810c19729de860ea" });
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PUBLISHED_VERSION_INCONSISTENT"
    );
    console.log("PASS: Version belonging to another plan is rejected");

    versionResult = makeVersion({ status: "DRAFT" });
    await expectError(
      getPublishedSubscriptionPlan("BASIC"),
      "PUBLISHED_VERSION_INCONSISTENT"
    );
    console.log("PASS: Unpublished version is rejected");

    console.log("\nAll published subscription plan service tests passed.");
  } finally {
    SubscriptionPlan.findOne = originalPlanFindOne;
    SubscriptionPlanVersion.findOne = originalVersionFindOne;
  }
}

run().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
