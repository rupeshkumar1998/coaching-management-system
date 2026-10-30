require("dotenv").config();

const mongoose = require("mongoose");

const SubscriptionPlanVersion = require(
  "../../models/SubscriptionPlanVersion"
);

const SubscriptionPlan = require("../../models/SubscriptionPlan");

const connectTestDB = require("../helpers/connectTestDB");

const {
  publishPlanVersion,
  retirePublishedPlanVersion,
} = require("../../services/subscriptionPlanVersionService");



const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

// Keep track of records created by this test file.
// Records are removed directly from the collection during test cleanup.
const createdIds = [];
const createdPlanIds = [];

// --------------------------------------------------
// 1. TEST RUNNER
// --------------------------------------------------

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

// --------------------------------------------------
// 2. CREATE TEST DOCUMENTS
// --------------------------------------------------

const createVersion = (status = "DRAFT") => {
  const now = new Date();

  const hasBeenPublished =
    status === "PUBLISHED" || status === "RETIRED";

  return new SubscriptionPlanVersion({
    planId: new mongoose.Types.ObjectId(),
    version: 1,
    status,

    amount: 999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,

    features: getMandatoryFeatureKeys().map((key) => ({
      key,
      enabled: true,
    })),

    limits: [],

    publishedAt: hasBeenPublished ? now : null,
    publishedBy: hasBeenPublished
      ? new mongoose.Types.ObjectId()
      : null,

    retiredAt: status === "RETIRED" ? now : null,
    retiredBy:
      status === "RETIRED"
        ? new mongoose.Types.ObjectId()
        : null,
  });
};

// // Save a valid DRAFT first, then transition it to PUBLISHED.
// const createPublishedVersion = async () => {
//   const doc = createVersion("DRAFT");

//   await doc.save();
//   createdIds.push(doc._id);

//   doc.status = "PUBLISHED";
//   doc.publishedAt = new Date();
//   doc.publishedBy = new mongoose.Types.ObjectId();

//   await doc.save();

//   return doc;
// };

// // Save a valid DRAFT first, then transition it to RETIRED.
// // The publication audit fields are also populated because a retired
// // version represents a version that was previously published.
// const createRetiredVersion = async () => {
//   const doc = createVersion("DRAFT");

//   await doc.save();
//   createdIds.push(doc._id);

//   doc.status = "RETIRED";

//   doc.publishedAt = new Date();
//   doc.publishedBy = new mongoose.Types.ObjectId();

//   doc.retiredAt = new Date();
//   doc.retiredBy = new mongoose.Types.ObjectId();

//   await doc.save();

//   return doc;
// };

// Create a real plan and a valid DRAFT, then publish it
// through the controlled lifecycle service.
const createPublishedVersion = async () => {
  const actorId = new mongoose.Types.ObjectId();

  const plan = await SubscriptionPlan.create({
    code: `TEST_${new mongoose.Types.ObjectId().toString()}`,
    name: "Test Plan",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });

  createdPlanIds.push(plan._id);


  const doc = createVersion("DRAFT");
  doc.planId = plan._id;
  doc.createdBy = actorId;
  doc.updatedBy = actorId;

  await doc.save();
  createdIds.push(doc._id);

  const published = await publishPlanVersion({
    planId: plan._id,
    versionId: doc._id,
    actorId,
  });

  return published;
};

// Create a published version first, then retire it
// through the controlled lifecycle service.
const createRetiredVersion = async () => {
  const published = await createPublishedVersion();
  const actorId = new mongoose.Types.ObjectId();

  const retired = await retirePublishedPlanVersion({
    planId: published.planId,
    versionId: published._id,
    actorId,
  });

  return retired;
};



// --------------------------------------------------
// 3. ASSERTION HELPERS
// --------------------------------------------------

