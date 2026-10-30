require("dotenv").config();

const mongoose = require("mongoose");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createDraftPlanVersion,
  updateDraftPlanVersion,
  publishPlanVersion,
  retirePublishedPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const createdPlanIds = [];
const createdVersionIds = [];

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectReject = async (operation, expectedMessage) => {
  let rejected = false;

  try {
    await operation();
  } catch (error) {
    rejected = true;

    if (
      expectedMessage &&
      !error.message.includes(expectedMessage)
    ) {
      throw new Error(
        `Expected error containing "${expectedMessage}", received "${error.message}"`
      );
    }
  }

  assert(rejected, "Expected operation to reject, but it succeeded");
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

const makeConfiguration = (overrides = {}) => ({
  amount: 999,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: getMandatoryFeatureKeys().map((key) => ({
    key,
    enabled: true,
  })),
  limits: [],
  ...overrides,
});

const createPlan = async () => {
  const actorId = new mongoose.Types.ObjectId();

  const plan = await SubscriptionPlan.create({
    code: `TST_${new mongoose.Types.ObjectId().toString()}`,
    name: "Service Test Plan",
    description: "Automated service test",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });

  createdPlanIds.push(plan._id);

  return { plan, actorId };
};

const createDraft = async (planId, actorId, configuration) => {
  const draft = await createDraftPlanVersion({
    planId,
    actorId,
    configuration,
  });

  createdVersionIds.push(draft._id);

  return draft;
};

const run = async () => {
await connectTestDB();
  try {
    // 1. Create first draft
    await test("Create first draft with version number 1", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      assert(draft.version === 1, "First version should be 1");
      assert(draft.status === "DRAFT", "New version should be DRAFT");
      assert(
        draft.planId.toString() === plan._id.toString(),
        "Draft should belong to the requested plan"
      );
    });

    // 2. Sequential version number
    await test("Create next draft with sequential version number", async () => {
      const { plan, actorId } = await createPlan();

      const first = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      const second = await createDraft(
        plan._id,
        actorId,
        makeConfiguration({ amount: 1499 })
      );

      assert(first.version === 1, "First version should be 1");
      assert(second.version === 2, "Second version should be 2");
    });



    // Concurrent draft creation regression test
    await test("Concurrent draft creation never stores duplicate version numbers", async () => {
      const { plan, actorId } = await createPlan();

      const results = await Promise.allSettled([
        createDraft(
          plan._id,
          actorId,
          makeConfiguration({ amount: 1100 })
        ),
        createDraft(
          plan._id,
          actorId,
          makeConfiguration({ amount: 1200 })
        ),
      ]);

      const storedVersions = await SubscriptionPlanVersion.find({
        planId: plan._id,
      })
        .sort({ version: 1 })
        .lean();

      const versionNumbers = storedVersions.map((item) => item.version);
      const uniqueVersionNumbers = new Set(versionNumbers);

      assert(
        uniqueVersionNumbers.size === versionNumbers.length,
        "Duplicate version numbers must never be stored"
      );

      assert(
        storedVersions.length >= 1 && storedVersions.length <= 2,
        "One or two valid drafts may exist after concurrent creation"
      );


      console.log(
  "  Concurrent request outcomes:",
  results.map((result) =>
    result.status === "fulfilled"
      ? "SUCCESS"
      : `FAILED: ${result.reason.message}`
  )
);


      assert(
        results.some((result) => result.status === "fulfilled"),
        "At least one concurrent draft request should succeed"
      );
    });






    // 3. Invalid plan ID
    await test("Reject invalid plan ID", async () => {
      await expectReject(
        () =>
          createDraft(
            "invalid-id",
            new mongoose.Types.ObjectId(),
            makeConfiguration()
          ),
        "Valid planId is required"
      );
    });

    // 4. Nonexistent plan
    await test("Reject nonexistent plan", async () => {
      await expectReject(
        () =>
          createDraft(
            new mongoose.Types.ObjectId(),
            new mongoose.Types.ObjectId(),
            makeConfiguration()
          ),
        "Subscription plan not found"
      );
    });

    // 5. Invalid configuration type
    await test("Reject non-object configuration", async () => {
      const { plan, actorId } = await createPlan();

      await expectReject(
        () =>
          createDraft(
            plan._id,
            actorId,
            null
          ),
        "Configuration must be an object"
      );
    });

    // 6. Unsupported field
    await test("Reject unsupported configuration field", async () => {
      const { plan, actorId } = await createPlan();

      await expectReject(
        () =>
          createDraft(
            plan._id,
            actorId,
            makeConfiguration({ admin: true })
          ),
        "Unsupported configuration fields"
      );
    });

    // 7. Update draft configuration
    await test("Update draft amount and audit actor", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      const newActorId = new mongoose.Types.ObjectId();

      const updated = await updateDraftPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId: newActorId,
        configuration: { amount: 1999 },
      });

      assert(updated.amount === 1999, "Amount should be updated");
      assert(
        updated.updatedBy.toString() === newActorId.toString(),
        "updatedBy should be updated"
      );

      const stored = await SubscriptionPlanVersion.findById(draft._id);

      assert(stored.amount === 1999, "Updated amount should persist");
    });

    // 8. Wrong plan for a version
    await test("Reject update when version belongs to another plan", async () => {
      const first = await createPlan();
      const second = await createPlan();

      const draft = await createDraft(
        first.plan._id,
        first.actorId,
        makeConfiguration()
      );

      await expectReject(
        () =>
          updateDraftPlanVersion({
            planId: second.plan._id,
            versionId: draft._id,
            actorId: second.actorId,
            configuration: { amount: 1200 },
          }),
        "Plan version not found"
      );
    });

    // 9. Nonexistent version
    await test("Reject update for nonexistent version", async () => {
      const { plan, actorId } = await createPlan();

      await expectReject(
        () =>
          updateDraftPlanVersion({
            planId: plan._id,
            versionId: new mongoose.Types.ObjectId(),
            actorId,
            configuration: { amount: 1200 },
          }),
        "Plan version not found"
      );
    });

    // 10. Reject editing published version
    await test("Reject editing a published version", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      await publishPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
      });

      await expectReject(
        () =>
          updateDraftPlanVersion({
            planId: plan._id,
            versionId: draft._id,
            actorId,
            configuration: { amount: 2500 },
          }),
        "Only DRAFT versions can be edited"
      );
    });

    // 11. Publish a draft and verify pointer
    await test("Publish draft and update current version pointer", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      const published = await publishPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
      });

      assert(published.status === "PUBLISHED", "Version should be published");

      const storedPlan = await SubscriptionPlan.findById(plan._id);

      assert(
        storedPlan.currentPublishedVersion.toString() ===
          published._id.toString(),
        "Plan pointer should reference the published version"
      );
    });

    // 12. Retire current published version
    await test("Retire current published version and clear pointer", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      await publishPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
      });

      const retired = await retirePublishedPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
      });

      assert(retired.status === "RETIRED", "Version should be retired");
      assert(retired.retiredAt, "retiredAt should be populated");
      assert(retired.retiredBy, "retiredBy should be populated");

      const storedPlan = await SubscriptionPlan.findById(plan._id);

      assert(
        storedPlan.currentPublishedVersion === null,
        "Plan pointer should be cleared"
      );
    });



    // 13. Reject draft creation with a missing mandatory feature
    await test("Reject draft creation with missing mandatory feature", async () => {
      const { plan, actorId } = await createPlan();

      const features = getMandatoryFeatureKeys()
        .filter((key) => key !== "AUTHENTICATION")
        .map((key) => ({ key, enabled: true }));

      await expectReject(() =>
        createDraft(
          plan._id,
          actorId,
          makeConfiguration({ features })
        )
      );

      const count = await SubscriptionPlanVersion.countDocuments({
        planId: plan._id,
      });

      assert(count === 0, "Invalid draft must not be persisted");
    });

    // 14. Reject update that disables a feature required by a limit
    await test("Reject update that disables a required feature", async () => {
      const { plan, actorId } = await createPlan();

      const features = [
        ...getMandatoryFeatureKeys().map((key) => ({
          key,
          enabled: true,
        })),
        { key: "STUDENT_MANAGEMENT", enabled: true },
      ];

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration({
          features,
          limits: [{ key: "MAX_STUDENTS", value: 100 }],
        })
      );

      const invalidFeatures = features.map((item) =>
        item.key === "STUDENT_MANAGEMENT"
          ? { ...item, enabled: false }
          : item
      );

      await expectReject(() =>
        updateDraftPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
          configuration: { features: invalidFeatures },
        })
      );

      const stored = await SubscriptionPlanVersion.findById(draft._id);

      assert(stored.status === "DRAFT", "Draft status must remain unchanged");
      assert(
        stored.features.find(
          (item) => item.key === "STUDENT_MANAGEMENT"
        ).enabled === true,
        "Failed update must not persist the disabled feature"
      );
    });

    // 15. Persist a valid feature-limit mapping
    await test("Persist valid feature-limit mapping", async () => {
      const { plan, actorId } = await createPlan();

      const features = [
        ...getMandatoryFeatureKeys().map((key) => ({
          key,
          enabled: true,
        })),
        { key: "STUDENT_MANAGEMENT", enabled: true },
      ];

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration({
          features,
          limits: [{ key: "MAX_STUDENTS", value: 500 }],
        })
      );

      const stored = await SubscriptionPlanVersion.findById(draft._id);

      assert(
        stored.features.find(
          (item) => item.key === "STUDENT_MANAGEMENT"
        ).enabled === true,
        "Student management feature should be enabled"
      );

      assert(
        stored.limits.find((item) => item.key === "MAX_STUDENTS").value === 500,
        "Student limit should persist"
      );
    });

    // 16. Revalidate entitlements before publishing
    await test("Reject publishing a draft with invalid stored entitlements", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      // Intentionally bypass Mongoose to simulate corrupted legacy data.
      await SubscriptionPlanVersion.collection.updateOne(
        { _id: draft._id },
        {
          $set: {
            features: [
              ...getMandatoryFeatureKeys().map((key) => ({
                key,
                enabled: true,
              })),
              { key: "STUDENT_MANAGEMENT", enabled: false },
            ],
            limits: [{ key: "MAX_STUDENTS", value: 100 }],
          },
        }
      );

      await expectReject(() =>
        publishPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        })
      );

      const stored = await SubscriptionPlanVersion.findById(draft._id);
      const storedPlan = await SubscriptionPlan.findById(plan._id);

      assert(stored.status === "DRAFT", "Invalid version must remain a draft");
      assert(
        storedPlan.currentPublishedVersion == null,
        "Invalid version must not become the current published version"
      );
    });






    // 13. Reject retiring a non-current version
    await test("Reject retirement when version is not current", async () => {
      const { plan, actorId } = await createPlan();

      const draft = await createDraft(
        plan._id,
        actorId,
        makeConfiguration()
      );

      await expectReject(
        () =>
          retirePublishedPlanVersion({
            planId: plan._id,
            versionId: draft._id,
            actorId,
          }),
        "Version is not the plan's current published version"
      );
    });
  } finally {
    console.log("\nCleaning up test-created records...");

    // Delete only records created and tracked by this test.
    if (createdVersionIds.length > 0) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }

    if (createdPlanIds.length > 0) {
      await SubscriptionPlan.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }

    await mongoose.disconnect();
  }

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) {
    process.exitCode = 1;
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});
