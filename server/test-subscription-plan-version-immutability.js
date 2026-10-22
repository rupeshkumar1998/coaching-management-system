
// // require("dotenv").config();

// // const mongoose = require("mongoose");

// // const SubscriptionPlanVersion = require(
// //   "./models/SubscriptionPlanVersion"
// // );

// // const {
// //   getMandatoryFeatureKeys,
// // } = require("./constants/featureCatalog");

// // const runTest = async (name, fn) => {
// //   try {
// //     await fn();
// //     console.log(`PASS: ${name}`);
// //   } catch (error) {
// //     console.error(`FAIL: ${name}`);
// //     console.error(`  ${error.message}`);
// //     process.exitCode = 1;
// //   }
// // };

// // const createVersion = (status) => {
// //   const now = new Date();

// //   return new SubscriptionPlanVersion({
// //     planId: new mongoose.Types.ObjectId(),
// //     version: 1,
// //     status,
// //     amount: 999,
// //     currency: "INR",
// //     durationDays: 30,
// //     paymentRequired: true,

// //     features: getMandatoryFeatureKeys().map((key) => ({
// //       key,
// //       enabled: true,
// //     })),

// //     limits: [],

// //     publishedAt:
// //       status === "PUBLISHED" || status === "RETIRED"
// //         ? now
// //         : null,

// //     publishedBy:
// //       status === "PUBLISHED" || status === "RETIRED"
// //         ? new mongoose.Types.ObjectId()
// //         : null,

// //     retiredAt: status === "RETIRED" ? now : null,

// //     retiredBy:
// //       status === "RETIRED"
// //         ? new mongoose.Types.ObjectId()
// //         : null,
// //   });
// // };

// // const expectSaveRejected = async (doc) => {
// //   try {
// //     await doc.save();
// //   } catch (error) {
// //     if (
// //       error.message.includes(
// //         "Published or retired plan versions cannot be modified"
// //       )
// //     ) {
// //       return;
// //     }

// //     throw error;
// //   }

// //   throw new Error(
// //     "Modified published/retired version was saved"
// //   );
// // };

// // (async () => {
// //   let connected = false;
// //   const createdIds = [];

// //   try {
// //     if (!process.env.MONGO_URI) {
// //       throw new Error(
// //         "MONGO_URI is missing from the environment"
// //       );
// //     }

// //     await mongoose.connect(process.env.MONGO_URI);
// //     connected = true;

// //     await runTest(
// //       "Published version rejects price modification",
// //       async () => {
// //         const doc = createVersion("DRAFT");

// //         await doc.save();
// //         createdIds.push(doc._id);

// //         // Publish the draft and persist its audit fields.
// //         doc.status = "PUBLISHED";
// //         doc.publishedAt = new Date();
// //         doc.publishedBy = new mongoose.Types.ObjectId();

// //         await doc.save();

// //         // A subsequent price change must be rejected.
// //         doc.amount = 1499;

// //         await expectSaveRejected(doc);
// //       }
// //     );

// //     await runTest(
// //       "Retired version rejects price modification",
// //       async () => {
// //         const doc = createVersion("RETIRED");

// //         await doc.save();
// //         createdIds.push(doc._id);

// //         doc.amount = 1499;

// //         await expectSaveRejected(doc);
// //       }
// //     );
// //   } catch (error) {
// //     console.error("TEST SETUP ERROR:", error.message);
// //     process.exitCode = 1;
// //   } finally {
// //     if (connected) {
// //       try {
// //         if (createdIds.length > 0) {
// //           await SubscriptionPlanVersion.deleteMany({
// //             _id: { $in: createdIds },
// //           });
// //         }
// //       } catch (cleanupError) {
// //         console.error(
// //           "TEST CLEANUP ERROR:",
// //           cleanupError.message
// //         );
// //         process.exitCode = 1;
// //       }

// //       await mongoose.disconnect();
// //     }
// //   }

// //   console.log("Plan version immutability tests finished.");
// // })();




// require("dotenv").config();

// const mongoose = require("mongoose");

// const SubscriptionPlanVersion = require(
//   "./models/SubscriptionPlanVersion"
// );

// const {
//   getMandatoryFeatureKeys,
// } = require("./constants/featureCatalog");

// const createdIds = [];

// const runTest = async (name, fn) => {
//   try {
//     await fn();
//     console.log(`PASS: ${name}`);
//   } catch (error) {
//     console.error(`FAIL: ${name}`);
//     console.error(`  ${error.message}`);
//     process.exitCode = 1;
//   }
// };

// const createVersion = (status = "DRAFT") => {
//   const now = new Date();

//   return new SubscriptionPlanVersion({
//     planId: new mongoose.Types.ObjectId(),
//     version: 1,
//     status,
//     amount: 999,
//     currency: "INR",
//     durationDays: 30,
//     paymentRequired: true,

