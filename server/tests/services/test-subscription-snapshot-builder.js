const {
  buildSubscriptionSnapshot,
} = require("../../services/subscriptionSnapshotBuilder");

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectThrow = (fn, expectedCode) => {
  let threw = false;
  let code = null;
  try {
    fn();
  } catch (e) {
    threw = true;
    code = e.code;
  }
  assert(threw, `Expected throw "${expectedCode}", succeeded`);
  if (expectedCode) {
    assert(
      code === expectedCode,
      `Expected code "${expectedCode}", got "${code}"`
    );
  }
};

const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

// Plain-object source (as if from .lean())
const makeVersion = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439011",
  version: 3,
  amount: 1999,
  currency: "INR",
  paymentRequired: true,
  durationDays: 30,
  features: [
    { key: "EXAM_TEST_MANAGEMENT", enabled: true },
    { key: "ANALYTICS", enabled: true },
    { key: "ONLINE_FEE_PAYMENT", enabled: false },
  ],
  limits: [
    { key: "MAX_STUDENTS", value: 1000 },
    { key: "MAX_TEACHERS", value: 50 },
  ],
  ...overrides,
});

// Fake Mongoose subdocument factory
const makeFakeMongooseFeature = (key, enabled) => ({
  key,
  enabled,
  _id: "some-internal-id",
  toObject() {
    return { key, enabled };
  },
});

const makeFakeMongooseLimit = (key, value) => ({
  key,
  value,
  _id: "some-internal-id",
  toObject() {
    return { key, value };
  },
});

