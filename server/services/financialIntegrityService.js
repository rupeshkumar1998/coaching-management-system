// =========================================================
// 32.16.15.9.15 — Payment and Financial Integrity
//
// Enforces: Payment.amount === Subscription.amount === PlanVersion.amount
// (and matching currency / institute / subscription / paymentType).
//
// These are pure functions. They do NOT fetch data themselves;
// callers pass already-loaded documents. This keeps the module
// easy to test and avoids hidden DB calls.
// =========================================================

const createFinancialError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// 1. Subscription <-> PlanVersion
// ---------------------------------------------------------

const assertSubscriptionMatchesPlanVersion = (
  subscription,
  planVersion
) => {
  if (!subscription) {
    throw createFinancialError(
      "Subscription is required for financial verification",
      "SUBSCRIPTION_REQUIRED"
    );
  }

  if (!planVersion) {
    throw createFinancialError(
      "Plan version is required for financial verification",
      "PLAN_VERSION_REQUIRED"
    );
  }

  if (
    !subscription.planVersionId ||
    String(subscription.planVersionId) !== String(planVersion._id)
  ) {
    throw createFinancialError(
      "Subscription does not reference the supplied plan version",
      "PLAN_VERSION_REFERENCE_MISMATCH"
    );
  }

  if (subscription.amount !== planVersion.amount) {
    throw createFinancialError(
      "Subscription amount does not match plan version amount",
      "PLAN_AMOUNT_MISMATCH"
    );
  }

  if (subscription.currency !== planVersion.currency) {
    throw createFinancialError(
      "Subscription currency does not match plan version currency",
      "PLAN_CURRENCY_MISMATCH"
    );
  }

  if (subscription.paymentRequired !== planVersion.paymentRequired) {
    throw createFinancialError(
      "Subscription payment requirement does not match plan version",
      "PAYMENT_REQUIREMENT_MISMATCH"
    );
  }
};

// ---------------------------------------------------------
// 2. Payment <-> Subscription
// ---------------------------------------------------------

const assertPaymentMatchesSubscription = (
  payment,
  subscription
) => {
  if (!payment) {
    throw createFinancialError(
      "Payment is required for financial verification",
      "PAYMENT_REQUIRED"
    );
  }

  if (payment.paymentType !== "INSTITUTE_SUBSCRIPTION") {
    throw createFinancialError(
      "Only INSTITUTE_SUBSCRIPTION payments are eligible",
      "PAYMENT_TYPE_MISMATCH"
    );
  }

  if (payment.status !== "VERIFIED") {
    throw createFinancialError(
      "Payment is not in VERIFIED state",
      "PAYMENT_NOT_VERIFIED"
    );
  }

  if (
    !payment.subscriptionId ||
    String(payment.subscriptionId) !== String(subscription._id)
  ) {
    throw createFinancialError(
      "Payment is not linked to this subscription",
      "PAYMENT_SUBSCRIPTION_MISMATCH"
    );
  }

  if (
    !payment.instituteId ||
    String(payment.instituteId) !== String(subscription.instituteId)
  ) {
    throw createFinancialError(
      "Payment institute does not match subscription institute",
      "PAYMENT_INSTITUTE_MISMATCH"
    );
  }

  if (payment.amount !== subscription.amount) {
    throw createFinancialError(
      "Payment amount does not match subscription amount",
      "PAYMENT_AMOUNT_MISMATCH"
    );
  }

  if (payment.currency !== subscription.currency) {
    throw createFinancialError(
      "Payment currency does not match subscription currency",
      "PAYMENT_CURRENCY_MISMATCH"
    );
  }
};

// ---------------------------------------------------------
// 3. Public: full three-way verification
// ---------------------------------------------------------

const verifyFinancialIntegrity = ({
  payment,
  subscription,
  planVersion,
}) => {
  assertSubscriptionMatchesPlanVersion(
    subscription,
    planVersion
  );

  assertPaymentMatchesSubscription(payment, subscription);

  return true;
};

// ---------------------------------------------------------
// 4. Public: subscription-only verification
// (used when a Payment record is not yet available, e.g.
//  renewal checks or manual audits)
// ---------------------------------------------------------

const verifySubscriptionFinancials = (
  subscription,
  planVersion
) => {
  assertSubscriptionMatchesPlanVersion(
    subscription,
    planVersion
  );

  return true;
};

module.exports = {
  verifyFinancialIntegrity,
  verifySubscriptionFinancials,
  assertSubscriptionMatchesPlanVersion,
  assertPaymentMatchesSubscription,
};