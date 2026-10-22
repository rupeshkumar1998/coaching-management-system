const assert = require("assert");
const mongoose = require("mongoose");

const Institute = require("./models/Institute");
const User = require("./models/User");
const Subscription = require("./models/Subscription");
const Payment = require("./models/Payment");
const SubscriptionPlan = require("./models/SubscriptionPlan");
const SubscriptionPlanVersion = require("./models/SubscriptionPlanVersion");

const { registerInstitute } = require("./controllers/publicRegistrationController");

const original = {
  instituteFindOne: Institute.findOne,
  instituteCreate: Institute.create,
  instituteDelete: Institute.findByIdAndDelete,
  userFindOne: User.findOne,
  userCreate: User.create,
  userDelete: User.findByIdAndDelete,
  subscriptionCreate: Subscription.create,
  subscriptionDelete: Subscription.findByIdAndDelete,
  paymentCreate: Payment.create,
  planFindOne: SubscriptionPlan.findOne,
  versionFindOne: SubscriptionPlanVersion.findOne,
};

const records = {
  institutes: [],
  users: [],
  subscriptions: [],
  payments: [],
};

const ids = () => new mongoose.Types.ObjectId();

let selectedPlan;
let selectedVersion;
let failPaymentCreation = false;
let passed = 0;
let failed = 0;

function assertCondition(condition, message) {
  assert.ok(condition, message);
}

function makePlan(code, version = {}) {
  const planId = ids();
  const versionId = ids();

  selectedPlan = {
    _id: planId,
    code,
    isActive: true,
    currentPublishedVersion: versionId,
  };

  selectedVersion = {
    _id: versionId,
    planId,
    version: 1,
    status: "PUBLISHED",
    amount: code === "FREE" ? 0 : 1200,
    currency: "INR",
    durationDays: code === "FREE" ? null : 30,
    paymentRequired: code !== "FREE",
    features: [{ key: "STUDENT_MANAGEMENT", enabled: true }],
    limits: [{ key: "STUDENTS", value: 100 }],
    ...version,
  };
}

function installMocks() {
  Institute.findOne = async ({ code }) =>
    records.institutes.find((item) => item.code === code) || null;

  Institute.create = async (data) => {
    const item = { ...data, _id: ids() };
    records.institutes.push(item);
    return item;
  };

  Institute.findByIdAndDelete = async (id) => {
    records.institutes = records.institutes.filter(
      (item) => String(item._id) !== String(id)
    );
  };

  User.findOne = async ({ email }) =>
    records.users.find((item) => item.email === email) || null;

  User.create = async (data) => {
    const item = { ...data, _id: ids() };
    records.users.push(item);
    return item;
  };

  User.findByIdAndDelete = async (id) => {
    records.users = records.users.filter(
      (item) => String(item._id) !== String(id)
    );
  };

  Subscription.create = async (data) => {
    const item = { ...data, _id: ids() };
    records.subscriptions.push(item);
    return item;
  };

  Subscription.findByIdAndDelete = async (id) => {
    records.subscriptions = records.subscriptions.filter(
      (item) => String(item._id) !== String(id)
    );
  };

  Payment.create = async (data) => {
    if (failPaymentCreation) {
      throw new Error("Simulated payment creation failure");
    }

    const item = { ...data, _id: ids() };
    records.payments.push(item);
    return item;
  };

  SubscriptionPlan.findOne = (query) => ({
    lean: async () =>
      selectedPlan && selectedPlan.code === query.code
        ? selectedPlan
        : null,
  });

  SubscriptionPlanVersion.findOne = (query) => ({
    lean: async () => {
      if (!selectedVersion) return null;

      const matches =
        String(selectedVersion._id) === String(query._id) &&
        String(selectedVersion.planId) === String(query.planId) &&
        selectedVersion.status === query.status;

      return matches ? selectedVersion : null;
    },
  });
}

function resetRecords() {
  for (const key of Object.keys(records)) {
    records[key] = [];
  }

  failPaymentCreation = false;
}

function requestBody(plan, suffix) {
  return {
    instituteName: `Registration Test ${suffix}`,
    instituteCode: `REG${suffix}`,
    instituteEmail: `institute${suffix}@example.test`,
    adminName: "Test Administrator",
    adminEmail: `admin${suffix}@example.test`,
    password: "TestPassword123!",
    plan,
  };
}

