const mongoose = require("mongoose");

const SubscriptionPlanVersion = require(
  "../../models/SubscriptionPlanVersion"
);

const {
  getMandatoryFeatureKeys,
  FEATURE_CATALOG,
} = require("../../constants/featureCatalog");

const {
  LIMIT_CATALOG,
} = require("../../constants/limitCatalog");

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

const expectValidationFailure = async (doc) => {
  try {
    await doc.validate();
  } catch (error) {
    return;
  }

  throw new Error("Invalid configuration was accepted");
};

const getOptionalFeatureKey = () =>
  Object.keys(FEATURE_CATALOG).find(
    (key) => !FEATURE_CATALOG[key].mandatory
  );

const getFeatureRequiredByLimit = () =>
  Object.entries(LIMIT_CATALOG).find(
    ([, definition]) => definition.requiredFeature
  );

(async () => {
  // Commercial configuration validation tests.

  await runTest(
    "Amount with two decimal places is accepted",
    async () => {
      const doc = validVersion();
      doc.amount = 999.50;
      await doc.validate();
    }
  );

  await runTest(
    "Amount with more than two decimal places is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = 999.999;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "NaN amount is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = NaN;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Infinite amount is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = Infinity;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Currency is normalized to uppercase INR",
    async () => {
      const doc = validVersion();
      doc.currency = " inr ";

      await doc.validate();

      if (doc.currency !== "INR") {
        throw new Error("Currency was not normalized to INR");
      }
    }
  );

  await runTest(
    "Unsupported currency is rejected",
    async () => {
      const doc = validVersion();
      doc.currency = "USD";
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Null duration is accepted",
    async () => {
      const doc = validVersion();
      doc.durationDays = null;
      await doc.validate();
    }
  );

  await runTest(
    "Zero duration is rejected",
    async () => {
      const doc = validVersion();
      doc.durationDays = 0;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Negative duration is rejected",
    async () => {
      const doc = validVersion();
      doc.durationDays = -5;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Fractional duration is rejected",
    async () => {
      const doc = validVersion();
      doc.durationDays = 2.5;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Payment-required plan with zero amount is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = 0;
      doc.paymentRequired = true;
      await expectValidationFailure(doc);
    }
  );

  await runTest(
    "Non-payment plan with positive amount is rejected",
    async () => {
      const doc = validVersion();
      doc.amount = 999;
      doc.paymentRequired = false;
      await expectValidationFailure(doc);
    }
  );
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
          (
            error.message.includes("amount greater than 0") ||
            error.message.includes("Amount cannot be negative")
          );

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

  // await runTest(
  //   "Missing mandatory feature is rejected",
  //   async () => {
  //     const doc = validVersion();
  //     const mandatoryKeys = getMandatoryFeatureKeys();

  //     if (mandatoryKeys.length === 0) {
  //       throw new Error("No mandatory features found in catalog");
  //     }

  //     const missingKey = mandatoryKeys[0];

  //     doc.features = validFeatures().filter(
  //       (feature) => feature.key !== missingKey
  //     );

  //     try {
  //       await doc.validate();
  //     } catch (error) {
  //       if (
  //         error.code === "MISSING_CORE_FEATURE" &&
  //         error.message.includes("Mandatory core feature is missing")
  //       ) {
  //         return;
  //       }

  //       throw error;
  //     }

  //     throw new Error("Missing mandatory feature was accepted");
  //   }
  // );

  // await runTest(
  //   "Core feature cannot be disabled",
  //   async () => {
  //     const doc = validVersion();
  //     const mandatoryKeys = getMandatoryFeatureKeys();

  //     if (mandatoryKeys.length === 0) {
  //       throw new Error("No mandatory features found in catalog");
  //     }

  //     const disabledKey = mandatoryKeys[0];

  //     doc.features = validFeatures().map((feature) =>
  //       feature.key === disabledKey
  //         ? { ...feature, enabled: false }
  //         : feature
  //     );

  //     try {
  //       await doc.validate();
  //     } catch (error) {
  //       if (
  //         error.code === "CORE_FEATURE_CANNOT_BE_DISABLED" ||
  //         error.message.includes("cannot be disabled")
  //       ) {
  //         return;
  //       }

  //       throw error;
  //     }

  //     throw new Error("Disabled core feature was accepted");
  //   }
  // );
  await runTest(
    "Every mandatory feature is required",
    async () => {
      const mandatoryKeys = getMandatoryFeatureKeys();

      if (mandatoryKeys.length === 0) {
        throw new Error("No mandatory features found in catalog");
      }

      for (const missingKey of mandatoryKeys) {
        const doc = validVersion();

        doc.features = validFeatures().filter(
          (feature) => feature.key !== missingKey
        );

        try {
          await doc.validate();
        } catch (error) {
          if (error.code === "MISSING_CORE_FEATURE") {
            continue;
          }

          throw new Error(
            `Unexpected error for missing ${missingKey}: ${error.message}`
          );
        }

        throw new Error(
          `Missing mandatory feature ${missingKey} was accepted`
        );
      }
    }
  );

  await runTest(
    "Every mandatory core feature cannot be disabled",
    async () => {
      const mandatoryKeys = getMandatoryFeatureKeys();

      if (mandatoryKeys.length === 0) {
        throw new Error("No mandatory features found in catalog");
      }

      for (const disabledKey of mandatoryKeys) {
        const doc = validVersion();

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
            continue;
          }

          throw new Error(
            `Unexpected error for disabled ${disabledKey}: ${error.message}`
          );
        }

        throw new Error(
          `Disabled mandatory feature ${disabledKey} was accepted`
        );
      }
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