const run = () => {
  // =====================================================
  // Section A — Happy path (plain object source)
  // =====================================================

  test("Happy path — STANDARD version snapshot", () => {
    const version = makeVersion();
    const result = buildSubscriptionSnapshot(version, "PRO");

    assert(result.plan === "PRO", `plan: ${result.plan}`);
    assert(result.planVersion === 3, `planVersion: ${result.planVersion}`);
    assert(
      result.planVersionId === version._id,
      "planVersionId mismatch"
    );
    assert(result.amount === 1999, `amount: ${result.amount}`);
    assert(result.currency === "INR", `currency: ${result.currency}`);
    assert(result.paymentRequired === true, "paymentRequired");
    assert(result.durationDays === 30, "durationDays");
    assert(result.features.length === 3, "features length");
    assert(result.limits.length === 2, "limits length");
    assert(
      result.snapshotCapturedAt instanceof Date,
      "snapshotCapturedAt should be Date"
    );
  });

  // =====================================================
  // Section B — Features and limits normalization
  // =====================================================

  test("Features are normalized to plain {key, enabled}", () => {
    const version = makeVersion({
      features: [
        { key: "  exam_test_management  ", enabled: true },
        { key: "analytics", enabled: false },
      ],
    });
    const result = buildSubscriptionSnapshot(version, "PRO");

    assert(
      result.features[0].key === "EXAM_TEST_MANAGEMENT",
      `Got: ${result.features[0].key}`
    );
    assert(
      result.features[0].enabled === true,
      "enabled"
    );
    assert(
      result.features[1].key === "ANALYTICS",
      `Got: ${result.features[1].key}`
    );
    assert(
      Object.keys(result.features[0]).length === 2,
      "No extra fields (no _id)"
    );
  });

  test("Limits are normalized to plain {key, value}", () => {
    const version = makeVersion({
      limits: [
        { key: "  max_students  ", value: 500 },
        { key: "MAX_TEACHERS", value: null },
      ],
    });
    const result = buildSubscriptionSnapshot(version, "PRO");

    assert(
      result.limits[0].key === "MAX_STUDENTS",
      `Got: ${result.limits[0].key}`
    );
    assert(result.limits[0].value === 500, "value");
    assert(
      result.limits[1].key === "MAX_TEACHERS",
      `Got: ${result.limits[1].key}`
    );
    assert(result.limits[1].value === null, "null value allowed");
  });

  test("Handles Mongoose subdocuments (with toObject)", () => {
    const version = makeVersion({
      features: [
        makeFakeMongooseFeature("EXAM_TEST_MANAGEMENT", true),
        makeFakeMongooseFeature("ANALYTICS", false),
      ],
      limits: [makeFakeMongooseLimit("MAX_STUDENTS", 1000)],
    });

    const result = buildSubscriptionSnapshot(version, "PRO");

    assert(
      result.features[0].key === "EXAM_TEST_MANAGEMENT",
      "features key"
    );
    assert(
      Object.keys(result.features[0]).length === 2,
      "No internal _id leaked"
    );
    assert(result.limits[0].value === 1000, "limits value");
    assert(
      Object.keys(result.limits[0]).length === 2,
      "No internal _id leaked from limits"
    );
  });

  test("Empty features array is allowed", () => {
    const version = makeVersion({ features: [] });
    const result = buildSubscriptionSnapshot(version, "PRO");
    assert(
      Array.isArray(result.features) && result.features.length === 0,
      "empty features"
    );
  });

  test("Empty limits array is allowed", () => {
    const version = makeVersion({ limits: [] });
    const result = buildSubscriptionSnapshot(version, "PRO");
    assert(
      Array.isArray(result.limits) && result.limits.length === 0,
      "empty limits"
    );
  });

  test("Null features/limits are treated as empty arrays", () => {
    const version = makeVersion({
      features: null,
      limits: null,
    });
    const result = buildSubscriptionSnapshot(version, "PRO");
    assert(
      Array.isArray(result.features) && result.features.length === 0,
      "null features → []"
    );
    assert(
      Array.isArray(result.limits) && result.limits.length === 0,
      "null limits → []"
    );
  });

  // =====================================================
  // Section C — capturedAt
  // =====================================================

  test("capturedAt defaults to now", () => {
    const before = Date.now();
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO");
    const after = Date.now();

    assert(
      result.snapshotCapturedAt instanceof Date,
      "should be Date"
    );
    const ts = result.snapshotCapturedAt.getTime();
    assert(
      ts >= before && ts <= after,
      `capturedAt ${ts} not between ${before} and ${after}`
    );
  });

  test("capturedAt honors explicit option", () => {
    const fixed = new Date("2026-01-15T10:30:00Z");
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      capturedAt: fixed,
    });
    assert(
      result.snapshotCapturedAt.getTime() === fixed.getTime(),
      "capturedAt must match"
    );
  });

  test("Invalid capturedAt (not a Date) falls back to now", () => {
    const before = Date.now();
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      capturedAt: "not-a-date",
    });
    const after = Date.now();
    assert(
      result.snapshotCapturedAt instanceof Date,
      "should be Date"
    );
    const ts = result.snapshotCapturedAt.getTime();
    assert(ts >= before && ts <= after, "should fall back to now");
  });

  // =====================================================
  // Section D — Overrides (TRIAL support)
  // =====================================================

  test("Override amount (TRIAL: force 0)", () => {
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      overrides: { amount: 0 },
    });
    assert(result.amount === 0, `amount: ${result.amount}`);
    // Source has 1999 but override wins
    assert(result.currency === "INR", "other fields untouched");
  });

  test("Override paymentRequired (TRIAL: force false)", () => {
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      overrides: { paymentRequired: false },
    });
    assert(result.paymentRequired === false, "paymentRequired override");
    assert(result.amount === 1999, "amount untouched");
  });

  test("Override durationDays (TRIAL: offer duration)", () => {
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      overrides: { durationDays: 14 },
    });
    assert(result.durationDays === 14, `durationDays: ${result.durationDays}`);
  });

  test("Multiple overrides applied together", () => {
    const result = buildSubscriptionSnapshot(makeVersion(), "PRO", {
      overrides: {
        amount: 0,
        paymentRequired: false,
        durationDays: 14,
      },
    });
    assert(result.amount === 0, "amount");
    assert(result.paymentRequired === false, "paymentRequired");
    assert(result.durationDays === 14, "durationDays");
  });

  // =====================================================
  // Section E — Validation errors
  // =====================================================

  test("Null planVersion → INVALID_PLAN_VERSION", () => {
    expectThrow(
      () => buildSubscriptionSnapshot(null, "PRO"),
      "INVALID_PLAN_VERSION"
    );
  });

  test("Plan version missing _id → INVALID_PLAN_VERSION", () => {
    const version = makeVersion();
    delete version._id;
    expectThrow(
      () => buildSubscriptionSnapshot(version, "PRO"),
      "INVALID_PLAN_VERSION"
    );
  });

  test("Plan version with invalid version number → INVALID_PLAN_VERSION", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ version: 0 }),
          "PRO"
        ),
      "INVALID_PLAN_VERSION"
    );
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ version: 1.5 }),
          "PRO"
        ),
      "INVALID_PLAN_VERSION"
    );
  });

  test("Plan version with negative amount → INVALID_PLAN_VERSION", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ amount: -1 }),
          "PRO"
        ),
      "INVALID_PLAN_VERSION"
    );
  });

  test("Plan version with missing currency → INVALID_PLAN_VERSION", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ currency: "" }),
          "PRO"
        ),
      "INVALID_PLAN_VERSION"
    );
  });

  test("Invalid planCode (empty) → INVALID_PLAN_CODE", () => {
    expectThrow(
      () => buildSubscriptionSnapshot(makeVersion(), ""),
      "INVALID_PLAN_CODE"
    );
    expectThrow(
      () => buildSubscriptionSnapshot(makeVersion(), "   "),
      "INVALID_PLAN_CODE"
    );
    expectThrow(
      () => buildSubscriptionSnapshot(makeVersion(), 123),
      "INVALID_PLAN_CODE"
    );
  });

  test("Features not an array → INVALID_FEATURES", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ features: "corrupted" }),
          "PRO"
        ),
      "INVALID_FEATURES"
    );
  });

  test("Invalid feature entry → INVALID_FEATURE_ENTRY", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({
            features: [{ key: "", enabled: true }],
          }),
          "PRO"
        ),
      "INVALID_FEATURE_ENTRY"
    );
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({
            features: [{ key: "SMS", enabled: "true" }],
          }),
          "PRO"
        ),
      "INVALID_FEATURE_ENTRY"
    );
  });

  test("Limits not an array → INVALID_LIMITS", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({ limits: "corrupted" }),
          "PRO"
        ),
      "INVALID_LIMITS"
    );
  });

  test("Invalid limit entry → INVALID_LIMIT_ENTRY", () => {
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({
            limits: [{ key: "MAX_STUDENTS", value: -1 }],
          }),
          "PRO"
        ),
      "INVALID_LIMIT_ENTRY"
    );
    expectThrow(
      () =>
        buildSubscriptionSnapshot(
          makeVersion({
            limits: [{ key: "MAX_STUDENTS", value: 1.5 }],
          }),
          "PRO"
        ),
      "INVALID_LIMIT_ENTRY"
    );
  });

  // =====================================================
  // Section F — Round-trip integrity
  // =====================================================

  test("Snapshot matches source version (round-trip)", () => {
    const version = makeVersion();
    const result = buildSubscriptionSnapshot(version, "PRO", {
      capturedAt: new Date("2026-01-01"),
    });

    // Financial
    assert(result.amount === version.amount, "amount");
    assert(result.currency === version.currency, "currency");
    assert(
      result.paymentRequired === version.paymentRequired,
      "paymentRequired"
    );
    assert(result.durationDays === version.durationDays, "durationDays");

    // Version identity
    assert(result.planVersion === version.version, "planVersion");
    assert(result.planVersionId === version._id, "planVersionId");

    // Features
    for (let i = 0; i < version.features.length; i++) {
      assert(
        result.features[i].key === version.features[i].key,
        `feature[${i}].key`
      );
      assert(
        result.features[i].enabled === version.features[i].enabled,
        `feature[${i}].enabled`
      );
    }

    // Limits
    for (let i = 0; i < version.limits.length; i++) {
      assert(
        result.limits[i].key === version.limits[i].key,
        `limit[${i}].key`
      );
      assert(
        result.limits[i].value === version.limits[i].value,
        `limit[${i}].value`
      );
    }
  });

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) process.exitCode = 1;
};

run();