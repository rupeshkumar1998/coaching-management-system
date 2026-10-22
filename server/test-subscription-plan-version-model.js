
// const mongoose = require("mongoose");

// const SubscriptionPlanVersion = require(
//   "./models/SubscriptionPlanVersion"
// );

// const {
//   getMandatoryFeatureKeys,
// } = require("./constants/featureCatalog");

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

// const validFeatures = () => [
//   ...getMandatoryFeatureKeys().map((key) => ({
//     key,
//     enabled: true,
//   })),
// ];

// const validVersion = () =>
//   new SubscriptionPlanVersion({
//     planId: new mongoose.Types.ObjectId(),
//     version: 1,
//     status: "DRAFT",
//     amount: 999,
//     currency: "INR",
//     durationDays: 30,
//     paymentRequired: true,
//     features: validFeatures(),
//     limits: [],
//   });

// (async () => {
//   await runTest("Valid draft version passes validation", async () => {
//     const doc = validVersion();
//     await doc.validate();
//   });


//   await runTest(
//     "New published version is rejected",
//     async () => {
//       const doc = validVersion();

//       doc.status = "PUBLISHED";
//       doc.publishedAt = new Date();
//       doc.publishedBy = new mongoose.Types.ObjectId();

//       try {
//         await doc.validate();
//       } catch (error) {
//         if (
//           error.message.includes(
//             "New plan versions must be created as DRAFT"
//           )
//         ) {
//           return;
//         }

//         throw error;
//       }

//       throw new Error(
//         "Direct published-version creation was accepted"
//       );
//     }
//   );

//   await runTest(
//     "New retired version is rejected",
//     async () => {
//       const doc = validVersion();

//       doc.status = "RETIRED";
//       doc.publishedAt = new Date();
//       doc.publishedBy = new mongoose.Types.ObjectId();
//       doc.retiredAt = new Date();
//       doc.retiredBy = new mongoose.Types.ObjectId();

//       try {
//         await doc.validate();
//       } catch (error) {
//         if (
//           error.message.includes(
//             "New plan versions must be created as DRAFT"
//           )
//         ) {
//           return;
//         }

//         throw error;
//       }

//       throw new Error(
//         "Direct retired-version creation was accepted"
//       );
//     }
//   );


//   await runTest("Version number must be positive", async () => {
//     const doc = validVersion();
//     doc.version = 0;

//     try {
//       await doc.validate();
//     } catch (error) {
//       if (error.errors.version) return;
//       throw error;
//     }

//     throw new Error("Invalid version number was accepted");
//   });


// await runTest("Negative price is rejected", async () => {
//   const doc = validVersion();
//   doc.amount = -1;

//   try {
//     await doc.validate();
//   } catch (error) {
//     const minError =
//       error.errors &&
//       error.errors.amount &&
//       error.errors.amount.kind === "min";

//     const customValidationError =
//       error.message &&
//       error.message.includes(
//         "amount greater than 0"
//       );

//     if (minError || customValidationError) {
//       return;
//     }

//     throw error;
//   }

//   throw new Error("Negative amount was accepted");
// });

//   await runTest("Free version must have zero amount", async () => {
//     const doc = validVersion();
//     doc.paymentRequired = false;
//     doc.amount = 999;

//     try {
//       await doc.validate();
//     } catch (error) {
//       if (error.message.includes("amount 0")) return;
//       throw error;
//     }

//     throw new Error("Invalid free version was accepted");
//   });

//   await runTest("Published version requires audit fields", async () => {
//     const doc = validVersion();
//     doc.status = "PUBLISHED";

//     try {
//       await doc.validate();
//     } catch (error) {
//       if (error.message.includes("publishedAt")) return;
//       throw error;
//     }

//     throw new Error("Missing publication audit was accepted");
//   });

//   await runTest("Unknown feature is rejected", async () => {
//     const doc = validVersion();
//     doc.features = [
//       ...validFeatures(),
//       { key: "UNKNOWN_FEATURE_X", enabled: true },
//     ];

//     try {
//       await doc.validate();
//     } catch (error) {
//       if (error.code === "UNKNOWN_FEATURE") return;
//       throw error;
//     }

//     throw new Error("Unknown feature was accepted");
//   });

//   console.log("Plan Version model validation tests finished.");
// })();


const mongoose = require("mongoose");

const SubscriptionPlanVersion = require(
  "./models/SubscriptionPlanVersion"
);

