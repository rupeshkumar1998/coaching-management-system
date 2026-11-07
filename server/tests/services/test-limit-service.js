require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Teacher = require("../../models/Teacher");
const Institute = require("../../models/Institute");
const UsageCounter = require("../../models/UsageCounter");

const connectTestDB = require("../helpers/connectTestDB");
const subscriptionService = require("../../services/subscriptionService");
const limitCounterRegistry = require("../../services/limitCounterRegistry");
const limitService = require("../../services/limitService");
const { LIMIT_CATALOG } = require("../../constants/limitCatalog");

// =========================================================
// 32.16.15.11 — Limit Service: full test suite
//
// Coverage:
//   A. Input validators (.11.5)
//   B. Resolution (.11.6)
//   C. checkLimit core (.11.7)
//   D. Unlimited (.11.8)
//   E. Feature dependency (.11.9)
//   F. reserve/release (.11.10) — includes concurrency
//   G. Period logic (.11.11)
//   H. Bulk statuses (.11.13)
//   I. Tenant isolation
// =========================================================

const originalGetEffectiveSubscription =
  subscriptionService.getEffectiveSubscription;

const createdInstituteIds = [];
const createdUserIds = [];
const createdTeacherIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectThrow = async (fn, expectedCode) => {
  let threw = false;
  let code = null;
  try {
    await fn();
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

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const INSTITUTE_A = new mongoose.Types.ObjectId();
const INSTITUTE_B = new mongoose.Types.ObjectId();

const ALL_ACTIVE_FEATURES = [
  "STUDENT_MANAGEMENT",
  "TEACHER_MANAGEMENT",
  "ADMIN_MANAGEMENT",
  "PARENT_MANAGEMENT",
  "EXAM_TEST_MANAGEMENT",
  "SMS",
  "CLASS_MANAGEMENT",
  "BATCH_MANAGEMENT",
  "LEAD_MANAGEMENT",
  "API_ACCESS",
];

const makeSub = (limits, featureOverrides = {}, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  instituteId: INSTITUTE_A,
  plan: "PRO",
  planVersion: 3,
  status: "ACTIVE",
  endDate: new Date(Date.now() + 86400000 * 30),
  features: ALL_ACTIVE_FEATURES.map((key) => ({
    key,
    enabled: featureOverrides[key] !== false,
  })),
  limits,
  ...overrides,
});

const withMockedSub = async (fakeSub, fn) => {
  subscriptionService.getEffectiveSubscription = async () => fakeSub;
  try {
    await fn();
  } finally {
    subscriptionService.getEffectiveSubscription =
      originalGetEffectiveSubscription;
  }
};

const resetRegistry = () => limitCounterRegistry.__resetForTests();

const stubCounter = (limitKey, used, periodType = "LIFETIME_CURRENT") => {
  limitCounterRegistry.register(limitKey, {
    periodType,
    getCurrentUsage: async () => used,
  });
};

const clearUsageCounters = async () => {
  await UsageCounter.collection.deleteMany({
    instituteId: { $in: [INSTITUTE_A, INSTITUTE_B] },
  });
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // ---------------------------------------------------
    // Institute fixtures (for tenant isolation & counters)
    // ---------------------------------------------------
    for (const id of [INSTITUTE_A, INSTITUTE_B]) {
      await Institute.collection.insertOne({
        _id: id,
        code: `LS_${id.toString().slice(-12).toUpperCase()}`,
        name: `Limit Service Test ${id.toString().slice(-4)}`,
        approvalStatus: "APPROVED",
        isActive: true,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdInstituteIds.push(id);
    }

    // =====================================================
    // Section A — Input validators
    // =====================================================

    await test("validateLimitKey — valid key normalizes to uppercase", async () => {
      const r = limitService.validateLimitKey("max_students");
      assert(r === "MAX_STUDENTS", `got ${r}`);
    });

    await test("validateLimitKey — trims whitespace", async () => {
      const r = limitService.validateLimitKey("  max_sms_per_month  ");
      assert(r === "MAX_SMS_PER_MONTH", `got ${r}`);
    });

    await test("validateLimitKey — empty rejected", async () => {
      await expectThrow(
        async () => limitService.validateLimitKey(""),
        "UNKNOWN_LIMIT"
      );
    });

    await test("validateLimitKey — non-string rejected", async () => {
      await expectThrow(
        async () => limitService.validateLimitKey(123),
        "UNKNOWN_LIMIT"
      );
    });

    await test("validateLimitKey — unknown rejected", async () => {
      await expectThrow(
        async () => limitService.validateLimitKey("MADE_UP"),
        "UNKNOWN_LIMIT"
      );
    });

    await test("validateIncrementBy — default is 1", async () => {
      const r = limitService.validateIncrementBy(undefined);
      assert(r === 1, `got ${r}`);
    });

    await test("validateIncrementBy — valid integers accepted", async () => {
      assert(limitService.validateIncrementBy(5) === 5, "5");
      assert(limitService.validateIncrementBy(1000) === 1000, "1000");
    });

    await test("validateIncrementBy — 0 / negative / float / null rejected", async () => {
      await expectThrow(
        async () => limitService.validateIncrementBy(0),
        "INVALID_INCREMENT"
      );
      await expectThrow(
        async () => limitService.validateIncrementBy(-1),
        "INVALID_INCREMENT"
      );
      await expectThrow(
        async () => limitService.validateIncrementBy(1.5),
        "INVALID_INCREMENT"
      );
      await expectThrow(
        async () => limitService.validateIncrementBy(null),
        "INVALID_INCREMENT"
      );
    });

    await test("validateAmount — valid, undefined rejected, 0 rejected", async () => {
      assert(limitService.validateAmount(5) === 5, "5");
      await expectThrow(
        async () => limitService.validateAmount(undefined),
        "INVALID_INCREMENT"
      );
      await expectThrow(
        async () => limitService.validateAmount(0),
        "INVALID_INCREMENT"
      );
    });

    // =====================================================
    // Section B — Limit resolution
    // =====================================================

    await test("resolveLimitValue — positive value", async () => {
      const sub = makeSub([{ key: "MAX_STUDENTS", value: 1000 }]);
      const r = limitService.resolveLimitValue(sub, "MAX_STUDENTS");
      assert(r.limit === 1000, "limit");
      assert(r.unlimited === false, "unlimited");
    });

    await test("resolveLimitValue — zero value", async () => {
      const sub = makeSub([{ key: "MAX_STUDENTS", value: 0 }]);
      const r = limitService.resolveLimitValue(sub, "MAX_STUDENTS");
      assert(r.limit === 0, "limit");
    });

    await test("resolveLimitValue — null = unlimited", async () => {
      const sub = makeSub([{ key: "MAX_STUDENTS", value: null }]);
      const r = limitService.resolveLimitValue(sub, "MAX_STUDENTS");
      assert(r.limit === null, "limit");
      assert(r.unlimited === true, "unlimited");
    });

    await test("resolveLimitValue — missing key → LIMIT_NOT_CONFIGURED", async () => {
      const sub = makeSub([]);
      await expectThrow(
        async () => limitService.resolveLimitValue(sub, "MAX_STUDENTS"),
        "LIMIT_NOT_CONFIGURED"
      );
    });

    await test("resolveLimitValue — legacy (undefined limits) → LIMIT_NOT_CONFIGURED", async () => {
      const sub = makeSub(undefined);
      await expectThrow(
        async () => limitService.resolveLimitValue(sub, "MAX_STUDENTS"),
        "LIMIT_NOT_CONFIGURED"
      );
    });

    await test("resolveLimitValue — non-array limits → config invalid", async () => {
      const sub = makeSub("corrupted");
      await expectThrow(
        async () => limitService.resolveLimitValue(sub, "MAX_STUDENTS"),
        "ENTITLEMENT_CONFIGURATION_INVALID"
      );
    });

    await test("resolveLimitValue — duplicate keys → config invalid", async () => {
      const sub = makeSub([
        { key: "MAX_STUDENTS", value: 100 },
        { key: "max_students", value: 200 },
      ]);
      await expectThrow(
        async () => limitService.resolveLimitValue(sub, "MAX_STUDENTS"),
        "ENTITLEMENT_CONFIGURATION_INVALID"
      );
    });

    await test("resolveLimitValue — negative value → config invalid", async () => {
      const sub = makeSub([{ key: "MAX_STUDENTS", value: -1 }]);
      await expectThrow(
        async () => limitService.resolveLimitValue(sub, "MAX_STUDENTS"),
        "ENTITLEMENT_CONFIGURATION_INVALID"
      );
    });

    // =====================================================
    // Section C — checkLimit core
    // =====================================================

    await test("checkLimit — below limit → allowed", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 500);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.allowed === true, `reason ${r.reason}`);
          assert(r.current === 500, `current ${r.current}`);
          assert(r.remaining === 500, `remaining ${r.remaining}`);
          assert(r.source === "SUBSCRIPTION", "source");
        }
      );
      resetRegistry();
    });

    await test("checkLimit — at limit → LIMIT_REACHED", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 1000);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.allowed === false, "denied");
          assert(r.reason === "LIMIT_REACHED", r.reason);
          assert(r.remaining === 0, "remaining");
        }
      );
      resetRegistry();
    });

    await test("checkLimit — incrementBy would exceed → denied", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 998);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 5,
          });
          assert(r.allowed === false, "denied");
          assert(r.requested === 5, "requested");
        }
      );
      resetRegistry();
    });

    await test("checkLimit — invalid institute → INSTITUTE_CONTEXT_REQUIRED", async () => {
      const r = await limitService.checkLimit({
        instituteId: "invalid",
        limitKey: "MAX_STUDENTS",
      });
      assert(r.allowed === false, "denied");
      assert(r.reason === "INSTITUTE_CONTEXT_REQUIRED", r.reason);
    });

    await test("checkLimit — unknown limit → UNKNOWN_LIMIT", async () => {
      const r = await limitService.checkLimit({
        instituteId: INSTITUTE_A,
        limitKey: "MADE_UP",
      });
      assert(r.allowed === false, "denied");
      assert(r.reason === "UNKNOWN_LIMIT", r.reason);
    });

    await test("checkLimit — no subscription → SUBSCRIPTION_INACTIVE", async () => {
      await withMockedSub(null, async () => {
        const r = await limitService.checkLimit({
          instituteId: INSTITUTE_A,
          limitKey: "MAX_STUDENTS",
        });
        assert(r.reason === "SUBSCRIPTION_INACTIVE", r.reason);
      });
    });

    await test("checkLimit — unregistered counter → RESOURCE_NOT_IMPLEMENTED", async () => {
      resetRegistry();
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reason === "RESOURCE_NOT_IMPLEMENTED", r.reason);
        }
      );
      resetRegistry();
    });

    await test("checkLimit — counter throws → INTERNAL_ERROR", async () => {
      resetRegistry();
      limitCounterRegistry.register("MAX_STUDENTS", {
        periodType: "LIFETIME_CURRENT",
        getCurrentUsage: async () => {
          throw new Error("Simulated failure");
        },
      });
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reason === "INTERNAL_ERROR", r.reason);
        }
      );
      resetRegistry();
    });

    // =====================================================
    // Section D — Unlimited
    // =====================================================

    await test("Unlimited — allowed regardless of incrementBy", async () => {
      resetRegistry();
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: null }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 999999,
          });
          assert(r.allowed === true, "allowed");
          assert(r.unlimited === true, "unlimited");
          assert(r.limit === null, "limit null");
          assert(r.current === null, "current null");
        }
      );
    });

    await test("Unlimited — counter never called", async () => {
      resetRegistry();
      let called = false;
      limitCounterRegistry.register("MAX_STUDENTS", {
        periodType: "LIFETIME_CURRENT",
        getCurrentUsage: async () => {
          called = true;
          return 0;
        },
      });
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: null }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.allowed === true, "allowed");
          assert(called === false, "counter must not be called");
        }
      );
      resetRegistry();
    });

    await test("Unlimited — invalid incrementBy still rejected", async () => {
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: null }]),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 0,
          });
          assert(r.reason === "INVALID_INCREMENT", r.reason);
        }
      );
    });

    // =====================================================
    // Section E — Feature dependency
    // =====================================================

    await test("Feature disabled → FEATURE_DISABLED", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }], {
          STUDENT_MANAGEMENT: false,
        }),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reason === "FEATURE_DISABLED", r.reason);
        }
      );
      resetRegistry();
    });

    await test("Feature disabled → counter NOT called", async () => {
      resetRegistry();
      let called = false;
      limitCounterRegistry.register("MAX_STUDENTS", {
        periodType: "LIFETIME_CURRENT",
        getCurrentUsage: async () => {
          called = true;
          return 0;
        },
      });
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }], {
          STUDENT_MANAGEMENT: false,
        }),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reason === "FEATURE_DISABLED", r.reason);
          assert(called === false, "counter must not be called");
        }
      );
      resetRegistry();
    });

    await test("Feature dependency wins over limit check (ordering)", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 99999); // would be LIMIT_REACHED
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }], {
          STUDENT_MANAGEMENT: false,
        }),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reason === "FEATURE_DISABLED", r.reason);
        }
      );
      resetRegistry();
    });

    await test("Unrelated disabled feature does not block", async () => {
      resetRegistry();
      stubCounter("MAX_STUDENTS", 100);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }], {
          SMS: false,
          EXAM_TEST_MANAGEMENT: false,
        }),
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.allowed === true, r.reason);
        }
      );
      resetRegistry();
    });

    // =====================================================
    // Section F — reserve / release
    // =====================================================

    await test("reserveLimit — happy path creates counter and increments", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reserved === true, "reserved");
          assert(r.current === 1, `current ${r.current}`);
          assert(r.limit === 1000, "limit");
          assert(r.period === "lifetime", "period");
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("reserveLimit — accumulated increments", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 5,
          });
          const r = await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 3,
          });
          assert(r.current === 8, `current ${r.current}`);
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("reserveLimit — beyond limit → LIMIT_REACHED", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 10 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 10,
          });
          await expectThrow(
            () =>
              limitService.reserveLimit({
                instituteId: INSTITUTE_A,
                limitKey: "MAX_STUDENTS",
              }),
            "LIMIT_REACHED"
          );
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("reserveLimit — unlimited returns reserved without counter", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: null }]),
        async () => {
          const r = await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.reserved === true, "reserved");
          assert(r.unlimited === true, "unlimited");
          assert(r.current === null, "current null");
        }
      );
      const count = await UsageCounter.countDocuments({
        instituteId: INSTITUTE_A,
      });
      assert(count === 0, `Expected 0 counters, got ${count}`);
      resetRegistry();
    });

    await test("reserveLimit — feature disabled → FEATURE_DISABLED", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }], {
          STUDENT_MANAGEMENT: false,
        }),
        async () => {
          await expectThrow(
            () =>
              limitService.reserveLimit({
                instituteId: INSTITUTE_A,
                limitKey: "MAX_STUDENTS",
              }),
            "FEATURE_DISABLED"
          );
        }
      );
      resetRegistry();
    });

    await test(
      "reserveLimit — 20 concurrent reserves with limit 10 → exactly 10 succeed",
      async () => {
        await clearUsageCounters();
        resetRegistry();
        stubCounter("MAX_STUDENTS", 0);
        await withMockedSub(
          makeSub([{ key: "MAX_STUDENTS", value: 10 }]),
          async () => {
            const results = await Promise.allSettled(
              Array.from({ length: 20 }, () =>
                limitService.reserveLimit({
                  instituteId: INSTITUTE_A,
                  limitKey: "MAX_STUDENTS",
                })
              )
            );
            const successes = results.filter(
              (r) => r.status === "fulfilled"
            ).length;
            const limitReached = results.filter(
              (r) =>
                r.status === "rejected" &&
                r.reason?.code === "LIMIT_REACHED"
            ).length;
            assert(successes === 10, `Expected 10 success, got ${successes}`);
            assert(limitReached === 10, `Expected 10 LIMIT_REACHED, got ${limitReached}`);

            const counter = await UsageCounter.findOne({
              instituteId: INSTITUTE_A,
              limitKey: "MAX_STUDENTS",
              period: "lifetime",
            });
            assert(counter.used === 10, `Counter used: ${counter.used}`);
          }
        );
        await clearUsageCounters();
        resetRegistry();
      }
    );

    await test("releaseLimit — happy path", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 10,
          });
          const r = await limitService.releaseLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            amount: 3,
          });
          assert(r.released === true, "released");
          assert(r.current === 7, `current ${r.current}`);
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("releaseLimit — more than used → RELEASE_BELOW_ZERO", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 5,
          });
          await expectThrow(
            () =>
              limitService.releaseLimit({
                instituteId: INSTITUTE_A,
                limitKey: "MAX_STUDENTS",
                amount: 10,
              }),
            "RELEASE_BELOW_ZERO"
          );
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("releaseLimit — on unlimited is a no-op", async () => {
      resetRegistry();
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: null }]),
        async () => {
          const r = await limitService.releaseLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            amount: 5,
          });
          assert(r.released === true, "released");
          assert(r.unlimited === true, "unlimited");
        }
      );
    });

    await test("reserve + release → net zero", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 10,
          });
          await limitService.releaseLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            amount: 10,
          });
          const counter = await UsageCounter.findOne({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
          });
          assert(counter.used === 0, `used ${counter.used}`);
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("reserveLimit — session commit persists", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              await limitService.reserveLimit({
                instituteId: INSTITUTE_A,
                limitKey: "MAX_STUDENTS",
                incrementBy: 5,
                session,
              });
            });
          } finally {
            await session.endSession();
          }
          const counter = await UsageCounter.findOne({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
          });
          assert(counter.used === 6, `used ${counter.used}`);
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("reserveLimit — session abort rolls back", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });

          const session = await mongoose.startSession();
          try {
            session.startTransaction();
            await limitService.reserveLimit({
              instituteId: INSTITUTE_A,
              limitKey: "MAX_STUDENTS",
              incrementBy: 5,
              session,
            });
            await session.abortTransaction();
          } finally {
            await session.endSession();
          }

          const counter = await UsageCounter.findOne({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
          });
          assert(counter.used === 1, `expected 1, got ${counter.used}`);
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    // =====================================================
    // Section G — Period logic
    // =====================================================

    await test("Period — LIFETIME_CURRENT → 'lifetime'", async () => {
      const p = limitService.derivePeriodForKey(
        "MAX_STUDENTS",
        new Date("2026-11-15T12:00:00Z")
      );
      assert(p === "lifetime", p);
    });

    await test("Period — CURRENT_USAGE → 'current'", async () => {
      const p = limitService.derivePeriodForKey(
        "MAX_STORAGE_MB",
        new Date("2026-11-15T12:00:00Z")
      );
      assert(p === "current", p);
    });

    await test("Period — CALENDAR_MONTH_UTC → YYYY-MM", async () => {
      const p = limitService.derivePeriodForKey(
        "MAX_SMS_PER_MONTH",
        new Date("2026-01-15T12:00:00Z")
      );
      assert(p === "2026-01", p);
    });

    await test("Period — year rollover (Dec 31 → Jan next)", async () => {
      const dec = limitService.derivePeriodForKey(
        "MAX_SMS_PER_MONTH",
        new Date("2026-12-31T23:59:59Z")
      );
      const jan = limitService.derivePeriodForKey(
        "MAX_SMS_PER_MONTH",
        new Date("2027-01-01T00:00:00Z")
      );
      assert(dec === "2026-12", dec);
      assert(jan === "2027-01", jan);
    });

    await test("Period — UTC boundary (IST midnight ignored)", async () => {
      const p = limitService.derivePeriodForKey(
        "MAX_SMS_PER_MONTH",
        new Date("2026-12-31T18:30:00Z")
      );
      assert(p === "2026-12", `UTC-based expected 2026-12, got ${p}`);
    });

    await test("Period — leap year Feb 29", async () => {
      const p = limitService.derivePeriodForKey(
        "MAX_SMS_PER_MONTH",
        new Date("2028-02-29T12:00:00Z")
      );
      assert(p === "2028-02", p);
    });

    await test("getPeriodBounds — 2026-11 → Nov 1 to Dec 1 (exclusive)", async () => {
      const b = limitService.getPeriodBounds("2026-11");
      assert(b.start.toISOString() === "2026-11-01T00:00:00.000Z", "start");
      assert(b.end.toISOString() === "2026-12-01T00:00:00.000Z", "end");
    });

    await test("getPeriodBounds — lifetime/current → null", async () => {
      assert(limitService.getPeriodBounds("lifetime") === null, "lifetime");
      assert(limitService.getPeriodBounds("current") === null, "current");
    });

    await test("getPeriodBounds — invalid format → INVALID_PERIOD", async () => {
      await expectThrow(
        async () => limitService.getPeriodBounds("2026-1"),
        "INVALID_PERIOD"
      );
      await expectThrow(
        async () => limitService.getPeriodBounds("2026-13"),
        "INVALID_PERIOD"
      );
    });

    // =====================================================
    // Section H — Bulk statuses
    // =====================================================

    await test("getLimitStatus — returns full shape", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 100);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          const r = await limitService.getLimitStatus({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
          });
          assert(r.limit === 1000, "limit");
          assert(r.current === 100, "current");
          assert(r.remaining === 900, "remaining");
          assert(r.unlimited === false, "unlimited");
          assert(r.period === "lifetime", "period");
          assert(r.lastReconciledAt === null, "lastReconciledAt");
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("getLimitStatus — unregistered counter → RESOURCE_NOT_IMPLEMENTED", async () => {
      resetRegistry();
      await withMockedSub(
        makeSub([{ key: "MAX_SMS_PER_MONTH", value: 100 }]),
        async () => {
          await expectThrow(
            () =>
              limitService.getLimitStatus({
                instituteId: INSTITUTE_A,
                limitKey: "MAX_SMS_PER_MONTH",
              }),
            "RESOURCE_NOT_IMPLEMENTED"
          );
        }
      );
    });

    await test("getAllLimitStatuses — returns all 13 limits in catalog order", async () => {
      await withMockedSub(makeSub([]), async () => {
        const r = await limitService.getAllLimitStatuses({
          instituteId: INSTITUTE_A,
        });
        const catalogOrder = Object.keys(LIMIT_CATALOG);
        const resultOrder = r.limits.map((l) => l.limitKey);
        assert(
          JSON.stringify(catalogOrder) === JSON.stringify(resultOrder),
          "order mismatch"
        );
      });
    });

    await test("getAllLimitStatuses — unregistered limit marked implemented:false", async () => {
      await withMockedSub(
        makeSub([{ key: "MAX_SMS_PER_MONTH", value: 100 }]),
        async () => {
          const r = await limitService.getAllLimitStatuses({
            instituteId: INSTITUTE_A,
          });
          const sms = r.limits.find(
            (l) => l.limitKey === "MAX_SMS_PER_MONTH"
          );
          assert(sms.implemented === false, "implemented");
          assert(sms.error === "RESOURCE_NOT_IMPLEMENTED", sms.error);
        }
      );
    });

    await test("getAllLimitStatuses — one failing counter does not break others", async () => {
      resetRegistry();
      try {
        // Register the failing counter
        limitCounterRegistry.register("MAX_STUDENTS", {
          periodType: "LIFETIME_CURRENT",
          getCurrentUsage: async () => {
            throw new Error("Simulated failure");
          },
        });

        // Re-register the production counters (MAX_TEACHERS etc.)
        // so that only MAX_STUDENTS is broken.
        const { registerAllCounters } = require("../../services/counters");
        registerAllCounters();

        await withMockedSub(
          makeSub([
            { key: "MAX_STUDENTS", value: 1000 },
            { key: "MAX_TEACHERS", value: 50 },
          ]),
          async () => {
            const r = await limitService.getAllLimitStatuses({
              instituteId: INSTITUTE_A,
            });
            const students = r.limits.find(
              (l) => l.limitKey === "MAX_STUDENTS"
            );
            const teachers = r.limits.find(
              (l) => l.limitKey === "MAX_TEACHERS"
            );
            assert(
              students.error === "INTERNAL_ERROR",
              `students.error: ${students.error}`
            );
            assert(teachers.error === null, `teachers.error: ${teachers.error}`);
            assert(
              typeof teachers.current === "number",
              `teachers.current should be number, got ${typeof teachers.current}`
            );
          }
        );
      } finally {
        resetRegistry();
        // Restore production counters for subsequent tests
        const { registerAllCounters } = require("../../services/counters");
        registerAllCounters();
      }
    });

    // =====================================================
    // Section I — Tenant isolation
    // =====================================================

    await test("Tenant isolation — counters are per-institute", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 5,
          });

          const counterA = await UsageCounter.findOne({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
          });
          const counterB = await UsageCounter.findOne({
            instituteId: INSTITUTE_B,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
          });

          assert(counterA !== null, "Counter A should exist");
          assert(counterA.used === 5, `A used: ${counterA.used}`);
          assert(counterB === null, "Counter B should not exist");
        }
      );
      await clearUsageCounters();
      resetRegistry();
    });

    await test("Tenant isolation — read for B does not read A's counter", async () => {
      await clearUsageCounters();
      resetRegistry();
      stubCounter("MAX_STUDENTS", 0);
      await withMockedSub(
        makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
        async () => {
          await limitService.reserveLimit({
            instituteId: INSTITUTE_A,
            limitKey: "MAX_STUDENTS",
            incrementBy: 5,
          });
        }
      );

      // Mock sub for B
      await withMockedSub(
        {
          ...makeSub([{ key: "MAX_STUDENTS", value: 1000 }]),
          instituteId: INSTITUTE_B,
        },
        async () => {
          const r = await limitService.checkLimit({
            instituteId: INSTITUTE_B,
            limitKey: "MAX_STUDENTS",
          });
          // B has no counter, so falls back to getCurrentUsage (0)
          assert(r.current === 0, `B current should be 0, got ${r.current}`);
        }
      );

      await clearUsageCounters();
      resetRegistry();
    });

    console.log("\nAll Limit Service tests executed.");
  } finally {
    // Cleanup
    await clearUsageCounters();

    if (createdTeacherIds.length) {
      await Teacher.collection.deleteMany({
        _id: { $in: createdTeacherIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
      });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }

    subscriptionService.getEffectiveSubscription =
      originalGetEffectiveSubscription;

    await mongoose.disconnect();
  }

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) process.exitCode = 1;
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});