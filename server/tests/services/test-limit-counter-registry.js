const limitCounterRegistry = require("../../services/limitCounterRegistry");

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const expectThrow = (fn, expectedCode) => {
  let threw = false;
  let received = "";

  try {
    fn();
  } catch (error) {
    threw = true;
    received = error.code || "";
    if (expectedCode && error.code !== expectedCode) {
      throw new Error(
        `Expected error code "${expectedCode}", received "${error.code}" (${error.message})`
      );
    }
  }

  assert(threw, `Expected throw "${expectedCode}", but none occurred`);
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

// No DB connection required — registry is purely in-memory.

const makeConfig = (overrides = {}) => ({
  periodType: "LIFETIME_CURRENT",
  getCurrentUsage: async () => 0,
  ...overrides,
});

const run = async () => {
  try {
    // =====================================================
    // Section A — Registration validation (8 tests)
    // =====================================================

    await test("register() rejects empty limitKey", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () => limitCounterRegistry.register("", makeConfig()),
        "INVALID_LIMIT_KEY"
      );
    });

    await test("register() rejects whitespace limitKey", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () => limitCounterRegistry.register("   ", makeConfig()),
        "INVALID_LIMIT_KEY"
      );
    });

    await test("register() rejects unknown limit", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () =>
          limitCounterRegistry.register("MADE_UP", makeConfig()),
        "UNKNOWN_LIMIT"
      );
    });

    await test("register() rejects non-object config", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () => limitCounterRegistry.register("MAX_STUDENTS", null),
        "INVALID_COUNTER_CONFIG"
      );

      limitCounterRegistry.__resetForTests();
      expectThrow(
        () => limitCounterRegistry.register("MAX_STUDENTS", "bad"),
        "INVALID_COUNTER_CONFIG"
      );

      limitCounterRegistry.__resetForTests();
      expectThrow(
        () => limitCounterRegistry.register("MAX_STUDENTS", []),
        "INVALID_COUNTER_CONFIG"
      );
    });

    await test("register() rejects unsupported periodType", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () =>
          limitCounterRegistry.register(
            "MAX_STUDENTS",
            makeConfig({ periodType: "WEEKLY" })
          ),
        "UNSUPPORTED_PERIOD_TYPE"
      );
    });

    await test("register() rejects periodType not matching catalog", async () => {
      limitCounterRegistry.__resetForTests();

      // MAX_STUDENTS in catalog is LIFETIME_CURRENT.
      expectThrow(
        () =>
          limitCounterRegistry.register(
            "MAX_STUDENTS",
            makeConfig({ periodType: "CALENDAR_MONTH_UTC" })
          ),
        "PERIOD_TYPE_MISMATCH"
      );

      // MAX_SMS_PER_MONTH in catalog is CALENDAR_MONTH_UTC.
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () =>
          limitCounterRegistry.register(
            "MAX_SMS_PER_MONTH",
            makeConfig({ periodType: "LIFETIME_CURRENT" })
          ),
        "PERIOD_TYPE_MISMATCH"
      );
    });

    await test("register() rejects missing getCurrentUsage", async () => {
      limitCounterRegistry.__resetForTests();
      expectThrow(
        () =>
          limitCounterRegistry.register("MAX_STUDENTS", {
            periodType: "LIFETIME_CURRENT",
          }),
        "MISSING_GET_CURRENT_USAGE"
      );
    });

    await test("register() rejects duplicate registration", async () => {
      limitCounterRegistry.__resetForTests();
      const config = makeConfig();

      limitCounterRegistry.register("MAX_STUDENTS", config);

      expectThrow(
        () => limitCounterRegistry.register("MAX_STUDENTS", config),
        "COUNTER_ALREADY_REGISTERED"
      );
    });

    // =====================================================
    // Section B — Happy path (4 tests)
    // =====================================================

    await test("register() normalizes limitKey to uppercase", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("max_students", makeConfig());

      assert(
        limitCounterRegistry.has("MAX_STUDENTS"),
        "Should be registered under uppercase"
      );
      assert(
        limitCounterRegistry.has("max_students"),
        "Lookup should be case-insensitive"
      );
    });

    await test("register() trims whitespace in limitKey", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("  MAX_STUDENTS  ", makeConfig());

      assert(
        limitCounterRegistry.has("MAX_STUDENTS"),
        "Should be registered"
      );
    });

    await test("get() returns the frozen config", async () => {
      limitCounterRegistry.__resetForTests();
      const usageFn = async () => 42;

      limitCounterRegistry.register(
        "MAX_STUDENTS",
        makeConfig({ getCurrentUsage: usageFn })
      );

      const config = limitCounterRegistry.get("MAX_STUDENTS");

      assert(config, "Config should be present");
      assert(
        config.limitKey === "MAX_STUDENTS",
        "limitKey should be normalized"
      );
      assert(
        config.periodType === "LIFETIME_CURRENT",
        "periodType should match"
      );
      assert(
        config.getCurrentUsage === usageFn,
        "getCurrentUsage should be preserved"
      );
      assert(
        config.reconcile === null,
        "reconcile should default to null"
      );
    });

    await test("registered config is frozen", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());

      const config = limitCounterRegistry.get("MAX_STUDENTS");

      // Mutation attempt — should be no-op on a frozen object
      // in strict mode it would throw; here we simply verify
      // that the value is unchanged.
      try {
        config.periodType = "HACKED";
      } catch (_) {
        // ignore — strict-mode error is also acceptable
      }

      assert(
        config.periodType === "LIFETIME_CURRENT",
        "periodType must not be mutable"
      );
    });

    // =====================================================
    // Section C — Lookup (3 tests)
    // =====================================================

    await test("get() returns null for unregistered key", async () => {
      limitCounterRegistry.__resetForTests();

      assert(
        limitCounterRegistry.get("MAX_STUDENTS") === null,
        "Should be null"
      );
    });

    await test("get() returns null for invalid key types", async () => {
      limitCounterRegistry.__resetForTests();

      assert(limitCounterRegistry.get(null) === null, "null → null");
      assert(limitCounterRegistry.get(undefined) === null, "undefined → null");
      assert(limitCounterRegistry.get(123) === null, "number → null");
      assert(limitCounterRegistry.get("") === null, "empty → null");
      assert(limitCounterRegistry.get("   ") === null, "whitespace → null");
    });

    await test("has() mirrors get()", async () => {
      limitCounterRegistry.__resetForTests();

      assert(
        limitCounterRegistry.has("MAX_STUDENTS") === false,
        "Should be false before registration"
      );

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());

      assert(
        limitCounterRegistry.has("MAX_STUDENTS") === true,
        "Should be true after registration"
      );
    });

    // =====================================================
    // Section D — Introspection (3 tests)
    // =====================================================

    await test("getRegisteredLimitKeys() returns registered keys", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());
      limitCounterRegistry.register("MAX_TEACHERS", makeConfig());

      const keys = limitCounterRegistry.getRegisteredLimitKeys();

      assert(
        Array.isArray(keys),
        "Should return array"
      );
      assert(
        keys.length === 2,
        `Expected 2 keys, got ${keys.length}`
      );
      assert(keys.includes("MAX_STUDENTS"), "MAX_STUDENTS missing");
      assert(keys.includes("MAX_TEACHERS"), "MAX_TEACHERS missing");

      // Sorted
      assert(
        keys[0] === "MAX_STUDENTS" && keys[1] === "MAX_TEACHERS",
        "Keys should be sorted"
      );
    });

    await test("getUnregisteredLimitKeys() returns remaining catalog keys", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());

      const unregistered = limitCounterRegistry.getUnregisteredLimitKeys();

      assert(
        Array.isArray(unregistered),
        "Should return array"
      );
      assert(
        !unregistered.includes("MAX_STUDENTS"),
        "MAX_STUDENTS should not appear"
      );
      assert(
        unregistered.includes("MAX_TEACHERS"),
        "MAX_TEACHERS should appear"
      );
      assert(
        unregistered.includes("MAX_SMS_PER_MONTH"),
        "MAX_SMS_PER_MONTH should appear"
      );
    });

    await test("getUnregisteredLimitKeys() returns full catalog when empty", async () => {
      limitCounterRegistry.__resetForTests();

      const unregistered = limitCounterRegistry.getUnregisteredLimitKeys();

      // Catalog has 13 limits
      assert(
        unregistered.length === 13,
        `Expected 13 unregistered, got ${unregistered.length}`
      );
    });

    // =====================================================
    // Section E — Reconciliation hook (2 tests)
    // =====================================================

    await test("reconcile is preserved when provided", async () => {
      limitCounterRegistry.__resetForTests();
      const reconcileFn = async () => 100;

      limitCounterRegistry.register(
        "MAX_STUDENTS",
        makeConfig({ reconcile: reconcileFn })
      );

      const config = limitCounterRegistry.get("MAX_STUDENTS");

      assert(
        config.reconcile === reconcileFn,
        "reconcile should be preserved"
      );
    });

    await test("reconcile defaults to null when non-function", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register(
        "MAX_STUDENTS",
        makeConfig({ reconcile: "not-a-function" })
      );

      const config = limitCounterRegistry.get("MAX_STUDENTS");

      assert(
        config.reconcile === null,
        "reconcile should default to null"
      );
    });

    // =====================================================
    // Section F — Reset (2 tests)
    // =====================================================

    await test("__resetForTests() clears the registry", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());
      limitCounterRegistry.register("MAX_TEACHERS", makeConfig());

      assert(
        limitCounterRegistry.getRegisteredLimitKeys().length === 2,
        "Should have 2 keys"
      );

      limitCounterRegistry.__resetForTests();

      assert(
        limitCounterRegistry.getRegisteredLimitKeys().length === 0,
        "Should be empty after reset"
      );
    });

    await test("__resetForTests() allows re-registration", async () => {
      limitCounterRegistry.__resetForTests();

      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());
      limitCounterRegistry.__resetForTests();

      // Should not throw COUNTER_ALREADY_REGISTERED
      limitCounterRegistry.register("MAX_STUDENTS", makeConfig());

      assert(
        limitCounterRegistry.has("MAX_STUDENTS"),
        "Should be re-registered"
      );
    });
  } finally {
    limitCounterRegistry.__resetForTests();
  }

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) process.exitCode = 1;
};

run().catch((error) => {
  console.error("TEST SETUP ERROR:", error.message);
  process.exitCode = 1;
});