const {
  getMandatoryFeatureKeys,
  FEATURE_CATALOG,
} = require("./constants/featureCatalog");

const {
  LIMIT_CATALOG,
} = require("./constants/limitCatalog");

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

const validFeatures = () => [
  ...getMandatoryFeatureKeys().map((key) => ({
    key,
    enabled: true,
  })),
];

const validVersion = () =>
  new SubscriptionPlanVersion({
    planId: new mongoose.Types.ObjectId(),
    version: 1,
    status: "DRAFT",
    amount: 999,
    currency: "INR",
    durationDays: 30,
    paymentRequired: true,
    features: validFeatures(),
    limits: [],
  });

const getOptionalFeatureKey = () =>
  Object.keys(FEATURE_CATALOG).find(
    (key) => !FEATURE_CATALOG[key].mandatory
  );

const getFeatureRequiredByLimit = () =>
  Object.entries(LIMIT_CATALOG).find(
    ([, definition]) => definition.requiredFeature
  );

(async () => {
  await runTest(
    "Valid draft version passes validation",
    async () => {
      const doc = validVersion();
      await doc.validate();
    }
  );

  await runTest(
    "New published version is rejected",
    async () => {
      const doc = validVersion();

      doc.status = "PUBLISHED";
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.message.includes(
            "New plan versions must be created as DRAFT"
          )
        ) {
          return;
        }

        throw error;
      }

      throw new Error(
        "Direct published-version creation was accepted"
      );
    }
  );

  await runTest(
    "New retired version is rejected",
    async () => {
      const doc = validVersion();

      doc.status = "RETIRED";
      doc.publishedAt = new Date();
      doc.publishedBy = new mongoose.Types.ObjectId();
      doc.retiredAt = new Date();
      doc.retiredBy = new mongoose.Types.ObjectId();

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.message.includes(
            "New plan versions must be created as DRAFT"
          )
        ) {
          return;
        }

        throw error;
      }

      throw new Error(
        "Direct retired-version creation was accepted"
      );
    }
  );

  await runTest(
    "Version number must be positive",
    async () => {
      const doc = validVersion();
      doc.version = 0;

      try {
        await doc.validate();
      } catch (error) {
        if (error.errors && error.errors.version) return;
        throw error;
      }

      throw new Error("Invalid version number was accepted");
    }
  );

  await runTest(
    "Negative price is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = -1;

      try {
        await doc.validate();
      } catch (error) {
        const minError =
          error.errors &&
          error.errors.amount &&
          error.errors.amount.kind === "min";

        const customValidationError =
          error.message &&
          error.message.includes("amount greater than 0");

        if (minError || customValidationError) return;

        throw error;
      }

      throw new Error("Negative amount was accepted");
    }
  );

  await runTest(
    "Free version must have zero amount",
    async () => {
      const doc = validVersion();
      doc.paymentRequired = false;
      doc.amount = 999;

      try {
        await doc.validate();
      } catch (error) {
        if (error.message.includes("amount 0")) return;
        throw error;
      }

      throw new Error("Invalid free version was accepted");
    }
  );

  await runTest(
    "Published version requires audit fields",
    async () => {
      const doc = validVersion();
      doc.status = "PUBLISHED";

      try {
        await doc.validate();
      } catch (error) {
        if (error.message.includes("publishedAt")) return;
        throw error;
      }

      throw new Error("Missing publication audit was accepted");
    }
  );

  await runTest(
    "Unknown feature is rejected",
    async () => {
      const doc = validVersion();

      doc.features = [
        ...validFeatures(),
        {
          key: "UNKNOWN_FEATURE_X",
          enabled: true,
        },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (error.code === "UNKNOWN_FEATURE") return;
        throw error;
      }

      throw new Error("Unknown feature was accepted");
    }
  );

  await runTest(
    "Unknown limit is rejected",
    async () => {
      const doc = validVersion();

      doc.limits = [
        {
          key: "UNKNOWN_LIMIT_X",
          value: 10,
        },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (error.code === "UNKNOWN_LIMIT") return;
        throw error;
      }

      throw new Error("Unknown limit was accepted");
    }
  );

  await runTest(
    "Duplicate feature is rejected",
    async () => {
      const doc = validVersion();
      const feature = validFeatures()[0];

      doc.features = [
        ...validFeatures(),
        { ...feature },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (error.code === "DUPLICATE_FEATURE") return;
        throw error;
      }

      throw new Error("Duplicate feature was accepted");
    }
  );

  await runTest(
    "Duplicate limit is rejected",
    async () => {
      const doc = validVersion();

      // doc.features = [
      //   ...validFeatures(),
      //   {
      //     key: "STUDENT_MANAGEMENT",
      //     enabled: true,
      //   },
      // ];
            doc.features = validFeatures().map((feature) =>
        feature.key === "STUDENT_MANAGEMENT"
          ? { ...feature, enabled: true }
          : feature
      );

      if (
        !doc.features.some(
          (feature) => feature.key === "STUDENT_MANAGEMENT"
        )
      ) {
        doc.features.push({
          key: "STUDENT_MANAGEMENT",
          enabled: true,
        });
      }

      const limitKey = "MAX_STUDENTS";

      doc.limits = [
        { key: limitKey, value: 10 },
        { key: limitKey, value: 20 },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (error.code === "DUPLICATE_LIMIT") return;
        throw error;
      }

      throw new Error("Duplicate limit was accepted");
    }
  );

  await runTest(
    "Missing mandatory feature is rejected",
    async () => {
      const doc = validVersion();
      const mandatoryKeys = getMandatoryFeatureKeys();

      if (mandatoryKeys.length === 0) {
        throw new Error("No mandatory features found in catalog");
      }

      const missingKey = mandatoryKeys[0];

      doc.features = validFeatures().filter(
        (feature) => feature.key !== missingKey
      );

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.code === "MISSING_CORE_FEATURE" &&
          error.message.includes("Mandatory core feature is missing")
        ) {
          return;
        }

        throw error;
      }

      throw new Error("Missing mandatory feature was accepted");
    }
  );

  await runTest(
    "Core feature cannot be disabled",
    async () => {
      const doc = validVersion();
      const mandatoryKeys = getMandatoryFeatureKeys();

      if (mandatoryKeys.length === 0) {
        throw new Error("No mandatory features found in catalog");
      }

      const disabledKey = mandatoryKeys[0];

      doc.features = validFeatures().map((feature) =>
        feature.key === disabledKey
          ? { ...feature, enabled: false }
          : feature
      );

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.code === "CORE_FEATURE_CANNOT_BE_DISABLED" ||
          error.message.includes("cannot be disabled")
        ) {
          return;
        }

        throw error;
      }

      throw new Error("Disabled core feature was accepted");
    }
  );

  await runTest(
    "Invalid limit value is rejected",
    async () => {
      const doc = validVersion();
      const limitKey = Object.keys(LIMIT_CATALOG)[0];

      doc.limits = [
        {
          key: limitKey,
          value: -1,
        },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.code === "INVALID_LIMIT_VALUE" ||
          error.message.includes("non-negative") ||
          error.message.includes("safe integer")
        ) {
          return;
        }

        throw error;
      }

      throw new Error("Negative limit value was accepted");
    }
  );

  await runTest(
    "Limit requiring a feature rejects disabled feature",
    async () => {
      const doc = validVersion();
      const entry = getFeatureRequiredByLimit();

      if (!entry) {
        throw new Error(
          "No limit with requiredFeature exists in the catalog"
        );
      }

      const [limitKey, limitDefinition] = entry;
      const requiredFeature = limitDefinition.requiredFeature;

      if (!FEATURE_CATALOG[requiredFeature]) {
        throw new Error(
          `Catalog references unknown required feature: ${requiredFeature}`
        );
      }

      // doc.features = [
      //   ...validFeatures(),
      //   {
      //     key: requiredFeature,
      //     enabled: false,
      //   },
      // ];
      doc.features = validFeatures().map((feature) =>
        feature.key === requiredFeature
          ? { ...feature, enabled: false }
          : feature
      );

      if (
        !doc.features.some(
          (feature) => feature.key === requiredFeature
        )
      ) {
        doc.features.push({
          key: requiredFeature,
          enabled: false,
        });
      }
      ///////////////////

      doc.limits = [
        {
          key: limitKey,
          value: 10,
        },
      ];

      try {
        await doc.validate();
      } catch (error) {
        if (
          error.code === "LIMIT_REQUIRES_FEATURE" &&
          error.message.includes("requires enabled feature")
        ) {
          return;
        }

        throw error;
      }

      throw new Error(
        "Limit was accepted while its required feature was disabled"
      );
    }
  );

  console.log("Plan Version model validation tests finished.");
})();