//     features: getMandatoryFeatureKeys().map((key) => ({
//       key,
//       enabled: true,
//     })),

//     limits: [],

//     publishedAt:
//       status === "PUBLISHED" || status === "RETIRED"
//         ? now
//         : null,

//     publishedBy:
//       status === "PUBLISHED" || status === "RETIRED"
//         ? new mongoose.Types.ObjectId()
//         : null,

//     retiredAt: status === "RETIRED" ? now : null,

//     retiredBy:
//       status === "RETIRED"
//         ? new mongoose.Types.ObjectId()
//         : null,
//   });
// };

// // const expectRejected = async (operation) => {
// //   try {
// //     await operation();
// //   } catch (error) {
// //     if (
// //       error.message.includes(
// //         "Published or retired plan versions cannot be modified"
// //       )
// //     ) {
// //       return;
// //     }

// //     throw error;
// //   }

// //   throw new Error("Protected update was unexpectedly accepted");
// // };

// // const expectRejected = async (operation) => {
// //   try {
// //     await operation();
// //   } catch (error) {
// //     "Aggregation-pipeline updates are not allowed for plan versions"
// //         const immutableVersionError =
// //       error.message.includes(
// //         "Published or retired plan versions cannot be modified"
// //       );

// //     const controlledLifecycleError =
// //       error.message.includes(
// //         "Plan version status must be changed through the controlled lifecycle service"
// //       );

// //     const bulkWriteDisabledError =
// //       error.message.includes(
// //         "bulkWrite is disabled for SubscriptionPlanVersion"
// //       );

// //       ////////
// //       const insertManyDisabledError =
// //   error.message.includes(
// //     "insertMany is disabled for SubscriptionPlanVersion"
// //   );



// //   // const insertOneDisabledError =
// //   // error.message.includes(
// //   //   "insertOne is disabled for SubscriptionPlanVersion"
// //   // );

// //   const directCreationError =
// //   error.message.includes(
// //     "New plan versions must be created as DRAFT"
// //   );

// //   ////////
// //     if (
// //         immutableVersionError ||
// //         controlledLifecycleError ||
// //         bulkWriteDisabledError ||
// //         insertManyDisabledError ||
// //         directCreationError

// //     ) {
// //       return;
// //     }

// //     throw error;
// //   }

// //   throw new Error("Protected update was unexpectedly accepted");
// // };

// const expectRejected = async (operation) => {
//   try {
//     await operation();
//   } catch (error) {
//     const acceptedErrors = [
//       "Aggregation-pipeline updates are not allowed for plan versions",
//       "Published or retired plan versions cannot be modified",
//       "Plan version status must be changed through the controlled lifecycle service",
//       "bulkWrite is disabled for SubscriptionPlanVersion",
//       "insertMany is disabled for SubscriptionPlanVersion",
//       "New plan versions must be created as DRAFT",
//     ];

//     const isExpectedError = acceptedErrors.some((message) =>
//       error.message.includes(message)
//     );

//     if (isExpectedError) {
//       return;
//     }

//     throw error;
//   }

//   throw new Error("Protected update was unexpectedly accepted");
// };



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

// ///////////////
// const createRetiredVersion = async () => {
//   const doc = createVersion("DRAFT");

//   await doc.save();
//   createdIds.push(doc._id);

//   doc.status = "RETIRED";
//   doc.retiredAt = new Date();
//   doc.retiredBy = new mongoose.Types.ObjectId();

//   await doc.save();

//   return doc;
// };
// ///////////



// (async () => {
//   let connected = false;

//   try {
//     if (!process.env.MONGO_URI) {
//       throw new Error("MONGO_URI is missing from .env");
//     }

//     await mongoose.connect(process.env.MONGO_URI);
//     connected = true;

//     await runTest(
//       "Published version rejects document save modification",
//       async () => {
//         const doc = await createPublishedVersion();
//         doc.amount = 1499;

//         await expectRejected(() => doc.save());
//       }
//     );

//     // await runTest(
//     //   "Retired version rejects document save modification",
//     //   async () => {
//     //     const doc = createVersion("RETIRED");
//     //     await doc.save();
//     //     createdIds.push(doc._id);

//     //     doc.amount = 1499;

//     //     await expectRejected(() => doc.save());
//     //   }
//     // );
//     await runTest(
//     "Retired version rejects document save modification",
//     async () => {
//     // First create and save a valid DRAFT.
//     const doc = createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     // Retire it after creation, following the lifecycle.
//     doc.status = "RETIRED";
//     doc.retiredAt = new Date();
//     doc.retiredBy = new mongoose.Types.ObjectId();

//     await doc.save();

//     // Existing RETIRED version must not be modified.
//     doc.amount = 1499;

//     await expectRejected(() => doc.save());
//     }
//    );

