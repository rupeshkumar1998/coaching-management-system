const mongoose = require("mongoose");
const connectTestDB = require("../helpers/connectTestDB");
const Subscription = require("../../models/Subscription");

let passed = 0;
let failed = 0;

function makeSubscription(overrides = {}) {
  return new Subscription({
    instituteId: new mongoose.Types.ObjectId(),
    subscriptionType: "STANDARD",
    plan: "BASIC",
    planVersion: 1,
    amount: 999,
    currency: "INR",
    paymentRequired: true,
    durationDays: 30,
    features: [
      {
        key: "ATTENDANCE",
        enabled: true,
      },
    ],
    limits: [
      {
        key: "MAX_STUDENTS",
        value: 100,
      },
    ],
    ...overrides,
  });
}

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function expectSnapshotRejected(callback) {
  try {
    await callback();
  } catch (error) {
    if (
      error.code === "SUBSCRIPTION_SNAPSHOT_IMMUTABLE"
    ) {
      return;
    }

    throw error;
  }

  throw new Error(
    "Expected subscription snapshot modification to be rejected"
  );
}

async function createPersistedSubscription() {
  const subscription = makeSubscription();
  await subscription.save();
  return subscription;
}

async function runTests() {
  await connectTestDB();

  // -----------------------------------------------------------
  // NEW DOCUMENT CREATION
  // -----------------------------------------------------------

  await test(
    "New subscription can be created with commercial snapshot",
    async () => {
      const subscription = makeSubscription();
      await subscription.save();

      const saved = await Subscription.findById(
        subscription._id
      );

      if (
        !saved ||
        saved.plan !== "BASIC" ||
        saved.amount !== 999
      ) {
        throw new Error(
          "New subscription snapshot was not saved correctly"
        );
      }
    }
  );

  // -----------------------------------------------------------
  // DOCUMENT SAVE GUARDS
  // -----------------------------------------------------------

  await test(
    "Document save rejects plan changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.plan = "PRO";

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects price changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.amount = 1999;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects plan version changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.planVersion = 2;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects currency changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.currency = "USD";

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects payment requirement changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.paymentRequired = false;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects duration changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.durationDays = 60;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects feature snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.features[0].enabled = false;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  await test(
    "Document save rejects limit snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.limits[0].value = 200;

      await expectSnapshotRejected(
        () => subscription.save()
      );
    }
  );

  // -----------------------------------------------------------
  // QUERY UPDATE GUARDS
  // -----------------------------------------------------------

  await test(
    "updateOne rejects snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $set: {
                amount: 1999,
              },
            }
          )
      );
    }
  );

  await test(
    "updateMany rejects snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateMany(
            { _id: subscription._id },
            {
              $set: {
                planVersion: 2,
              },
            }
          )
      );
    }
  );

  await test(
    "findOneAndUpdate rejects snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.findOneAndUpdate(
            { _id: subscription._id },
            {
              $set: {
                currency: "USD",
              },
            }
          )
      );
    }
  );

  await test(
    "findByIdAndUpdate rejects snapshot changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.findByIdAndUpdate(
            subscription._id,
            {
              $set: {
                paymentRequired: false,
              },
            }
          )
      );
    }
  );

  await test(
    "Nested feature update is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $set: {
                "features.0.enabled": false,
              },
            }
          )
      );
    }
  );

  await test(
    "Nested limit update is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $set: {
                "limits.0.value": 500,
              },
            }
          )
      );
    }
  );

  await test(
    "Snapshot $unset is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $unset: {
                amount: 1,
              },
            }
          )
      );
    }
  );

  await test(
    "Snapshot $inc is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $inc: {
                amount: 100,
              },
            }
          )
      );
    }
  );

  await test(
    "Snapshot $rename is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.updateOne(
            { _id: subscription._id },
            {
              $rename: {
                amount: "oldAmount",
              },
            }
          )
      );
    }
  );

  // -----------------------------------------------------------
  // PIPELINE / REPLACEMENT / BULK WRITE
  // -----------------------------------------------------------

