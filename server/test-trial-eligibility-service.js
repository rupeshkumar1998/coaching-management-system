
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Institute = require("./models/Institute");
const Subscription = require("./models/Subscription");
const TrialEligibilityClaim = require("./models/TrialEligibilityClaim");
const PlatformTrialOffer = require("./models/PlatformTrialOffer");
const SubscriptionPlan = require("./models/SubscriptionPlan");
const SubscriptionPlanVersion = require("./models/SubscriptionPlanVersion");

const {
  checkTrialEligibility,
} = require("./services/trialEligibilityService");

const id = () => new mongoose.Types.ObjectId();

const makeQuery = (value) => ({
  select() {
    return this;
  },
  session() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const originalMethods = {
  instituteFindById: Institute.findById,
  claimFindOne: TrialEligibilityClaim.findOne,
  subscriptionFindOne: Subscription.findOne,
  offerFindOne: PlatformTrialOffer.findOne,
  planFindById: SubscriptionPlan.findById,
  versionFindOne: SubscriptionPlanVersion.findOne,
};

function restoreMethods() {
  Institute.findById = originalMethods.instituteFindById;
  TrialEligibilityClaim.findOne = originalMethods.claimFindOne;
  Subscription.findOne = originalMethods.subscriptionFindOne;
  PlatformTrialOffer.findOne = originalMethods.offerFindOne;
  SubscriptionPlan.findById = originalMethods.planFindById;
  SubscriptionPlanVersion.findOne = originalMethods.versionFindOne;
}

function setupMocks(overrides = {}) {
  const instituteId = overrides.instituteId || id();
  const planId = id();
  const planVersionId = id();

  const defaults = {
    institute: { _id: instituteId },
    claim: null,
    activeSubscription: null,
    pendingSubscription: null,
    historicalSubscription: null,
    offer: {
      _id: id(),
      version: 1,
      status: "PUBLISHED",
      enabled: true,
      planId,
      planVersionId,
      durationDays: 14,
      eligibility: "NEW_INSTITUTES_ONLY",
    },
    plan: {
      _id: planId,
      code: "FREE",
      isActive: true,
      currentPublishedVersion: planVersionId,
    },
    planVersion: {
      _id: planVersionId,
      planId,
      version: 1,
      status: "PUBLISHED",
      amount: 0,
      currency: "INR",
      paymentRequired: false,
      features: [],
      limits: [],
    },
  };

  const data = { ...defaults, ...overrides };

  Institute.findById = () => makeQuery(data.institute);
  TrialEligibilityClaim.findOne = () => makeQuery(data.claim);

  Subscription.findOne = (filter) => {
    if (filter.status === "ACTIVE") {
      return makeQuery(data.activeSubscription);
    }

    if (filter.status === "PENDING") {
      return makeQuery(data.pendingSubscription);
    }

    return makeQuery(data.historicalSubscription);
  };

  PlatformTrialOffer.findOne = () => makeQuery(data.offer);
  SubscriptionPlan.findById = () => makeQuery(data.plan);
  SubscriptionPlanVersion.findOne = () => makeQuery(data.planVersion);

  return { instituteId, data };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  restoreMethods();

  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  } finally {
    restoreMethods();
  }
}

async function expectEligibilityError(expectedCode) {
  await assert.rejects(
    checkTrialEligibility({ instituteId: id() }),
    (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    }
  );
}

async function main() {
  await test("Invalid Institute ID is rejected", async () => {
    await assert.rejects(
      checkTrialEligibility({ instituteId: "invalid-id" }),
      (error) => error.code === "INVALID_INSTITUTE_ID"
    );
  });

  await test("Missing Institute is rejected", async () => {
    setupMocks({ institute: null });
    await expectEligibilityError("INSTITUTE_NOT_FOUND");
  });

  await test("Existing lifetime claim blocks another trial", async () => {
    setupMocks({ claim: { _id: id() } });
    await expectEligibilityError("TRIAL_ALREADY_USED");
  });

  await test("Active subscription blocks a trial", async () => {
    setupMocks({
      activeSubscription: { _id: id() },
    });
    await expectEligibilityError("ACTIVE_SUBSCRIPTION_EXISTS");
  });

  await test("Pending subscription blocks a trial", async () => {
    setupMocks({
      pendingSubscription: { _id: id() },
    });
    await expectEligibilityError("PENDING_SUBSCRIPTION_EXISTS");
  });

  await test("Historical subscription blocks a trial", async () => {
    setupMocks({
      historicalSubscription: { _id: id() },
    });
    await expectEligibilityError("SUBSCRIPTION_HISTORY_EXISTS");
  });

  await test("Missing published offer blocks a trial", async () => {
    setupMocks({ offer: null });
    await expectEligibilityError("TRIAL_OFFER_UNAVAILABLE");
  });

  await test("Disabled published offer blocks a trial", async () => {
    setupMocks({
      offer: {
        _id: id(),
        version: 1,
        status: "PUBLISHED",
        enabled: false,
        planId: id(),
        planVersionId: id(),
        durationDays: 14,
        eligibility: "NEW_INSTITUTES_ONLY",
      },
    });
    await expectEligibilityError("TRIAL_OFFER_UNAVAILABLE");
  });

  await test("Invalid offer configuration is rejected", async () => {
    const { data } = setupMocks({});
    data.offer.durationDays = 0;
    await expectEligibilityError("TRIAL_CONFIGURATION_INVALID");
  });

  await test("Inactive trial plan is rejected", async () => {
    const { data } = setupMocks({});
    data.plan.isActive = false;
    await expectEligibilityError("TRIAL_PLAN_UNAVAILABLE");
  });

  await test("Outdated published plan version is rejected", async () => {
    const { data } = setupMocks({});
    data.plan.currentPublishedVersion = id();
    await expectEligibilityError("TRIAL_PLAN_UNAVAILABLE");
  });

  await test("Unpublished plan version is rejected", async () => {
    const { data } = setupMocks({});
    data.planVersion = null;
    await expectEligibilityError("TRIAL_PLAN_UNAVAILABLE");
  });

  await test("Paid trial plan configuration is rejected", async () => {
    const { data } = setupMocks({});
    data.planVersion.paymentRequired = true;
    data.planVersion.amount = 100;
    await expectEligibilityError("TRIAL_CONFIGURATION_INVALID");
  });

  await test("Eligible Institute receives verified offer and plan snapshots", async () => {
    const { instituteId, data } = setupMocks({});

    const result = await checkTrialEligibility({ instituteId });

    assert.equal(result.eligible, true);
    assert.equal(String(result.instituteId), String(instituteId));
    assert.equal(String(result.offer.offerId), String(data.offer._id));
    assert.equal(result.offer.version, 1);
    assert.equal(result.offer.durationDays, 14);
    assert.equal(
      String(result.offer.planVersionId),
      String(data.planVersion._id)
    );
    assert.equal(result.plan.code, "FREE");
    assert.equal(result.planVersion.version, 1);
    assert.equal(result.planVersion.amount, 0);
    assert.equal(result.planVersion.paymentRequired, false);
  });

  console.log("\n--------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("--------------------------------");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  restoreMethods();
  console.error("Unexpected test runner error:", error);
  process.exitCode = 1;
});
