
const {
  validateFeatures,
  validateLimits,
  validateEntitlementConfiguration,
  getCatalogSummary,
} = require("./services/entitlementCatalogService");

const {
  getMandatoryFeatureKeys,
} = require("./constants/featureCatalog");



const {
  FEATURE_CATALOG,
} = require("./constants/featureCatalog");




const results = [];

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectError = (code, fn) => {
  try {
    fn();
  } catch (error) {
    assert(
      error.code === code,
      `Expected ${code}, received ${error.code}: ${error.message}`
    );
    return;
  }

  throw new Error(`Expected error ${code}, but none was thrown`);
};

const runTest = (name, fn) => {
  try {
    fn();
    results.push({ test: name, status: "PASS" });
    console.log(`PASS: ${name}`);
  } catch (error) {
    results.push({
      test: name,
      status: "FAIL",
      error: error.message,
    });
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

const validFeatures = () => [
  ...getMandatoryFeatureKeys().map((key) => ({
    key,
    enabled: true,
  })),
  { key: "STUDENT_MANAGEMENT", enabled: true },
  { key: "TEACHER_MANAGEMENT", enabled: true },
  { key: "EXAM_TEST_MANAGEMENT", enabled: true },
  { key: "SMS", enabled: true },
  { key: "WHATSAPP", enabled: true },
  { key: "EMAIL_NOTIFICATIONS", enabled: true },
  { key: "API_ACCESS", enabled: true },
  { key: "LEAD_MANAGEMENT", enabled: true },
  { key: "STUDY_MATERIAL", enabled: true },
];

runTest("Catalog exposes expected categories", () => {
  const summary = getCatalogSummary();

  assert(summary.coreFeatures.length === 9, "Expected 9 core features");
  assert(summary.commercialFeatures.length === 24, "Expected 24 commercial features");
  assert(summary.limits.length === 13, "Expected 13 limits");
});

runTest("Valid feature configuration passes", () => {
  const result = validateFeatures(validFeatures());

  assert(result.length === 18, "Unexpected normalized feature count");
});

runTest("Unknown feature is rejected", () => {
  expectError("UNKNOWN_FEATURE", () =>
    validateFeatures([
      ...validFeatures(),
      { key: "MADE_UP_FEATURE", enabled: true },
    ])
  );
});


//////////////
// runTest("Inactive feature is rejected", () => {
//   const original = FEATURE_CATALOG.STUDENT_MANAGEMENT.isActive;

//   try {
//     FEATURE_CATALOG.STUDENT_MANAGEMENT.isActive = false;

//     expectError("INACTIVE_FEATURE", () =>
//       validateFeatures(validFeatures())
//     );
//   } finally {
//     FEATURE_CATALOG.STUDENT_MANAGEMENT.isActive = original;
//   }
// });
//////////////

runTest("Mandatory security feature cannot be disabled", () => {
  const features = validFeatures().map((item) =>
    item.key === "TENANT_ISOLATION"
      ? { ...item, enabled: false }
      : item
  );

  expectError("CORE_FEATURE_CANNOT_BE_DISABLED", () =>
    validateFeatures(features)
  );
});

runTest("Missing mandatory feature is rejected", () => {
  const features = validFeatures().filter(
    (item) => item.key !== "AUTHENTICATION"
  );

  expectError("MISSING_CORE_FEATURE", () =>
    validateFeatures(features)
  );
});

runTest("Duplicate feature is rejected", () => {
  expectError("DUPLICATE_FEATURE", () =>
    validateFeatures([
      ...validFeatures(),
      { key: "STUDENT_MANAGEMENT", enabled: false },
    ])
  );
});

runTest("Feature enabled value must be boolean", () => {
  const features = validFeatures().map((item) =>
    item.key === "STUDENT_MANAGEMENT"
      ? { ...item, enabled: "true" }
      : item
  );

  expectError("INVALID_FEATURE_VALUE", () =>
    validateFeatures(features)
  );
});

runTest("Zero and null limits are accepted", () => {
  const features = validateFeatures(validFeatures());

  const limits = validateLimits(
    [
      { key: "MAX_STUDENTS", value: 0 },
      { key: "MAX_TEACHERS", value: null },
    ],
    features
  );

  assert(limits[0].value === 0, "Zero must mean no usage allowed");
  assert(limits[1].value === null, "Null must mean unlimited");
});

runTest("Negative limit is rejected", () => {
  const features = validateFeatures(validFeatures());

  expectError("INVALID_LIMIT_VALUE", () =>
    validateLimits(
      [{ key: "MAX_STUDENTS", value: -1 }],
      features
    )
  );
});

runTest("Fractional limit is rejected", () => {
  const features = validateFeatures(validFeatures());

  expectError("INVALID_LIMIT_VALUE", () =>
    validateLimits(
      [{ key: "MAX_STUDENTS", value: 1.5 }],
      features
    )
  );
});

runTest("Unknown limit is rejected", () => {
  const features = validateFeatures(validFeatures());

  expectError("UNKNOWN_LIMIT", () =>
    validateLimits(
      [{ key: "MAX_UNKNOWN", value: 10 }],
      features
    )
  );
});

runTest("Duplicate limit is rejected", () => {
  const features = validateFeatures(validFeatures());

  expectError("DUPLICATE_LIMIT", () =>
    validateLimits(
      [
        { key: "MAX_STUDENTS", value: 10 },
        { key: "MAX_STUDENTS", value: 20 },
      ],
      features
    )
  );
});

runTest("Limit requires its feature to be enabled", () => {
  const features = validateFeatures(
    validFeatures().map((item) =>
      item.key === "SMS"
        ? { ...item, enabled: false }
        : item
    )
  );

  expectError("LIMIT_REQUIRES_FEATURE", () =>
    validateLimits(
      [{ key: "MAX_SMS_PER_MONTH", value: 100 }],
      features
    )
  );
});

runTest("Complete valid entitlement configuration passes", () => {
  const result = validateEntitlementConfiguration({
    features: validFeatures(),
    limits: [
      { key: "MAX_STUDENTS", value: 500 },
      { key: "MAX_SMS_PER_MONTH", value: 1000 },
      { key: "MAX_API_REQUESTS_PER_MONTH", value: null },
    ],
  });

  assert(result.features.length === 18, "Feature count mismatch");
  assert(result.limits.length === 3, "Limit count mismatch");
});





const {
  LIMIT_CATALOG,
  getLimitDefinition,
  isKnownLimit,
} = require("./constants/limitCatalog");

const {
  isKnownFeature,
} = require("./constants/featureCatalog");

runTest("Every limit has a valid definition", () => {
  const limits = Object.entries(LIMIT_CATALOG);

  assert(limits.length === 13, "Expected exactly 13 limits");

  for (const [catalogKey, limit] of limits) {
    assert(
      catalogKey === limit.key,
      `Catalog key mismatch: ${catalogKey}`
    );

    assert(
      typeof limit.name === "string" && limit.name.trim().length > 0,
      `Missing name for ${catalogKey}`
    );

    assert(
      typeof limit.unit === "string" && limit.unit.trim().length > 0,
      `Missing unit for ${catalogKey}`
    );

    assert(
      isKnownFeature(limit.requiredFeature),
      `Unknown required feature for ${catalogKey}: ${limit.requiredFeature}`
    );
  }
});

runTest("Every limit has a supported period", () => {
  const supportedPeriods = new Set([
    "LIFETIME_CURRENT",
    "CALENDAR_MONTH_UTC",
    "CURRENT_USAGE",
  ]);

  for (const limit of Object.values(LIMIT_CATALOG)) {
    assert(
      supportedPeriods.has(limit.period),
      `Unsupported period for ${limit.key}: ${limit.period}`
    );
  }
});

runTest("Limit lookup handles valid and invalid keys", () => {
  assert(
    getLimitDefinition("MAX_STUDENTS") !== null,
    "Known limit should be found"
  );

  assert(
    getLimitDefinition(" max_students ") !== null,
    "Lookup should trim whitespace and normalize case"
  );

  assert(
    getLimitDefinition("UNKNOWN_LIMIT") === null,
    "Unknown limit should return null"
  );

  assert(
    getLimitDefinition(null) === null,
    "Non-string key should return null"
  );

  assert(
    isKnownLimit("MAX_SMS_PER_MONTH"),
    "Known SMS limit should be recognized"
  );

  assert(
    !isKnownLimit("UNKNOWN_LIMIT"),
    "Unknown limit should not be recognized"
  );
});

console.log("\n-------------------------------");

const passed = results.filter((item) => item.status === "PASS").length;
const failed = results.filter((item) => item.status === "FAIL").length;

console.log(`Entitlement Catalog Tests: ${passed} PASS / ${failed} FAIL`);
console.log("-------------------------------");

if (failed > 0) {
  process.exitCode = 1;
}