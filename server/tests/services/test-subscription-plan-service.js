const mongoose = require("mongoose");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const Subscription = require("../../models/Subscription");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createSubscriptionPlan,
  activateSubscriptionPlan,
  deactivateSubscriptionPlan,
  getSubscriptionPlanById,
  getSubscriptionPlanByCode,
} = require("../../services/subscriptionPlanService");

const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const {
  createDraftPlanVersion,
  publishPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const createdPlanIds = [];
const createdSubscriptionIds = [];

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectErrorCode = async (operation, expectedCode) => {
  try {
    await operation();
  } catch (error) {
    if (error.code !== expectedCode) {
      throw new Error(
        `Expected error code "${expectedCode}", received "${error.code}": ${error.message}`
      );
    }

    return error;
  }

  throw new Error(
    `Expected operation to reject with "${expectedCode}", but it succeeded`
  );
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

const makeActorId = () => new mongoose.Types.ObjectId();

const createPlan = async (overrides = {}) => {
  const actorId = makeActorId();

  const plan = await createSubscriptionPlan({
    code: `LCT_${new mongoose.Types.ObjectId().toString()}`,
    name: "Lifecycle Test Plan",
    description: "Automated logical plan lifecycle test",
    actorId,
    ...overrides,
  });

  createdPlanIds.push(plan._id);

  return { plan, actorId };
};

const makeVersionConfiguration = (overrides = {}) => ({
  amount: 999,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: [
    "AUTHENTICATION",
    "ROLE_AUTHORIZATION",
    "TENANT_ISOLATION",
    "PERMISSION_AUTHORIZATION",
    "ACCOUNT_SECURITY",
    "SESSION_SECURITY",
    "INSTITUTE_PROFILE",
    "BASIC_DASHBOARD",
    "SECURITY_AUDIT",
  ].map((key) => ({
    key,
    enabled: true,
  })),
  limits: [],
  ...overrides,
});

const run = async () => {
  await connectTestDB();

  try {
    // 1. New plans start inactive.
    await test("Create a logical plan in INACTIVE state by default", async () => {
      const { plan } = await createPlan();

      assert(plan.isActive === false, "New plan must be inactive");
      assert(
        plan.currentPublishedVersion == null,
        "New plan must not have a published version pointer"
      );
    });

    // 2. Normalize plan code.
    await test("Normalize plan code to uppercase and trim whitespace", async () => {
      const { plan } = await createPlan({
        code: "  starter_test  ",
      });

      assert(
        plan.code === "STARTER_TEST",
        "Plan code should be normalized"
      );
    });

    // 3. Validate plan creation audit fields.
    await test("Record creator and updater during plan creation", async () => {
      const { plan, actorId } = await createPlan();

      assert(
        plan.createdBy.toString() === actorId.toString(),
        "createdBy should match actorId"
      );

      assert(
        plan.updatedBy.toString() === actorId.toString(),
        "updatedBy should match actorId"
      );
    });

    // 4. Reject duplicate plan codes.
    await test("Reject duplicate logical plan codes", async () => {
      const { plan, actorId } = await createPlan({
        code: "LIFECYCLE_DUPLICATE",
      });

      await expectErrorCode(
        () =>
          createSubscriptionPlan({
            code: " lifecycle_duplicate ",
            name: "Duplicate Test Plan",
            actorId,
          }),
        "PLAN_CODE_ALREADY_EXISTS"
      );

      assert(
        await SubscriptionPlan.countDocuments({
          code: plan.code,
        }) === 1,
        "Duplicate creation must not create a second plan"
      );
    });

    // 5. Reject invalid actor.
    await test("Reject plan creation with an invalid actor ID", async () => {
      await expectErrorCode(
        () =>
          createSubscriptionPlan({
            code: "INVALID_ACTOR_TEST",
            name: "Invalid Actor Plan",
            actorId: "invalid-id",
          }),
        "INVALID_ACTORID"
      );
    });

    // 6. Reject invalid plan code.
    await test("Reject invalid plan code", async () => {
      await expectErrorCode(
        () =>
          createSubscriptionPlan({
            code: "1 INVALID CODE",
            name: "Invalid Code Plan",
            actorId: makeActorId(),
          }),
        "INVALID_PLAN_CODE"
      );
    });

    // 7. Reject invalid name.
    await test("Reject an invalid plan name", async () => {
      await expectErrorCode(
        () =>
          createSubscriptionPlan({
            code: "INVALID_NAME_TEST",
            name: " ",
            actorId: makeActorId(),
          }),
        "INVALID_PLAN_NAME"
      );
    });

    // 8. Activate without a published version.
    await test("Activate a plan without requiring a published version", async () => {
      const { plan, actorId } = await createPlan();

      assert(
        plan.currentPublishedVersion == null,
        "Test plan should not have a published version"
      );

      const activated = await activateSubscriptionPlan({
        planId: plan._id,
        actorId,
      });

      assert(activated.isActive === true, "Plan should become active");

      assert(
        activated.currentPublishedVersion == null,
        "Activation must not create or change a published version pointer"
      );

      assert(
        activated.updatedBy.toString() === actorId.toString(),
        "Activation should update the audit actor"
      );
    });

    // 9. Reject repeated activation.
    await test("Reject activating a plan that is already active", async () => {
      const { plan, actorId } = await createPlan();

      await activateSubscriptionPlan({
        planId: plan._id,
        actorId,
      });

      await expectErrorCode(
        () =>
          activateSubscriptionPlan({
            planId: plan._id,
            actorId,
          }),
        "PLAN_ALREADY_ACTIVE"
      );
    });

    // 10. Deactivate a plan.
    await test("Deactivate a plan and update the audit actor", async () => {
      const { plan, actorId } = await createPlan();

      await activateSubscriptionPlan({
        planId: plan._id,
        actorId,
      });

      const newActorId = makeActorId();

      const deactivated = await deactivateSubscriptionPlan({
        planId: plan._id,
        actorId: newActorId,
      });

      assert(
        deactivated.isActive === false,
        "Plan should become inactive"
      );

      assert(
        deactivated.updatedBy.toString() === newActorId.toString(),
        "Deactivation should update updatedBy"
      );
    });

    // 11. Reject repeated deactivation.
    await test("Reject deactivating a plan that is already inactive", async () => {
      const { plan, actorId } = await createPlan();

      await expectErrorCode(
        () =>
          deactivateSubscriptionPlan({
            planId: plan._id,
            actorId,
          }),
        "PLAN_ALREADY_INACTIVE"
      );
    });

    // 12. Deactivation and reactivation must preserve published version.
    await test(
      "Deactivate and reactivate a plan without changing its published version",
      async () => {
        const { plan, actorId } = await createPlan();

        // Activate the logical plan.
        await activateSubscriptionPlan({
          planId: plan._id,
          actorId,
        });

        // Create a valid draft version.
        const draft = await createDraftPlanVersion({
          planId: plan._id,
          actorId,
          configuration: makeVersionConfiguration(),
        });

        // Publish the version.
        const published = await publishPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        });

        const publishedVersionId = published._id.toString();
        const originalPublishedAt = published.publishedAt.getTime();
        const originalPublishedBy = published.publishedBy.toString();

        // Deactivate the logical plan using another actor.
        const deactivationActorId = makeActorId();

        const deactivated = await deactivateSubscriptionPlan({
          planId: plan._id,
          actorId: deactivationActorId,
        });

        assert(
          deactivated.isActive === false,
          "Plan should become inactive"
        );

        assert(
          deactivated.currentPublishedVersion.toString() ===
          publishedVersionId,
          "Deactivation must preserve the published version pointer"
        );

        // Verify persisted records after deactivation.
        let storedPlan = await SubscriptionPlan.findById(plan._id);

        let storedVersion = await SubscriptionPlanVersion.findById(
          published._id
        );

        assert(
          storedPlan.isActive === false,
          "Inactive state should persist in the database"
        );

        assert(
          storedVersion.status === "PUBLISHED",
          "Deactivation must not retire the published version"
        );

        assert(
          storedPlan.currentPublishedVersion.toString() ===
          publishedVersionId,
          "Stored plan pointer must remain unchanged after deactivation"
        );

        assert(
          storedVersion.publishedAt.getTime() === originalPublishedAt,
          "Deactivation must not change publishedAt"
        );

        assert(
          storedVersion.publishedBy.toString() === originalPublishedBy,
          "Deactivation must not change publishedBy"
        );

        // Reactivate the same logical plan using another actor.
        const reactivationActorId = makeActorId();

        const reactivated = await activateSubscriptionPlan({
          planId: plan._id,
          actorId: reactivationActorId,
        });

        assert(
          reactivated.isActive === true,
          "Plan should become active again"
        );

        assert(
          reactivated.currentPublishedVersion.toString() ===
          publishedVersionId,
          "Reactivation must preserve the published version pointer"
        );

        // Verify persisted records after reactivation.
        storedPlan = await SubscriptionPlan.findById(plan._id);

        storedVersion = await SubscriptionPlanVersion.findById(
          published._id
        );

        assert(
          storedPlan.isActive === true,
          "Active state should persist in the database"
        );

        assert(
          storedVersion.status === "PUBLISHED",
          "Reactivation must not change the published version status"
        );

        assert(
          storedPlan.currentPublishedVersion.toString() ===
          publishedVersionId,
          "Stored plan pointer must remain unchanged after reactivation"
        );

        assert(
          storedVersion.publishedAt.getTime() === originalPublishedAt,
          "Reactivation must not change publishedAt"
        );

        assert(
          storedVersion.publishedBy.toString() === originalPublishedBy,
          "Reactivation must not change publishedBy"
        );

        assert(
          reactivated.updatedBy.toString() ===
          reactivationActorId.toString(),
          "Reactivation should update the plan audit actor"
        );
      }
    );

    // 12. Reject invalid plan IDs.
    await test("Reject an invalid plan ID during activation", async () => {
      await expectErrorCode(
        () =>
          activateSubscriptionPlan({
            planId: "invalid-id",
            actorId: makeActorId(),
          }),
        "INVALID_PLANID"
      );
    });

    // 13. Reject a nonexistent plan.
    await test("Reject activation when the plan does not exist", async () => {
      await expectErrorCode(
        () =>
          activateSubscriptionPlan({
            planId: new mongoose.Types.ObjectId(),
            actorId: makeActorId(),
          }),
        "PLAN_NOT_FOUND"
      );
    });

    // 14. Read by ID.
    await test("Retrieve a plan by ID", async () => {
      const { plan } = await createPlan();

      const stored = await getSubscriptionPlanById({
        planId: plan._id,
      });

      assert(
        stored._id.toString() === plan._id.toString(),
        "Lookup should return the requested plan"
      );
    });

    // 15. Read by normalized code.
    await test("Retrieve a plan by normalized code", async () => {
      const { plan } = await createPlan({
        code: "LOOKUP_TEST",
      });

      const stored = await getSubscriptionPlanByCode({
        code: "  lookup_test ",
      });

      assert(
        stored._id.toString() === plan._id.toString(),
        "Code lookup should return the requested plan"
      );
    });

    // 16. Missing ID lookup.
    await test("Return PLAN_NOT_FOUND for a nonexistent plan ID", async () => {
      await expectErrorCode(
        () =>
          getSubscriptionPlanById({
            planId: new mongoose.Types.ObjectId(),
          }),
        "PLAN_NOT_FOUND"
      );
    });

    // 17. Missing code lookup.
    await test("Return PLAN_NOT_FOUND for an unknown plan code", async () => {
      await expectErrorCode(
        () =>
          getSubscriptionPlanByCode({
            code: "UNKNOWN_LOOKUP_TEST",
          }),
        "PLAN_NOT_FOUND"
      );
    });

    // 18. Deactivation must not modify existing subscriptions.
    // await test("Deactivation leaves an existing subscription unchanged", async () => {
    //   const { plan, actorId } = await createPlan();

    //   await activateSubscriptionPlan({
    //     planId: plan._id,
    //     actorId,
    //   });

    //   /*
    //    * Create a minimal subscription fixture from the model's required fields.
    //    * This test intentionally inspects the existing schema before inserting
    //    * any subscription record; see the instructions below if this fixture
    //    * does not match the current Subscription model.
    //    */
    //   const subscriptionSchema = Subscription.schema;
    //   const subscriptionFields = Object.keys(
    //     subscriptionSchema.paths
    //   );

    //   assert(
    //     subscriptionFields.includes("plan"),
    //     "Subscription schema must expose the plan field"
    //   );

    //   assert(
    //     subscriptionFields.includes("status"),
    //     "Subscription schema must expose the status field"
    //   );

    //   const requiredFields = Object.entries(subscriptionSchema.paths)
    //     .filter(([pathName, schemaType]) =>
    //       pathName !== "_id" &&
    //       pathName !== "__v" &&
    //       schemaType.isRequired === true
    //     )
    //     .map(([pathName]) => pathName);

    //   const missingFixtureFields = requiredFields.filter(
    //     (fieldName) =>
    //       ![
    //         "plan",
    //         "status",
    //         "createdAt",
    //         "updatedAt",
    //       ].includes(fieldName)
    //   );

    //   assert(
    //     missingFixtureFields.length === 0,
    //     "Subscription fixture requires additional fields: " +
    //       missingFixtureFields.join(", ")
    //   );

    //   const subscription = new Subscription({
    //     plan: plan.code,
    //     status: "ACTIVE",
    //   });

    //   await subscription.validate();

    //   await subscription.save();

    //   createdSubscriptionIds.push(subscription._id);

    //   const before = await Subscription.findById(
    //     subscription._id
    //   ).lean();

    //   await deactivateSubscriptionPlan({
    //     planId: plan._id,
    //     actorId,
    //   });

    //   const after = await Subscription.findById(
    //     subscription._id
    //   ).lean();

    //   assert(after, "Existing subscription must still exist");

    //   assert(
    //     after.status === before.status,
    //     "Deactivation must not change subscription status"
    //   );

    //   assert(
    //     after.plan === before.plan,
    //     "Deactivation must not change the subscription plan snapshot"
    //   );
    // });

    // 18. Deactivation must not modify existing subscriptions.
    await test("Deactivation leaves an existing subscription unchanged", async () => {
      const Institute = require("../../models/Institute");

      const { plan, actorId } = await createPlan();

      await activateSubscriptionPlan({
        planId: plan._id,
        actorId,
      });

      const institute = await Institute.create({
        name: `PLAN_LIFECYCLE_TEST_${new mongoose.Types.ObjectId()}`,
        code: `PLCT_${new mongoose.Types.ObjectId().toString()}`,
        approvalStatus: "APPROVED",
        isActive: true,
        subscriptionStatus: "ACTIVE",
        subscriptionPlan: "FREE",
      });

      const subscription = await Subscription.create({
        instituteId: institute._id,
        subscriptionType: "STANDARD",
        plan: "FREE",
        planVersion: 1,
        amount: 0,
        currency: "INR",
        paymentRequired: false,
        durationDays: null,
        status: "ACTIVE",
        autoRenew: false,
      });

      createdSubscriptionIds.push(subscription._id);

      const before = await Subscription.findById(
        subscription._id
      ).lean();

      await deactivateSubscriptionPlan({
        planId: plan._id,
        actorId,
      });

      const after = await Subscription.findById(
        subscription._id
      ).lean();

      assert(after, "Existing subscription must still exist");

      assert(
        after.status === before.status,
        "Deactivation must not change subscription status"
      );

      assert(
        after.plan === before.plan,
        "Deactivation must not change subscription plan snapshot"
      );

      assert(
        after.amount === before.amount &&
        after.currency === before.currency &&
        after.paymentRequired === before.paymentRequired &&
        after.planVersion === before.planVersion,
        "Deactivation must not change commercial subscription snapshot"
      );

      await Institute.deleteOne({
        _id: institute._id,
      });
    });



  } finally {
    console.log("\nCleaning up test-created records...");

    if (createdSubscriptionIds.length > 0) {
      await Subscription.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
    }

    if (createdPlanIds.length > 0) {
      await SubscriptionPlan.collection.deleteMany({
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