//     await runTest(
//       "updateOne rejects published version modification",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.updateOne(
//             { _id: doc._id },
//             { $set: { amount: 1499 } }
//           )
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );
// ////////////////
// await runTest(
//   "updateOne rejects retired version modification",
//   async () => {
//     const doc = await createRetiredVersion();

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         { $set: { amount: 1499 } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged) {
//       throw new Error("Retired version disappeared unexpectedly");
//     }

//     if (unchanged.amount !== 999) {
//       throw new Error(
//         "Retired version amount changed unexpectedly"
//       );
//     }
//   }
// );

// //////////////

//     await runTest(
//       "findOneAndUpdate rejects published version modification",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.findOneAndUpdate(
//             { _id: doc._id },
//             { $set: { amount: 1499 } },
//             { new: true }
//           )
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );
// ////////////////

// await runTest(
//   "findOneAndUpdate rejects retired version modification",
//   async () => {
//     const doc = await createRetiredVersion();

//     await expectRejected(() =>
//       SubscriptionPlanVersion.findOneAndUpdate(
//         { _id: doc._id },
//         { $set: { amount: 1499 } },
//         { new: true }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged) {
//       throw new Error("Retired version disappeared unexpectedly");
//     }

//     if (unchanged.amount !== 999) {
//       throw new Error(
//         "Retired version amount changed unexpectedly"
//       );
//     }
//   }
// );
// /////////////////////



//     await runTest(
//       "updateMany rejects published version modification",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.updateMany(
//             { _id: doc._id },
//             { $set: { amount: 1499 } }
//           )
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );
// ///////////////

// await runTest(
//   "updateMany rejects retired version modification",
//   async () => {
//     const doc = await createRetiredVersion();

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateMany(
//         { _id: doc._id },
//         { $set: { amount: 1499 } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged) {
//       throw new Error("Retired version disappeared unexpectedly");
//     }

//     if (unchanged.amount !== 999) {
//       throw new Error(
//         "Retired version amount changed unexpectedly"
//       );
//     }
//   }
// );

// /////////////////

//     await runTest(
//       "replaceOne rejects published version replacement",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.replaceOne(
//             { _id: doc._id },
//             {
//               planId: doc.planId,
//               version: doc.version,
//               status: "PUBLISHED",
//               amount: 1499,
//               currency: "INR",
//               durationDays: 30,
//               paymentRequired: true,
//               features: doc.features,
//               limits: [],
//               publishedAt: doc.publishedAt,
//               publishedBy: doc.publishedBy,
//             }
//           )
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );

//     await runTest(
//       "findOneAndReplace rejects published version replacement",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.findOneAndReplace(
//             { _id: doc._id },
//             {
//               planId: doc.planId,
//               version: doc.version,
//               status: "PUBLISHED",
//               amount: 1499,
//               currency: "INR",
//               durationDays: 30,
//               paymentRequired: true,
//               features: doc.features,
//               limits: [],
//               publishedAt: doc.publishedAt,
//               publishedBy: doc.publishedBy,
//             }
//           )
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );

