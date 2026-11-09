require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createDraftPlanVersion,
} = require("../../services/subscriptionPlanVersionService");

const {
  getMandatoryFeatureKeys,
} = require("../../constants/featureCatalog");

// =========================================================
// 32.16.15.17 — Feature/Limit Change Regression
//
// Verifies that invalid plan configurations are rejected at
// draft creation time. Focus areas:
//
//   A. Feature ↔ Limit dependency enforcement
//   B. Limit value semantics (0 / null / positive)
//   C. CORE security feature protection
//   D. Premium feature independence
//   E. Catalog validation (unknown keys)
//
// Note: runtime access behavior (existing subscriber isolation)
// is already covered in .12 and .16. This file is
// validation-focused per the phase plan.
// =========================================================

const createdPlanIds = [];
const createdVersionIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
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
// Helpers
// ---------------------------------------------------------

const makeConfiguration = (overrides = {}) => ({
  amount: 999,
  currency: "INR",
  durationDays: 30,
  paymentRequired: true,
  features: getMandatoryFeatureKeys().map((key) => ({
    key,
    enabled: true,
  })),
  limits: [],
  ...overrides,
});

const createPlan = async () => {
  const actorId = new mongoose.Types.ObjectId();
  const plan = await SubscriptionPlan.create({
    code: `FL_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Feature Limit Regression Test Plan",
    description: "",
    isActive: true,
    createdBy: actorId,
    updatedBy: actorId,
  });
  createdPlanIds.push(plan._id);
  return { plan, actorId };
};

const expectDraftRejected = async (
  planId,
  actorId,
  configuration,
  expectedKeyword
) => {
  let threw = false;
  let message = "";
  try {
    await createDraftPlanVersion({ planId, actorId, configuration });
  } catch (e) {
    threw = true;
    message = e.message || "";
  }
  assert(threw, "draft creation should be rejected");
  if (expectedKeyword) {
    assert(
      message.toLowerCase().includes(expectedKeyword.toLowerCase()),
      `expected "${expectedKeyword}" in error message, got: ${message}`
    );
  }
};

const expectDraftAccepted = async (planId, actorId, configuration) => {
  const draft = await createDraftPlanVersion({
    planId,
    actorId,
    configuration,
  });
  createdVersionIds.push(draft._id);
  assert(draft.status === "DRAFT", `draft status: ${draft.status}`);
  return draft;
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // Section A — Feature ↔ Limit dependency (5 tests)
    // =====================================================

    await test(
      "A1: LEAD_MANAGEMENT=OFF + MAX_ACTIVE_LEADS=500 → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "LEAD_MANAGEMENT", enabled: false },
            ],
            limits: [{ key: "MAX_ACTIVE_LEADS", value: 500 }],
          }),
          "LEAD_MANAGEMENT"
        );
      }
    );

    await test(
      "A2: EXAM_TEST_MANAGEMENT=OFF + MAX_EXAMS_PER_MONTH=10 → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "EXAM_TEST_MANAGEMENT", enabled: false },
            ],
            limits: [{ key: "MAX_EXAMS_PER_MONTH", value: 10 }],
          }),
          "EXAM_TEST_MANAGEMENT"
        );
      }
    );

    await test(
      "A3: SMS=OFF + MAX_SMS_PER_MONTH=100 → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "SMS", enabled: false },
            ],
            limits: [{ key: "MAX_SMS_PER_MONTH", value: 100 }],
          }),
          "SMS"
        );
      }
    );

    await test(
      "A4: API_ACCESS=OFF + MAX_API_REQUESTS_PER_MONTH=1000 → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "API_ACCESS", enabled: false },
            ],
            limits: [
              { key: "MAX_API_REQUESTS_PER_MONTH", value: 1000 },
            ],
          }),
          "API_ACCESS"
        );
      }
    );

    await test(
      "A5: STUDENT_MANAGEMENT=OFF + MAX_STUDENTS=100 → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "STUDENT_MANAGEMENT", enabled: false },
            ],
            limits: [{ key: "MAX_STUDENTS", value: 100 }],
          }),
          "STUDENT_MANAGEMENT"
        );
      }
    );

    // =====================================================
    // Section B — Limit value semantics (3 tests)
    // Feature ON; only value varies: 0 / null / positive
    // =====================================================

    await test(
      "B1: SMS=ON + MAX_SMS_PER_MONTH=0 → accepted (no usage)",
      async () => {
        const { plan, actorId } = await createPlan();
        const draft = await expectDraftAccepted(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "SMS", enabled: true },
            ],
            limits: [{ key: "MAX_SMS_PER_MONTH", value: 0 }],
          })
        );
        const limit = draft.limits.find(
          (l) => l.key === "MAX_SMS_PER_MONTH"
        );
        assert(limit.value === 0, `expected value 0, got ${limit.value}`);
      }
    );

    await test(
      "B2: SMS=ON + MAX_SMS_PER_MONTH=null → accepted (unlimited)",
      async () => {
        const { plan, actorId } = await createPlan();
        const draft = await expectDraftAccepted(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "SMS", enabled: true },
            ],
            limits: [{ key: "MAX_SMS_PER_MONTH", value: null }],
          })
        );
        const limit = draft.limits.find(
          (l) => l.key === "MAX_SMS_PER_MONTH"
        );
        assert(
          limit.value === null,
          `expected value null, got ${limit.value}`
        );
      }
    );

    await test(
      "B3: SMS=ON + MAX_SMS_PER_MONTH=100 → accepted (positive)",
      async () => {
        const { plan, actorId } = await createPlan();
        const draft = await expectDraftAccepted(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "SMS", enabled: true },
            ],
            limits: [{ key: "MAX_SMS_PER_MONTH", value: 100 }],
          })
        );
        const limit = draft.limits.find(
          (l) => l.key === "MAX_SMS_PER_MONTH"
        );
        assert(
          limit.value === 100,
          `expected value 100, got ${limit.value}`
        );
      }
    );

    // =====================================================
    // Section C — CORE security protection (3 tests)
    // =====================================================

    await test(
      "C1: TENANT_ISOLATION=OFF → rejected (CORE)",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: getMandatoryFeatureKeys().map((k) => ({
              key: k,
              enabled: k !== "TENANT_ISOLATION",
            })),
          }),
          "TENANT_ISOLATION"
        );
      }
    );

    await test(
      "C2: Each mandatory CORE disabled individually → each rejected",
      async () => {
        const mandatory = getMandatoryFeatureKeys();
        assert(
          mandatory.length > 0,
          "mandatory feature catalog must not be empty"
        );

        for (const coreKey of mandatory) {
          const { plan, actorId } = await createPlan();
          await expectDraftRejected(
            plan._id,
            actorId,
            makeConfiguration({
              features: mandatory.map((k) => ({
                key: k,
                enabled: k !== coreKey,
              })),
            }),
            coreKey
          );
        }
      }
    );

    await test(
      "C3: Missing AUTHENTICATION → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: getMandatoryFeatureKeys()
              .filter((k) => k !== "AUTHENTICATION")
              .map((k) => ({ key: k, enabled: true })),
          }),
          "AUTHENTICATION"
        );
      }
    );

    // =====================================================
    // Section D — Premium feature independence (2 tests)
    // =====================================================

    await test(
      "D1: FEE_MANAGEMENT=ON + ONLINE_FEE_PAYMENT=OFF → accepted",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftAccepted(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "FEE_MANAGEMENT", enabled: true },
              { key: "ONLINE_FEE_PAYMENT", enabled: false },
            ],
          })
        );
      }
    );

    await test(
      "D2: ONLINE_FEE_PAYMENT=ON without FEE_MANAGEMENT → accepted (independent)",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftAccepted(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "ONLINE_FEE_PAYMENT", enabled: true },
            ],
          })
        );
      }
    );

    // =====================================================
    // Section E — Catalog validation (2 tests)
    // =====================================================

    await test(
      "E1: Unknown feature key → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            features: [
              ...getMandatoryFeatureKeys().map((k) => ({
                key: k,
                enabled: true,
              })),
              { key: "MADE_UP_FEATURE_XYZ", enabled: true },
            ],
          }),
          "MADE_UP_FEATURE_XYZ"
        );
      }
    );

    await test(
      "E2: Unknown limit key → rejected",
      async () => {
        const { plan, actorId } = await createPlan();
        await expectDraftRejected(
          plan._id,
          actorId,
          makeConfiguration({
            limits: [{ key: "MADE_UP_LIMIT_XYZ", value: 100 }],
          }),
          "MADE_UP_LIMIT_XYZ"
        );
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }
    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});