async function callRegistration(body) {
  let statusCode = 200;
  let responseBody;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(bodyValue) {
      responseBody = bodyValue;
      return this;
    },
  };

  await registerInstitute({ body }, res);

  return { statusCode, body: responseBody };
}

async function test(name, operation) {
  try {
    resetRecords();
    await operation();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function run() {
  installMocks();

  try {
    await test("FREE registration creates snapshot without payment", async () => {
      makePlan("FREE", {
        amount: 0,
        currency: "INR",
        durationDays: null,
        paymentRequired: false,
      });

      const result = await callRegistration(requestBody("FREE", "101"));

      assertCondition(result.body.success === true, "Registration should succeed");
      assertCondition(records.institutes.length === 1, "One institute expected");
      assertCondition(records.users.length === 1, "One admin expected");
      assertCondition(records.subscriptions.length === 1, "One subscription expected");
      assertCondition(records.payments.length === 0, "FREE must not create payment");

      const subscription = records.subscriptions[0];

      assertCondition(
        String(subscription.planVersionId) === String(selectedVersion._id),
        "Published version ID must be snapshotted"
      );
      assertCondition(subscription.planVersion === selectedVersion.version, "Version number mismatch");
      assertCondition(subscription.amount === 0, "FREE amount must be zero");
      assertCondition(subscription.paymentRequired === false, "FREE must not require payment");
      assertCondition(
        subscription.features[0].key === selectedVersion.features[0].key,
        "Feature snapshot mismatch"
      );
      assertCondition(
        subscription.limits[0].value === selectedVersion.limits[0].value,
        "Limit snapshot mismatch"
      );
    });

    await test("Paid registration creates matching pending payment", async () => {
      makePlan("BASIC");

      const result = await callRegistration(requestBody("BASIC", "102"));

      assertCondition(result.body.success === true, "Registration should succeed");
      assertCondition(records.subscriptions.length === 1, "One subscription expected");
      assertCondition(records.payments.length === 1, "One payment expected");

      const subscription = records.subscriptions[0];
      const payment = records.payments[0];

      assertCondition(subscription.amount === selectedVersion.amount, "Subscription amount mismatch");
      assertCondition(subscription.currency === selectedVersion.currency, "Subscription currency mismatch");
      assertCondition(payment.amount === selectedVersion.amount, "Payment amount mismatch");
      assertCondition(payment.currency === selectedVersion.currency, "Payment currency mismatch");
      assertCondition(payment.status === "PENDING", "Payment should be pending");
      assertCondition(
        String(payment.subscriptionId) === String(subscription._id),
        "Payment must reference the created subscription"
      );
      assertCondition(
        String(payment.instituteId) === String(subscription.instituteId),
        "Payment must reference the same institute"
      );
    });

await test("Unpublished plan is rejected without creating records", async () => {
  makePlan("BASIC");
  selectedPlan.currentPublishedVersion = null;

  const result = await callRegistration(requestBody("BASIC", "103"));

  assertCondition(result.body.success === false, "Registration must fail");
  assertCondition(records.institutes.length === 0, "Institute must not be created");
  assertCondition(records.users.length === 0, "User must not be created");
  assertCondition(records.subscriptions.length === 0, "Subscription must not be created");
  assertCondition(records.payments.length === 0, "Payment must not be created");
});

    await test("Payment failure rolls back institute, user and subscription", async () => {
      makePlan("BASIC");
      failPaymentCreation = true;

      const result = await callRegistration(requestBody("BASIC", "104"));

      assertCondition(result.body.success === false, "Registration must fail");
      assertCondition(records.institutes.length === 0, "Institute should be rolled back");
      assertCondition(records.users.length === 0, "User should be rolled back");
      assertCondition(records.subscriptions.length === 0, "Subscription should be rolled back");
      assertCondition(records.payments.length === 0, "Payment should not remain");
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    Institute.findOne = original.instituteFindOne;
    Institute.create = original.instituteCreate;
    Institute.findByIdAndDelete = original.instituteDelete;
    User.findOne = original.userFindOne;
    User.create = original.userCreate;
    User.findByIdAndDelete = original.userDelete;
    Subscription.create = original.subscriptionCreate;
    Subscription.findByIdAndDelete = original.subscriptionDelete;
    Payment.create = original.paymentCreate;
    SubscriptionPlan.findOne = original.planFindOne;
    SubscriptionPlanVersion.findOne = original.versionFindOne;
  }
}

run().catch((error) => {
  console.error("Registration test setup failed:", error);
  process.exitCode = 1;
});