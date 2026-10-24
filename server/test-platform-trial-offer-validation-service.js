
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const SubscriptionPlan = require("./models/SubscriptionPlan");
const SubscriptionPlanVersion = require(
  "./models/SubscriptionPlanVersion"
);

const {
  validateDraftTrialOfferConfiguration,
} = require("./services/platformTrialOfferValidationService");

const planId = new mongoose.Types.ObjectId();
const planVersionId = new mongoose.Types.ObjectId();
const otherPlanId = new mongoose.Types.ObjectId();
const actorId = new mongoose.Types.ObjectId();

const validInput = () => ({
  planId: String(planId),
  planVersionId: String(planVersionId),
  durationDays: 14,
  eligibility: "NEW_INSTITUTES_ONLY",
  enabled: false,
});

const validPlan = (overrides = {}) => ({
  _id: planId,
  isActive: true,
  currentPublishedVersion: planVersionId,
  ...overrides,
});

const validPlanVersion = (overrides = {}) => ({
  _id: planVersionId,
  planId,
  status: "PUBLISHED",
  ...overrides,
});

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
};

const withMocks = async (
  { plan = validPlan(), version = validPlanVersion() } = {},
  fn
) => {
  const originalFindById = SubscriptionPlan.findById;
  const originalFindOne = SubscriptionPlanVersion.findOne;

  SubscriptionPlan.findById = () => ({
    lean: async () => plan,
  });

  SubscriptionPlanVersion.findOne = (query) => {
    assert.equal(String(query._id), String(planVersionId));
    assert.equal(String(query.planId), String(planId));
    assert.equal(query.status, "PUBLISHED");

    return {
      lean: async () => version,
    };
  };

  try {
    await fn();
  } finally {
    SubscriptionPlan.findById = originalFindById;
    SubscriptionPlanVersion.findOne = originalFindOne;
  }
};

const expectCode = async (input, expectedCode) => {
  await assert.rejects(
    () => validateDraftTrialOfferConfiguration(input),
    (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    }
  );
};

(async () => {
  await runTest("Valid draft configuration is accepted", async () => {
    await withMocks({}, async () => {
      const result = await validateDraftTrialOfferConfiguration(
        validInput()
      );

      assert.equal(String(result.configuration.planId), String(planId));
      assert.equal(
        String(result.configuration.planVersionId),
        String(planVersionId)
      );
      assert.equal(result.configuration.durationDays, 14);
      assert.equal(
        result.configuration.eligibility,
        "NEW_INSTITUTES_ONLY"
      );
      assert.equal(result.configuration.enabled, false);
    });
  });

  await runTest("Invalid plan ID is rejected", async () => {
    await expectCode(
      { ...validInput(), planId: "invalid-id" },
      "INVALID_TRIAL_PLAN_ID"
    );
  });

  await runTest("Invalid plan version ID is rejected", async () => {
    await expectCode(
      { ...validInput(), planVersionId: "invalid-id" },
      "INVALID_TRIAL_PLAN_VERSION_ID"
    );
  });

  await runTest("Zero duration is rejected", async () => {
    await expectCode(
      { ...validInput(), durationDays: 0 },
      "INVALID_TRIAL_DURATION"
    );
  });

  await runTest("Fractional duration is rejected", async () => {
    await expectCode(
      { ...validInput(), durationDays: 1.5 },
      "INVALID_TRIAL_DURATION"
    );
  });

  await runTest("Unsafe integer duration is rejected", async () => {
    await expectCode(
      {
        ...validInput(),
        durationDays: Number.MAX_SAFE_INTEGER + 1,
      },
      "INVALID_TRIAL_DURATION"
    );
  });

  await runTest("Unsupported eligibility is rejected", async () => {
    await expectCode(
      { ...validInput(), eligibility: "ALL_INSTITUTES" },
      "INVALID_TRIAL_ELIGIBILITY"
    );
  });

  await runTest("Enabled draft is rejected", async () => {
    await expectCode(
      { ...validInput(), enabled: true },
      "TRIAL_DRAFT_MUST_BE_DISABLED"
    );
  });

  await runTest("Missing plan is rejected", async () => {
    await withMocks({ plan: null }, async () => {
      await expectCode(validInput(), "TRIAL_PLAN_NOT_FOUND");
    });
  });

  await runTest("Inactive plan is rejected", async () => {
    await withMocks(
      { plan: validPlan({ isActive: false }) },
      async () => {
        await expectCode(validInput(), "TRIAL_PLAN_INACTIVE");
      }
    );
  });

  await runTest("Plan without current published version is rejected", async () => {
    await withMocks(
      { plan: validPlan({ currentPublishedVersion: null }) },
      async () => {
        await expectCode(
          validInput(),
          "OUTDATED_PLAN_VERSION"
        );
      }
    );
  });

  await runTest("Non-current plan version is rejected", async () => {
    const differentVersionId = new mongoose.Types.ObjectId();

    await withMocks(
      {
        plan: validPlan({
          currentPublishedVersion: differentVersionId,
        }),
      },
      async () => {
        await expectCode(
          validInput(),
          "OUTDATED_PLAN_VERSION"
        );
      }
    );
  });

  await runTest("Version belonging to another plan is rejected", async () => {
    await withMocks(
      {
        version: validPlanVersion({ planId: otherPlanId }),
      },
      async () => {
        await expectCode(
          validInput(),
          "TRIAL_PLAN_VERSION_INVALID"
        );
      }
    );
  });

  await runTest("Missing or unpublished version is rejected", async () => {
    await withMocks({ version: null }, async () => {
      await expectCode(
        validInput(),
        "TRIAL_PLAN_VERSION_INVALID"
      );
    });
  });

  console.log(
    "\nPlatform trial offer validation service tests completed."
  );
})().catch((error) => {
  console.error("Unexpected test runner error:", error);
  process.exitCode = 1;
});
