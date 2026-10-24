
const mongoose = require("mongoose");

const PlatformTrialOffer = require(
  "./models/PlatformTrialOffer"
);

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

const validOffer = () =>
  new PlatformTrialOffer({
    version: 1,
    status: "DRAFT",
    enabled: false,
    planId: new mongoose.Types.ObjectId(),
    planVersionId: new mongoose.Types.ObjectId(),
    durationDays: 14,
    eligibility: "NEW_INSTITUTES_ONLY",
    createdBy: new mongoose.Types.ObjectId(),
    updatedBy: new mongoose.Types.ObjectId(),
  });

const expectValidationFailure = async (
  doc,
  expectedMessage
) => {
  try {
    await doc.validate();
  } catch (error) {
    if (
      !expectedMessage ||
      error.message.includes(expectedMessage) ||
      Object.values(error.errors || {}).some(
        (item) =>
          item.message &&
          item.message.includes(expectedMessage)
      )
    ) {
      return;
    }

    throw error;
  }

  throw new Error("Invalid offer was accepted");
};

(async () => {
  await runTest(
    "Valid disabled draft passes validation",
    async () => {
      await validOffer().validate();
    }
  );

  await runTest(
    "New PUBLISHED offer is rejected",
    async () => {
      const doc = validOffer();

      doc.status = "PUBLISHED";
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();

      await expectValidationFailure(
        doc,
        "must start as DRAFT"
      );
    }
  );

  await runTest(
    "New RETIRED offer is rejected",
    async () => {
      const doc = validOffer();

      doc.status = "RETIRED";
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();
      doc.retiredAt = new Date();
      doc.retiredBy = new mongoose.Types.ObjectId();

      await expectValidationFailure(
        doc,
        "must start as DRAFT"
      );
    }
  );

  await runTest(
    "Version must be positive",
    async () => {
      const doc = validOffer();
      doc.version = 0;

      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Duration must be at least one day",
    async () => {
      const doc = validOffer();
      doc.durationDays = 0;

      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Fractional duration is rejected",
    async () => {
      const doc = validOffer();
      doc.durationDays = 1.5;

      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Unsupported eligibility policy is rejected",
    async () => {
      const doc = validOffer();
      doc.eligibility = "ALL_INSTITUTES";

      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Draft cannot be enabled",
    async () => {
      const doc = validOffer();
      doc.enabled = true;

      await expectValidationFailure(
        doc,
        "must start disabled"
      );
    }
  );

  await runTest(
    "Published offer requires publication metadata",
    async () => {
      const doc = validOffer();

      doc.isNew = false;
      doc.status = "PUBLISHED";
      doc.publishedAt = null;
      doc.publishedBy = null;

      await expectValidationFailure(
        doc,
        "requires publishedAt and publishedBy"
      );
    }
  );

  await runTest(
    "Retired offer requires retirement metadata",
    async () => {
      const doc = validOffer();

      doc.isNew = false;
      doc.status = "RETIRED";
      doc.enabled = false;
      doc.retiredAt = null;
      doc.retiredBy = null;

      await expectValidationFailure(
        doc,
        "requires retiredAt and retiredBy"
      );
    }
  );

  // Security tests: invoke registered middleware directly.
  // These tests do not connect to MongoDB.

  const findPreHook = (operation, sourceText) => {
    const hooks =
      PlatformTrialOffer.schema.s.hooks._pres.get(operation) || [];

    const hook = hooks.find(({ fn }) =>
      fn.toString().includes(sourceText)
    );

    if (!hook) {
      throw new Error(
        `Expected security hook not found for ${operation}`
      );
    }

    return hook.fn;
  };

  const expectHookFailure = async (
    hook,
    context,
    expectedMessage
  ) => {
    try {
      await hook.call(context);
    } catch (error) {
      if (error.message.includes(expectedMessage)) {
        return;
      }

      throw error;
    }

    throw new Error(
      `Expected hook to reject with: ${expectedMessage}`
    );
  };

  await runTest(
    "Direct insertOne is blocked",
    async () => {
      try {
        await PlatformTrialOffer.insertOne({});
      } catch (error) {
        if (error.message.includes("insertOne is disabled")) {
          return;
        }

        throw error;
      }

      throw new Error("Direct insertOne was not blocked");
    }
  );

  await runTest(
    "insertMany middleware blocks direct insertion",
    async () => {
      await expectHookFailure(
        findPreHook("insertMany", "Use the platform trial offer service"),
        {},
        "Use the platform trial offer service"
      );
    }
  );

  await runTest(
    "bulkWrite middleware blocks bulk operations",
    async () => {
      await expectHookFailure(
        findPreHook("bulkWrite", "bulkWrite is disabled"),
        {},
        "bulkWrite is disabled"
      );
    }
  );

//   for (const operation of [
//     "updateOne",
//     "updateMany",
//     "findOneAndUpdate",
//     "replaceOne",
//     "findOneAndReplace",
//   ]) {
//     await runTest(
//       `${operation} blocks direct enabled changes`,
//       async () => {
//         const hook = findPreHook(
//           operation,
//           "Direct query update of"
//         );

//         const context = {
//           getUpdate: () => ({
//             $set: { enabled: true },
//           }),
//           getOptions: () => ({}),
//         };

//         await expectHookFailure(
//           hook,
//           context,
//           "Direct query update of enabled"
//         );
//       }
//     );
//   }

//   await runTest(
//     "Query update pipelines are blocked",
//     async () => {
//       const hook = findPreHook(
//         "findOneAndUpdate",
//         "Update pipelines are not allowed"
//       );

//       await expectHookFailure(
//         hook,
//         {
//           getUpdate: () => [{ $set: { enabled: true } }],
//           getOptions: () => ({}),
//         },
//         "Update pipelines are not allowed"
//       );
//     }
//   );

//   await runTest(
//     "Query update upserts are blocked",
//     async () => {
//       const hook = findPreHook(
//         "updateOne",
//         "Upsert is not allowed"
//       );

//       await expectHookFailure(
//         hook,
//         {
//           getUpdate: () => ({ $set: { description: "test" } }),
//           getOptions: () => ({ upsert: true }),
//         },
//         "Upsert is not allowed"
//       );
//     }
//   );

  for (const operation of [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
  ]) {
    await runTest(
      `${operation} is blocked`,
      async () => {
        const hook = findPreHook(
          operation,
          "Direct query updates are disabled"
        );

        await expectHookFailure(
          hook,
          {
            getUpdate: () => ({
              $set: {
                enabled: true,
                updatedBy: new mongoose.Types.ObjectId(),
              },
            }),
            getOptions: () => ({}),
          },
          "Direct query updates are disabled"
        );
      }
    );
  }

  await runTest(
    "Query update pipelines are blocked",
    async () => {
      const hook = findPreHook(
        "findOneAndUpdate",
        "Direct query updates are disabled"
      );

      await expectHookFailure(
        hook,
        {
          getUpdate: () => [
            { $set: { enabled: true } },
          ],
          getOptions: () => ({}),
        },
        "Direct query updates are disabled"
      );
    }
  );

  await runTest(
    "Query update upserts are blocked",
    async () => {
      const hook = findPreHook(
        "updateOne",
        "Direct query updates are disabled"
      );

      await expectHookFailure(
        hook,
        {
          getUpdate: () => ({
            $set: {
              updatedBy: new mongoose.Types.ObjectId(),
            },
          }),
          getOptions: () => ({ upsert: true }),
        },
        "Direct query updates are disabled"
      );
    }
  );



  // Additional lifecycle and immutability security tests.
  const makeExistingOffer = (status = "PUBLISHED") => {
    const doc = validOffer();

    // Simulate a document loaded from MongoDB:
    // clear constructor-time modified paths before setting the baseline.
    doc.$__reset();

    doc.isNew = false;

    doc.status = status;
    doc.enabled = status === "PUBLISHED";

    if (status === "PUBLISHED") {
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();
    }

    if (status === "RETIRED") {
      doc.retiredAt = new Date();
      doc.retiredBy = new mongoose.Types.ObjectId();
    }

    // Reset again so these values represent the persisted baseline.
    doc.$__reset();

    doc.$locals.originalStatus = doc.status;
    doc.$locals.originalEnabled = doc.enabled;

    return doc;
  };


  const runSaveHook = async (doc) => {
    const hook = findPreHook("save", "originalStatus");

    await hook.call(doc);
  };

  await runTest(
    "Unauthorized DRAFT to PUBLISHED transition is blocked",
    async () => {
      const doc = makeExistingOffer("DRAFT");

      doc.status = "PUBLISHED";
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();

      await expectHookFailure(
        findPreHook("save", "originalStatus"),
        doc,
        "lifecycle changes must use the lifecycle service"
      );
    }
  );

  await runTest(
    "Unauthorized PUBLISHED to RETIRED transition is blocked",
    async () => {
      const doc = makeExistingOffer("PUBLISHED");

      doc.status = "RETIRED";
      doc.enabled = false;
      doc.retiredAt = new Date();
      doc.retiredBy = new mongoose.Types.ObjectId();

      await expectHookFailure(
        findPreHook("save", "originalStatus"),
        doc,
        "lifecycle changes must use the lifecycle service"
      );
    }
  );

  await runTest(
    "Published offer duration cannot be changed",
    async () => {
      const doc = makeExistingOffer("PUBLISHED");

      doc.durationDays = 30;

      await expectHookFailure(
        findPreHook("save", "originalStatus"),
        doc,
        "configuration is immutable"
      );
    }
  );

  await runTest(
    "Unauthorized published offer enable/disable is blocked",
    async () => {
      const doc = makeExistingOffer("PUBLISHED");

      doc.enabled = false;

      await expectHookFailure(
        findPreHook("save", "originalStatus"),
        doc,
        "enable/disable changes must use the offer service"
      );
    }
  );


  await runTest(
    "Offer deletion is blocked",
    async () => {
      await expectHookFailure(
        findPreHook("deleteOne", "cannot be deleted"),
        {},
        "cannot be deleted"
      );
    }
  );

  console.log(
    "\nPlatform trial offer model and security tests completed."
  );
})();
