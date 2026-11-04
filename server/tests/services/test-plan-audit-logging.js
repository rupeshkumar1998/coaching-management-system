require("dotenv").config();

const mongoose = require("mongoose");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const { AuditLog } = require("../../models/AuditLog");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createSubscriptionPlan,
  activateSubscriptionPlan,
  deactivateSubscriptionPlan,
} = require("../../services/subscriptionPlanService");

const {
  createDraftPlanVersion,
  updateDraftPlanVersion,
  publishPlanVersion,
  retirePublishedPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const { getMandatoryFeatureKeys } = require("../../constants/featureCatalog");

const createdPlanIds = [];

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

const createPlanViaService = async () => {
  const actorId = new mongoose.Types.ObjectId();

  const plan = await createSubscriptionPlan({
    code: `AUD_${new mongoose.Types.ObjectId().toString()}`,
    name: "Audit Test Plan",
    description: "Automated audit test",
    actorId,
  });

  createdPlanIds.push(plan._id);

  return { plan, actorId };
};

const findLogs = (planId) =>
  AuditLog.find({ planId }).sort({ timestamp: 1 }).lean();

const run = async () => {
  await connectTestDB();

  try {
    // 1. PLAN_CREATED
    await test("Create plan emits PLAN_CREATED", async () => {
      const { plan, actorId } = await createPlanViaService();
      const logs = await findLogs(plan._id);

      assert(logs.length === 1, "Exactly one audit log expected");
      assert(logs[0].action === "PLAN_CREATED", "Wrong action");
      assert(
        logs[0].actor.toString() === actorId.toString(),
        "Wrong actor"
      );
      assert(logs[0].oldValue === null, "oldValue should be null");
      assert(
        logs[0].newValue.code === plan.code,
        "newValue.code mismatch"
      );
      assert(
        logs[0].planVersionId === null,
        "planVersionId should be null for plan-level event"
      );
    });

    // 2. PLAN_ENABLED / PLAN_DISABLED
    await test(
      "Activate / deactivate plan emit PLAN_ENABLED and PLAN_DISABLED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        await activateSubscriptionPlan({
          planId: plan._id,
          actorId,
        });

        await deactivateSubscriptionPlan({
          planId: plan._id,
          actorId,
        });

        const logs = await findLogs(plan._id);
        const actions = logs.map((log) => log.action);

        assert(actions.includes("PLAN_CREATED"), "PLAN_CREATED missing");
        assert(actions.includes("PLAN_ENABLED"), "PLAN_ENABLED missing");
        assert(
          actions.includes("PLAN_DISABLED"),
          "PLAN_DISABLED missing"
        );
      }
    );

    // 3. PLAN_DRAFT_CREATED
    await test("Create draft emits PLAN_DRAFT_CREATED", async () => {
      const { plan, actorId } = await createPlanViaService();

      const draft = await createDraftPlanVersion({
        planId: plan._id,
        configuration: makeConfiguration(),
        actorId,
      });

      const logs = await findLogs(plan._id);
      const draftLog = logs.find(
        (log) => log.action === "PLAN_DRAFT_CREATED"
      );

      assert(draftLog, "PLAN_DRAFT_CREATED missing");
      assert(
        draftLog.planVersionId.toString() === draft._id.toString(),
        "planVersionId mismatch"
      );
      assert(
        draftLog.newValue.version === draft.version,
        "version mismatch"
      );
    });

    // 4. PLAN_PRICE_CHANGED
    await test("Update amount emits PLAN_PRICE_CHANGED", async () => {
      const { plan, actorId } = await createPlanViaService();

      const draft = await createDraftPlanVersion({
        planId: plan._id,
        configuration: makeConfiguration(),
        actorId,
      });

      await updateDraftPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
        configuration: { amount: 1999 },
      });

      const logs = await findLogs(plan._id);
      const priceLog = logs.find(
        (log) => log.action === "PLAN_PRICE_CHANGED"
      );

      assert(priceLog, "PLAN_PRICE_CHANGED missing");
      assert(priceLog.oldValue.amount === 999, "oldValue.amount mismatch");
      assert(
        priceLog.newValue.amount === 1999,
        "newValue.amount mismatch"
      );
    });

    // 5. PLAN_DURATION_CHANGED
    await test(
      "Update duration emits PLAN_DURATION_CHANGED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration(),
          actorId,
        });

        await updateDraftPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
          configuration: { durationDays: 90 },
        });

        const logs = await findLogs(plan._id);
        const durationLog = logs.find(
          (log) => log.action === "PLAN_DURATION_CHANGED"
        );

        assert(durationLog, "PLAN_DURATION_CHANGED missing");
        assert(durationLog.oldValue === 30, "oldValue mismatch");
        assert(durationLog.newValue === 90, "newValue mismatch");
      }
    );

    // 6. PLAN_FEATURE_CHANGED
    await test(
      "Update features emits PLAN_FEATURE_CHANGED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const baseFeatures = getMandatoryFeatureKeys().map((key) => ({
          key,
          enabled: true,
        }));

        const draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration({
            features: baseFeatures,
          }),
          actorId,
        });

        // Add a commercial feature that was NOT part of the draft.
        // This guarantees a real change and therefore a real audit log.
        const newFeatures = [
          ...baseFeatures,
          { key: "ANALYTICS", enabled: true },
        ];

        await updateDraftPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
          configuration: { features: newFeatures },
        });

        const logs = await findLogs(plan._id);
        const featureLog = logs.find(
          (log) => log.action === "PLAN_FEATURE_CHANGED"
        );

        assert(featureLog, "PLAN_FEATURE_CHANGED missing");

        // Verify the diff content is meaningful.
        const beforeKeys = featureLog.oldValue.map((f) => f.key);
        const afterKeys = featureLog.newValue.map((f) => f.key);

        assert(
          !beforeKeys.includes("ANALYTICS"),
          "oldValue must NOT contain ANALYTICS"
        );
        assert(
          afterKeys.includes("ANALYTICS"),
          "newValue must contain ANALYTICS"
        );
      }
    );


    // 7. PLAN_LIMIT_CHANGED
    await test("Update limits emits PLAN_LIMIT_CHANGED", async () => {
      const { plan, actorId } = await createPlanViaService();

      const draft = await createDraftPlanVersion({
        planId: plan._id,
        configuration: makeConfiguration({
          features: [
            ...getMandatoryFeatureKeys().map((key) => ({
              key,
              enabled: true,
            })),
            { key: "STUDENT_MANAGEMENT", enabled: true },
          ],
          limits: [{ key: "MAX_STUDENTS", value: 100 }],
        }),
        actorId,
      });

      await updateDraftPlanVersion({
        planId: plan._id,
        versionId: draft._id,
        actorId,
        configuration: {
          limits: [{ key: "MAX_STUDENTS", value: 500 }],
        },
      });

      const logs = await findLogs(plan._id);
      const limitLog = logs.find(
        (log) => log.action === "PLAN_LIMIT_CHANGED"
      );

      assert(limitLog, "PLAN_LIMIT_CHANGED missing");
    });

    // 8. PLAN_VERSION_PUBLISHED
    await test(
      "Publish emits PLAN_VERSION_PUBLISHED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration(),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        });

        const logs = await findLogs(plan._id);
        const publishLog = logs.find(
          (log) => log.action === "PLAN_VERSION_PUBLISHED"
        );

        assert(publishLog, "PLAN_VERSION_PUBLISHED missing");
        assert(
          publishLog.planVersionId.toString() === draft._id.toString(),
          "planVersionId mismatch"
        );
        assert(
          publishLog.oldValue.status === "DRAFT",
          "oldValue.status mismatch"
        );
        assert(
          publishLog.newValue.status === "PUBLISHED",
          "newValue.status mismatch"
        );
      }
    );

    // 9. Publishing v2 retires v1 → 2 audit events
    await test(
      "Publishing v2 emits PLAN_VERSION_RETIRED and PLAN_VERSION_PUBLISHED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const firstDraft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration(),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: firstDraft._id,
          actorId,
        });

        const secondDraft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration({ amount: 1499 }),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: secondDraft._id,
          actorId,
        });

        const logs = await findLogs(plan._id);

        const retiredLogs = logs.filter(
          (log) => log.action === "PLAN_VERSION_RETIRED"
        );
        const publishedLogs = logs.filter(
          (log) => log.action === "PLAN_VERSION_PUBLISHED"
        );

        assert(
          retiredLogs.length === 1,
          "Exactly one PLAN_VERSION_RETIRED expected"
        );
        assert(
          retiredLogs[0].planVersionId.toString() ===
          firstDraft._id.toString(),
          "Retired version mismatch"
        );
        assert(
          publishedLogs.length === 2,
          "Exactly two PLAN_VERSION_PUBLISHED expected"
        );
      }
    );

    // 10. PLAN_VERSION_RETIRED via explicit retire
    await test(
      "Explicit retire emits PLAN_VERSION_RETIRED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration(),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        });

        await retirePublishedPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        });

        const logs = await findLogs(plan._id);
        const retiredLogs = logs.filter(
          (log) => log.action === "PLAN_VERSION_RETIRED"
        );

        assert(
          retiredLogs.length === 1,
          "Exactly one PLAN_VERSION_RETIRED expected"
        );
        assert(
          retiredLogs[0].planVersionId.toString() ===
          draft._id.toString(),
          "Retired version mismatch"
        );
      }
    );

    // 11. Audit log immutability — update blocked
    await test("Audit logs cannot be updated", async () => {
      const { plan } = await createPlanViaService();
      const logs = await findLogs(plan._id);

      await expectReject(
        () =>
          AuditLog.updateOne(
            { _id: logs[0]._id },
            { $set: { reason: "tampered" } }
          ),
        "immutable"
      );
    });

    // 12. Audit log immutability — delete blocked
    await test("Audit logs cannot be deleted", async () => {
      const { plan } = await createPlanViaService();
      const logs = await findLogs(plan._id);

      await expectReject(
        () => AuditLog.deleteOne({ _id: logs[0]._id }),
        "immutable"
      );
    });

    // 13. Failed operation leaves no audit record
    await test(
      "Failed draft update produces no PLAN_PRICE_CHANGED",
      async () => {
        const { plan, actorId } = await createPlanViaService();

        const draft = await createDraftPlanVersion({
          planId: plan._id,
          configuration: makeConfiguration(),
          actorId,
        });

        await publishPlanVersion({
          planId: plan._id,
          versionId: draft._id,
          actorId,
        });

        const before = await findLogs(plan._id);
        const priceBefore = before.filter(
          (log) => log.action === "PLAN_PRICE_CHANGED"
        ).length;

        await expectReject(() =>
          updateDraftPlanVersion({
            planId: plan._id,
            versionId: draft._id,
            actorId,
            configuration: { amount: 2500 },
          })
        );

        const after = await findLogs(plan._id);
        const priceAfter = after.filter(
          (log) => log.action === "PLAN_PRICE_CHANGED"
        ).length;

        assert(
          priceBefore === priceAfter,
          "Failed update must not produce an audit record"
        );
      }
    );

    console.log(
      "\nAll plan audit logging tests executed."
    );
  } finally {
    console.log("\nCleaning up test-created records...");

    if (createdPlanIds.length > 0) {
      // Bypass the audit-log immutability guard using the raw collection.
      await AuditLog.collection.deleteMany({
        planId: { $in: createdPlanIds },
      });

      await SubscriptionPlanVersion.collection.deleteMany({
        planId: { $in: createdPlanIds },
      });

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