// Accept only errors expected from the protections under test.
// Unexpected errors must still fail the test.
const expectRejected = async (operation) => {
  try {
    await operation();
  } catch (error) {
    const acceptedErrors = [
      "Aggregation-pipeline updates are not allowed for plan versions",
      "Published or retired plan versions cannot be modified",
      "Plan version status must be changed through the controlled lifecycle service",
      "bulkWrite is disabled for SubscriptionPlanVersion",
      "insertMany is disabled for SubscriptionPlanVersion",
      "New plan versions must be created as DRAFT",
      "Upsert is disabled for SubscriptionPlanVersion",
      "Plan version planId and version cannot be changed",
      "Plan version lifecycle transitions must use the controlled service",
      "insertOne is disabled for SubscriptionPlanVersion",
    ];

    const isExpectedError = acceptedErrors.some((message) =>
      error.message.includes(message)
    );

    if (isExpectedError) {
      return;
    }

    throw error;
  }

  throw new Error("Protected operation was unexpectedly accepted");
};

const expectAmountUnchanged = async (id, expectedAmount = 999) => {
  const doc = await SubscriptionPlanVersion.findById(id);

  if (!doc) {
    throw new Error("Plan version disappeared unexpectedly");
  }

  if (doc.amount !== expectedAmount) {
    throw new Error(
      `Expected amount ${expectedAmount}, but found ${doc.amount}`
    );
  }
};

const expectVersionExists = async (id) => {
  const doc = await SubscriptionPlanVersion.findById(id);

  if (!doc) {
    throw new Error("Protected plan version was deleted unexpectedly");
  }
};

const expectDraftUnchanged = async (id) => {
  const doc = await SubscriptionPlanVersion.findById(id);

  if (!doc) {
    throw new Error("Draft version disappeared unexpectedly");
  }

  if (doc.status !== "DRAFT") {
    throw new Error(
      `Expected status DRAFT, but found ${doc.status}`
    );
  }
};

// --------------------------------------------------
// 4. RUN TESTS
// --------------------------------------------------

(async () => {
  let connected = false;

  try {
    await connectTestDB();
    connected = true;

    // ----------------------------------------------
    // A. DOCUMENT SAVE PROTECTION
    // ----------------------------------------------

    await runTest(
      "Published version rejects document save modification",
      async () => {
        const doc = await createPublishedVersion();

        doc.amount = 1499;

        await expectRejected(() => doc.save());
      }
    );

    await runTest(
      "Retired version rejects document save modification",
      async () => {
        const doc = await createRetiredVersion();

        doc.amount = 1499;

        await expectRejected(() => doc.save());
      }
    );

    // ----------------------------------------------
    // B. updateOne PROTECTION
    // ----------------------------------------------

    await runTest(
      "updateOne rejects published version modification",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.updateOne(
            { _id: doc._id },
            { $set: { amount: 1499 } }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    await runTest(
      "updateOne rejects retired version modification",
      async () => {
        const doc = await createRetiredVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.updateOne(
            { _id: doc._id },
            { $set: { amount: 1499 } }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    // ----------------------------------------------
    // C. findOneAndUpdate PROTECTION
    // ----------------------------------------------

    await runTest(
      "findOneAndUpdate rejects published version modification",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.findOneAndUpdate(
            { _id: doc._id },
            { $set: { amount: 1499 } },
            { returnDocument: "after", }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    await runTest(
      "findOneAndUpdate rejects retired version modification",
      async () => {
        const doc = await createRetiredVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.findOneAndUpdate(
            { _id: doc._id },
            { $set: { amount: 1499 } },
            {returnDocument: "after",}
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    // ----------------------------------------------
    // D. updateMany PROTECTION
    // ----------------------------------------------

    await runTest(
      "updateMany rejects published version modification",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.updateMany(
            { _id: doc._id },
            { $set: { amount: 1499 } }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    await runTest(
      "updateMany rejects retired version modification",
      async () => {
        const doc = await createRetiredVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.updateMany(
            { _id: doc._id },
            { $set: { amount: 1499 } }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    // ----------------------------------------------
    // E. REPLACEMENT OPERATION PROTECTION
    // ----------------------------------------------

    await runTest(
      "replaceOne rejects published version replacement",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.replaceOne(
            { _id: doc._id },
            {
              planId: doc.planId,
              version: doc.version,
              status: "PUBLISHED",
              amount: 1499,
              currency: "INR",
              durationDays: 30,
              paymentRequired: true,
              features: doc.features,
              limits: [],
              publishedAt: doc.publishedAt,
              publishedBy: doc.publishedBy,
            }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    await runTest(
      "findOneAndReplace rejects published version replacement",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.findOneAndReplace(
            { _id: doc._id },
            {
              planId: doc.planId,
              version: doc.version,
              status: "PUBLISHED",
              amount: 1499,
              currency: "INR",
              durationDays: 30,
              paymentRequired: true,
              features: doc.features,
              limits: [],
              publishedAt: doc.publishedAt,
              publishedBy: doc.publishedBy,
            }
          )
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    // ----------------------------------------------
    // F. BULK AND INSERT OPERATIONS
    // ----------------------------------------------

    await runTest(
      "bulkWrite is blocked for plan versions",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.bulkWrite([
            {
              updateOne: {
                filter: { _id: doc._id },
                update: { $set: { amount: 1499 } },
              },
            },
          ])
        );

        await expectAmountUnchanged(doc._id);
      }
    );

    await runTest(
      "insertMany is blocked for plan versions",
      async () => {
        const doc = createVersion("DRAFT");

        await expectRejected(() =>
          SubscriptionPlanVersion.insertMany([doc])
        );

        const inserted =
          await SubscriptionPlanVersion.findById(doc._id);

        if (inserted) {
          throw new Error(
            "insertMany inserted a plan version unexpectedly"
          );
        }
      }
    );

    await runTest(
      "insertOne is blocked for plan versions",
          async () => {
          const doc = createVersion("DRAFT");

        await expectRejected(() =>
          SubscriptionPlanVersion.insertOne(doc)
        );

        const inserted =
          await SubscriptionPlanVersion.findById(doc._id);

        if (inserted) {
          throw new Error(
            "Direct published-version creation was accepted"
          );
        }
      }
    );

    // ----------------------------------------------
    // G. DELETE OPERATION PROTECTION
    // ----------------------------------------------

    await runTest(
      "deleteOne rejects published version deletion",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.deleteOne({
            _id: doc._id,
          })
        );

        await expectVersionExists(doc._id);
      }
    );

    await runTest(
      "deleteMany rejects published version deletion",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.deleteMany({
            _id: doc._id,
          })
        );

        await expectVersionExists(doc._id);
      }
    );

    await runTest(
      "findOneAndDelete rejects published version deletion",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() =>
          SubscriptionPlanVersion.findOneAndDelete({
            _id: doc._id,
          })
        );

        await expectVersionExists(doc._id);
      }
    );

    await runTest(
      "document deleteOne rejects published version deletion",
      async () => {
        const doc = await createPublishedVersion();

        await expectRejected(() => doc.deleteOne());

        await expectVersionExists(doc._id);
      }
    );

    await runTest(
  "Document deleteOne checks current database status",
  async () => {
    const doc = createVersion("DRAFT");

    await doc.save();
    createdIds.push(doc._id);

    // Simulate another operation publishing the version
    // after this document was loaded.
    await SubscriptionPlanVersion.collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          publishedBy: new mongoose.Types.ObjectId(),
        },
      }
    );

    // The in-memory document remains stale: DRAFT.
    if (doc.status !== "DRAFT") {
      throw new Error(
        "Test setup failed: document is not stale"
      );
    }

    await expectRejected(() => doc.deleteOne());

    const stored = await SubscriptionPlanVersion.findById(
      doc._id
    ).lean();

    if (!stored) {
      throw new Error(
        "Published version was unexpectedly deleted"
      );
    }

    if (stored.status !== "PUBLISHED") {
      throw new Error(
        "Published version status changed unexpectedly"
      );
    }
  }
);

/////////////////
await runTest(
  "updateOne cannot change planId",
  async () => {
    const doc = createVersion("DRAFT");
    await doc.save();
    createdIds.push(doc._id);

    await expectRejected(() =>
      SubscriptionPlanVersion.updateOne(
        { _id: doc._id },
        {
          $set: {
            planId: new mongoose.Types.ObjectId(),
          },
        }
      )
    );

    const stored = await SubscriptionPlanVersion.findById(
      doc._id
    ).lean();

    if (!stored.planId.equals(doc.planId)) {
      throw new Error("planId changed unexpectedly");
    }
  }
);

await runTest(
  "updateOne cannot change version",
  async () => {
    const doc = createVersion("DRAFT");
    await doc.save();
    createdIds.push(doc._id);

    await expectRejected(() =>
      SubscriptionPlanVersion.updateOne(
        { _id: doc._id },
        {
          $set: {
            version: doc.version + 1,
          },
        }
      )
    );

    const stored = await SubscriptionPlanVersion.findById(
      doc._id
    ).lean();

    if (stored.version !== doc.version) {
      throw new Error("version changed unexpectedly");
    }
  }
);
////////////
///////----------/////////
await runTest(
  "replaceOne cannot change planId",
  async () => {
    const doc = createVersion("DRAFT");
    await doc.save();
    createdIds.push(doc._id);

    await expectRejected(() =>
      SubscriptionPlanVersion.replaceOne(
        { _id: doc._id },
        {
          planId: new mongoose.Types.ObjectId(),
          version: doc.version,
          status: "DRAFT",
          amount: doc.amount,
          currency: doc.currency,
          paymentRequired: doc.paymentRequired,
          features: doc.features,
          limits: doc.limits,
        }
      )
    );

    const stored = await SubscriptionPlanVersion.findById(
      doc._id
    ).lean();

    if (!stored.planId.equals(doc.planId)) {
      throw new Error("replaceOne changed planId");
    }
  }
);

await runTest(
  "findOneAndReplace cannot change version",
  async () => {
    const doc = createVersion("DRAFT");
    await doc.save();
    createdIds.push(doc._id);

    await expectRejected(() =>
      SubscriptionPlanVersion.findOneAndReplace(
        { _id: doc._id },
        {
          planId: doc.planId,
          version: doc.version + 1,
          status: "DRAFT",
          amount: doc.amount,
          currency: doc.currency,
          paymentRequired: doc.paymentRequired,
          features: doc.features,
          limits: doc.limits,
        }
      )
    );

    const stored = await SubscriptionPlanVersion.findById(
      doc._id
    ).lean();

    if (stored.version !== doc.version) {
      throw new Error("findOneAndReplace changed version");
    }
  }
);
////////////---------////////




    // ----------------------------------------------
    // H. STATUS CHANGE PROTECTION
    // ----------------------------------------------

    await runTest(
      "Query update cannot publish a draft version directly",
      async () => {
        const doc = createVersion("DRAFT");

        await doc.save();
        createdIds.push(doc._id);

        await expectRejected(() =>
          SubscriptionPlanVersion.updateOne(
            { _id: doc._id },
            { $set: { status: "PUBLISHED" } }
          )
        );

        await expectDraftUnchanged(doc._id);
      }
    );

    await runTest(
      "Query update cannot retire a draft version directly",
      async () => {
        const doc = createVersion("DRAFT");

        await doc.save();
        createdIds.push(doc._id);

        await expectRejected(() =>
          SubscriptionPlanVersion.updateOne(
            { _id: doc._id },
            { $set: { status: "RETIRED" } }
          )
        );

        await expectDraftUnchanged(doc._id);
      }
    );

    await runTest(
      "updateOne rejects status removal with $unset",
      async () => {
        const doc = createVersion("DRAFT");

        await doc.save();
        createdIds.push(doc._id);

        await expectRejected(() =>
          SubscriptionPlanVersion.updateOne(
            { _id: doc._id },
            { $unset: { status: 1 } }
          )
        );

        await expectDraftUnchanged(doc._id);
      }
    );

    await runTest(
      "findOneAndUpdate rejects direct status change",
      async () => {
        const doc = createVersion("DRAFT");

        await doc.save();
        createdIds.push(doc._id);

        await expectRejected(() =>
          SubscriptionPlanVersion.findOneAndUpdate(
            { _id: doc._id },
            { $set: { status: "PUBLISHED" } },
            { returnDocument: "after", }
          )
        );

        await expectDraftUnchanged(doc._id);
      }
    );

    await runTest(
      "updateMany rejects direct status change",
      async () => {
        const doc = createVersion("DRAFT");

        await doc.save();
        createdIds.push(doc._id);

        await expectRejected(() =>
          SubscriptionPlanVersion.updateMany(
            { _id: doc._id },
            { $set: { status: "RETIRED" } }
          )
        );

        await expectDraftUnchanged(doc._id);
      }
    );

    // ----------------------------------------------
    // I. AGGREGATION PIPELINE UPDATE PROTECTION
    // ----------------------------------------------

    // await runTest(
    //   "Aggregation pipeline updates are rejected",
    //   async () => {
    //     const doc = createVersion("DRAFT");

    //     await doc.save();
    //     createdIds.push(doc._id);

    //     await expectRejected(() =>
    //       SubscriptionPlanVersion.updateOne(
    //         { _id: doc._id },
    //         [{ $set: { status: "PUBLISHED" } }]
    //       )
    //     );

    //     await expectDraftUnchanged(doc._id);
    //   }
    // );
//     await runTest(
//   "Aggregation pipeline updates are rejected",
//   async () => {
//     const doc = createVersion("DRAFT");

//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         [{ $set: { status: "PUBLISHED" } }],
//         { updatePipeline: true }
//       )
//     );

//     await expectDraftUnchanged(doc._id);
//   }
// );
await runTest(
  "Upsert is disabled for plan versions",
  async () => {
    await expectRejected(() =>
      SubscriptionPlanVersion.updateOne(
        {
          planId: new mongoose.Types.ObjectId(),
          version: 1,
        },
        {
          $set: {
            amount: 999,
          },
        },
        {
          upsert: true,
        }
      )
    );

    const upserted = await SubscriptionPlanVersion.findOne({
      amount: 999,
      status: "DRAFT",
      planId: {
        $exists: false,
      },
    });

    if (upserted) {
      throw new Error(
        "Upsert unexpectedly created a plan version"
      );
    }
  }
);

await runTest(
  "Query update cannot set status through $setOnInsert",
  async () => {
    const doc = createVersion("DRAFT");

    await doc.save();
    createdIds.push(doc._id);

    await expectRejected(() =>
      SubscriptionPlanVersion.updateOne(
        { _id: doc._id },
        {
          $setOnInsert: {
            status: "PUBLISHED",
          },
        }
      )
    );

    await expectDraftUnchanged(doc._id);
  }
);



  } catch (error) {
    console.error("TEST SETUP ERROR:", error.message);
    process.exitCode = 1;
  } finally {
    // Cleanup is intentionally performed after all tests have run.
    // Use the raw collection here because model-level deletion
    // protections are part of what this suite tests.
    if (connected) {
      try {
        if (createdIds.length > 0) {
          await SubscriptionPlanVersion.collection.deleteMany({
            _id: { $in: createdIds },
          });
        }
/////////////
        if (createdPlanIds.length > 0) {
          await SubscriptionPlan.deleteMany({
            _id: { $in: createdPlanIds },
          });
        }
///////
      } catch (error) {
        console.error("TEST CLEANUP ERROR:", error.message);
        process.exitCode = 1;
      }

      try {
        await mongoose.disconnect();
      } catch (error) {
        console.error("MONGODB DISCONNECT ERROR:", error.message);
        process.exitCode = 1;
      }
    }

    console.log("Plan version immutability tests finished.");
  }
})();