//     await runTest(
//       "bulkWrite is blocked for plan versions",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.bulkWrite([
//             {
//               updateOne: {
//                 filter: { _id: doc._id },
//                 update: { $set: { amount: 1499 } },
//               },
//             },
//           ])
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (unchanged.amount !== 999) {
//           throw new Error(
//             "Published version amount changed unexpectedly"
//           );
//         }
//       }
//     );


// await runTest(
//   "insertMany is blocked for plan versions",
//   async () => {
//     const doc = createVersion("DRAFT");

//     await expectRejected(() =>
//       SubscriptionPlanVersion.insertMany([doc])
//     );

//     const inserted = await SubscriptionPlanVersion.findById(
//       doc._id
//     );

//     if (inserted) {
//       throw new Error(
//         "insertMany inserted a plan version unexpectedly"
//       );
//     }
//   }
// );



// // await runTest(
// //   "insertOne is blocked for plan versions",
// //   async () => {
// //     const doc = createVersion("DRAFT");

// //     await expectRejected(() =>
// //       SubscriptionPlanVersion.insertOne(doc)
// //     );

// //     const inserted = await SubscriptionPlanVersion.findById(
// //       doc._id
// //     );

// //     if (inserted) {
// //       throw new Error(
// //         "insertOne inserted a plan version unexpectedly"
// //       );
// //     }
// //   }
// // );
// await runTest(
//   "insertOne rejects direct published-version creation",
//   async () => {
//     const doc = createVersion("PUBLISHED");

//     await expectRejected(() =>
//       SubscriptionPlanVersion.insertOne(doc)
//     );

//     const inserted = await SubscriptionPlanVersion.findById(
//       doc._id
//     );

//     if (inserted) {
//       throw new Error(
//         "Direct published-version creation was accepted"
//       );
//     }
//   }
// );



//     await runTest(
//       "deleteOne rejects published version deletion",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.deleteOne({
//             _id: doc._id,
//           })
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (!unchanged) {
//           throw new Error(
//             "Published version was deleted unexpectedly"
//           );
//         }
//       }
//     );

//     await runTest(
//       "deleteMany rejects published version deletion",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.deleteMany({
//             _id: doc._id,
//           })
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (!unchanged) {
//           throw new Error(
//             "Published version was deleted unexpectedly"
//           );
//         }
//       }
//     );

//     await runTest(
//       "findOneAndDelete rejects published version deletion",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() =>
//           SubscriptionPlanVersion.findOneAndDelete({
//             _id: doc._id,
//           })
//         );

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (!unchanged) {
//           throw new Error(
//             "Published version was deleted unexpectedly"
//           );
//         }
//       }
//     );

//     await runTest(
//       "document deleteOne rejects published version deletion",
//       async () => {
//         const doc = await createPublishedVersion();

//         await expectRejected(() => doc.deleteOne());

//         const unchanged =
//           await SubscriptionPlanVersion.findById(doc._id);

//         if (!unchanged) {
//           throw new Error(
//             "Published version was deleted unexpectedly"
//           );
//         }
//       }
//     );

// ///////////////////

// await runTest(
//   "Query update cannot publish a draft version directly",
//   async () => {
//     const doc = await createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         { $set: { status: "PUBLISHED" } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Draft version status changed unexpectedly");
//     }
//   }
// );

// await runTest(
//   "Query update cannot retire a draft version directly",
//   async () => {
//     const doc = await createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         { $set: { status: "RETIRED" } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Draft version status changed unexpectedly");
//     }
//   }
// );

// ///////////////////////



//   } catch (error) {
//     console.error("TEST SETUP ERROR:", error.message);
//     process.exitCode = 1;
//   } finally {
//     if (connected) {
//       try {
//         if (createdIds.length > 0) {
//           await SubscriptionPlanVersion.collection.deleteMany({
//             _id: { $in: createdIds },
//           });
//         }
//       } catch (error) {
//         console.error("TEST CLEANUP ERROR:", error.message);
//         process.exitCode = 1;
//       }

//       await mongoose.disconnect();
//     }




// await runTest(
//   "updateOne rejects status removal with $unset",
//   async () => {
//     const doc = createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         { $unset: { status: 1 } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Draft status was unexpectedly removed");
//     }
//   }
// );

// await runTest(
//   "findOneAndUpdate rejects direct status change",
//   async () => {
//     const doc = createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.findOneAndUpdate(
//         { _id: doc._id },
//         { $set: { status: "PUBLISHED" } },
//         { new: true }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Draft status changed unexpectedly");
//     }
//   }
// );

// await runTest(
//   "updateMany rejects direct status change",
//   async () => {
//     const doc = createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateMany(
//         { _id: doc._id },
//         { $set: { status: "RETIRED" } }
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Draft status changed unexpectedly");
//     }
//   }
// );

// await runTest(
//   "Aggregation pipeline updates are rejected",
//   async () => {
//     const doc = createVersion("DRAFT");
//     await doc.save();
//     createdIds.push(doc._id);

//     await expectRejected(() =>
//       SubscriptionPlanVersion.updateOne(
//         { _id: doc._id },
//         [
//           { $set: { status: "PUBLISHED" } }
//         ]
//       )
//     );

//     const unchanged =
//       await SubscriptionPlanVersion.findById(doc._id);

//     if (!unchanged || unchanged.status !== "DRAFT") {
//       throw new Error("Pipeline unexpectedly changed draft status");
//     }
//   }
// );



//     console.log("Plan version immutability tests finished.");
//   }


// })();

// File: server/test-subscription-plan-version-immutability.js

require("dotenv").config();

const mongoose = require("mongoose");

const SubscriptionPlanVersion = require(
  "./models/SubscriptionPlanVersion"
);

const SubscriptionPlan = require("./models/SubscriptionPlan");

const {
  publishPlanVersion,
  retirePublishedPlanVersion,
} = require("./services/subscriptionPlanVersionService");



const {
  getMandatoryFeatureKeys,
} = require("./constants/featureCatalog");

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
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from .env");
    }

    //await mongoose.connect(process.env.MONGO_URI);

const TEST_DB_NAME = "coaching_management_test";

const testUri = new URL(process.env.MONGO_URI);
testUri.pathname = `/${TEST_DB_NAME}`;

const actualDbName = testUri.pathname.replace(/^\/+/, "");

if (actualDbName !== TEST_DB_NAME) {
  throw new Error(
    `Unsafe test database: ${actualDbName}`
  );
}

console.log("Connecting to isolated test database:", actualDbName);

await mongoose.connect(testUri.toString());

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