await test(
  "Aggregation update pipeline is rejected",
  async () => {
    const subscription =
      await createPersistedSubscription();

    await expectSnapshotRejected(
      () =>
        Subscription.updateOne(
          { _id: subscription._id },
          [
            {
              $set: {
                amount: 1,
              },
            },
          ],
          {
            updatePipeline: true,
          }
        )
    );
  }
);

  await test(
    "replaceOne is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.replaceOne(
            { _id: subscription._id },
            {
              instituteId: subscription.instituteId,
              subscriptionType: "STANDARD",
              plan: "PRO",
              planVersion: 2,
              amount: 1999,
              currency: "INR",
              paymentRequired: true,
              durationDays: 30,
            }
          )
      );
    }
  );

  await test(
    "findOneAndReplace is rejected",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.findOneAndReplace(
            { _id: subscription._id },
            {
              instituteId: subscription.instituteId,
              subscriptionType: "STANDARD",
              plan: "PRO",
              planVersion: 2,
              amount: 1999,
              currency: "INR",
              paymentRequired: true,
              durationDays: 30,
            }
          )
      );
    }
  );

  await test(
    "bulkWrite rejects snapshot updates",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.bulkWrite([
            {
              updateOne: {
                filter: {
                  _id: subscription._id,
                },
                update: {
                  $set: {
                    amount: 1999,
                  },
                },
              },
            },
          ])
      );
    }
  );

  await test(
    "bulkWrite rejects replacement operations",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await expectSnapshotRejected(
        () =>
          Subscription.bulkWrite([
            {
              replaceOne: {
                filter: {
                  _id: subscription._id,
                },
                replacement: {
                  instituteId: subscription.instituteId,
                  subscriptionType: "STANDARD",
                  plan: "PRO",
                  planVersion: 2,
                  amount: 1999,
                  currency: "INR",
                  paymentRequired: true,
                  durationDays: 30,
                },
              },
            },
          ])
      );
    }
  );

  // -----------------------------------------------------------
  // LEGITIMATE LIFECYCLE UPDATES
  // -----------------------------------------------------------

  await test(
    "Lifecycle status update remains allowed",
    async () => {
      const subscription =
        await createPersistedSubscription();

      await Subscription.updateOne(
        { _id: subscription._id },
        {
          $set: {
            status: "SUSPENDED",
          },
        }
      );

      const saved = await Subscription.findById(
        subscription._id
      );

      if (saved.status !== "SUSPENDED") {
        throw new Error(
          "Lifecycle status update did not persist"
        );
      }
    }
  );

  await test(
    "Lifecycle date updates remain allowed",
    async () => {
      const subscription =
        await createPersistedSubscription();

      const startDate = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000
      );

      const endDate = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      );

      await Subscription.updateOne(
        { _id: subscription._id },
        {
          $set: {
            startDate,
            endDate,
          },
        }
      );

      const saved = await Subscription.findById(
        subscription._id
      );

      if (
        saved.startDate.getTime() !== startDate.getTime() ||
        saved.endDate.getTime() !== endDate.getTime()
      ) {
        throw new Error(
          "Lifecycle date update did not persist"
        );
      }
    }
  );

  await test(
    "Document save allows lifecycle-only changes",
    async () => {
      const subscription =
        await createPersistedSubscription();

      subscription.status = "SUSPENDED";
      subscription.statusReason = "Administrative review";

      await subscription.save();

      const saved = await Subscription.findById(
        subscription._id
      );

      if (
        saved.status !== "SUSPENDED" ||
        saved.statusReason !== "Administrative review"
      ) {
        throw new Error(
          "Lifecycle-only document save did not persist"
        );
      }
    }
  );

  // -----------------------------------------------------------
  // EXISTING IMMUTABLE REFERENCES
  // -----------------------------------------------------------

  await test(
    "Existing planVersionId immutable protection remains enabled",
    async () => {
      const path = Subscription.schema.path(
        "planVersionId"
      );

      if (!path || path.options.immutable !== true) {
        throw new Error(
          "planVersionId immutable schema protection is missing"
        );
      }
    }
  );

  await test(
    "Existing platform trial offer immutable protections remain enabled",
    async () => {
      const offerIdPath = Subscription.schema.path(
        "platformTrialOfferId"
      );

      const offerVersionPath = Subscription.schema.path(
        "platformTrialOfferVersion"
      );

      if (
        !offerIdPath ||
        offerIdPath.options.immutable !== true ||
        !offerVersionPath ||
        offerVersionPath.options.immutable !== true
      ) {
        throw new Error(
          "Existing platform trial offer immutable protections are missing"
        );
      }
    }
  );

  // -----------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------

  console.log("\n----------------------------------------");
  console.log(
    `Subscription Snapshot Immutability: ${passed} PASS / ${failed} FAIL`
  );
  console.log("----------------------------------------\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests()
  .catch((error) => {
    console.error(
      "\nSNAPSHOT IMMUTABILITY TEST RUN FAILED:"
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });