// =========================================================
// 32.16.15.12 — Subscription Snapshot Builder
//
// Pure function that converts an authoritative
// SubscriptionPlanVersion into the exact set of fields
// required to create a Subscription's immutable commercial
// snapshot.
//
// Why a dedicated helper?
//   1. Single source of truth for snapshot shape
//   2. Prevents drift between STANDARD / TRIAL / FREE flows
//   3. Testable in isolation (no DB, no HTTP)
//   4. Handles Mongoose subdocument → plain object conversion
//   5. Central place to add future snapshot fields
//
// Design rules:
//   - Pure: no DB calls, no side effects
//   - Strict: malformed input → throw (never silent copy)
//   - Normalizing: outputs are plain JS objects, not Mongoose
//   - Exhaustive: every snapshot field is populated
// =========================================================

const createSnapshotBuilderError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// Internal — validate the source plan version
// ---------------------------------------------------------
const validatePlanVersionSource = (planVersion) => {
  if (!planVersion || typeof planVersion !== "object" || Array.isArray(planVersion)) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion must be an object"
    );
  }

  const versionId = planVersion._id || planVersion.planVersionId;
  if (!versionId) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion must have an _id or planVersionId"
    );
  }

  if (
    !Number.isSafeInteger(planVersion.version) ||
    planVersion.version < 1
  ) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion.version must be a positive safe integer"
    );
  }

  return versionId;
};

// ---------------------------------------------------------
// Internal — normalize feature entries
//
// Accepts Mongoose subdocuments (with toObject) or plain
// objects (from .lean()). Always returns plain objects with
// normalized keys and explicit booleans.
// ---------------------------------------------------------
const normalizeFeatures = (features) => {
  if (features === undefined || features === null) {
    return [];
  }

  if (!Array.isArray(features)) {
    throw createSnapshotBuilderError(
      "INVALID_FEATURES",
      "features must be an array"
    );
  }

  return features.map((entry, index) => {
    const plain =
      entry && typeof entry.toObject === "function"
        ? entry.toObject()
        : entry;

    if (
      !plain ||
      typeof plain !== "object" ||
      typeof plain.key !== "string" ||
      !plain.key.trim() ||
      typeof plain.enabled !== "boolean"
    ) {
      throw createSnapshotBuilderError(
        "INVALID_FEATURE_ENTRY",
        `Feature at index ${index} must have a valid key and boolean enabled`
      );
    }

    return {
      key: plain.key.trim().toUpperCase(),
      enabled: plain.enabled,
    };
  });
};

// ---------------------------------------------------------
// Internal — normalize limit entries
// ---------------------------------------------------------
const normalizeLimits = (limits) => {
  if (limits === undefined || limits === null) {
    return [];
  }

  if (!Array.isArray(limits)) {
    throw createSnapshotBuilderError(
      "INVALID_LIMITS",
      "limits must be an array"
    );
  }

  return limits.map((entry, index) => {
    const plain =
      entry && typeof entry.toObject === "function"
        ? entry.toObject()
        : entry;

    if (
      !plain ||
      typeof plain !== "object" ||
      typeof plain.key !== "string" ||
      !plain.key.trim()
    ) {
      throw createSnapshotBuilderError(
        "INVALID_LIMIT_ENTRY",
        `Limit at index ${index} must have a valid key`
      );
    }

    const value = plain.value;

    if (
      value !== null &&
      (typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0)
    ) {
      throw createSnapshotBuilderError(
        "INVALID_LIMIT_ENTRY",
        `Limit ${plain.key} must have a non-negative safe integer or null value`
      );
    }

    return {
      key: plain.key.trim().toUpperCase(),
      value,
    };
  });
};

// ---------------------------------------------------------
// Public — build the snapshot
//
// @param {object} planVersion
//   Mongoose document OR .lean() object of a SubscriptionPlanVersion.
//   Required fields: _id (or planVersionId), version, amount,
//   currency, paymentRequired, features, limits.
//   durationDays may be null.
//
// @param {string} planCode
//   The logical plan code (e.g. "PRO", "BASIC", "FREE").
//   Caller resolves this from SubscriptionPlan.code.
//
// @param {object} [options]
//   options.capturedAt — Date (default: new Date())
//   options.overrides  — partial { amount, currency, paymentRequired,
//                        durationDays } that replace the values taken
//                        from planVersion. Used by:
//                          * TRIAL flow  (amount: 0, paymentRequired: false,
//                                         durationDays from offer)
//                          * FREE flow   (if needed)
//                        NEVER used by STANDARD paid flow.
//
// @returns {object} Plain object ready to spread into
//   Subscription.create({ ...buildSubscriptionSnapshot(...), ... })
// ---------------------------------------------------------
const buildSubscriptionSnapshot = (
  planVersion,
  planCode,
  options = {}
) => {
  const versionId = validatePlanVersionSource(planVersion);

  if (typeof planCode !== "string" || !planCode.trim()) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_CODE",
      "planCode must be a non-empty string"
    );
  }

  if (
    typeof planVersion.currency !== "string" ||
    !planVersion.currency.trim()
  ) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion.currency must be a non-empty string"
    );
  }

  if (
    typeof planVersion.amount !== "number" ||
    !Number.isSafeInteger(planVersion.amount) ||
    planVersion.amount < 0
  ) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion.amount must be a non-negative safe integer"
    );
  }

  if (typeof planVersion.paymentRequired !== "boolean") {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion.paymentRequired must be a boolean"
    );
  }

  if (
    planVersion.durationDays !== null &&
    planVersion.durationDays !== undefined &&
    (typeof planVersion.durationDays !== "number" ||
      !Number.isSafeInteger(planVersion.durationDays) ||
      planVersion.durationDays < 1)
  ) {
    throw createSnapshotBuilderError(
      "INVALID_PLAN_VERSION",
      "planVersion.durationDays must be a positive integer or null"
    );
  }

  const overrides = options.overrides || {};

  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw createSnapshotBuilderError(
      "INVALID_OVERRIDES",
      "options.overrides must be a plain object"
    );
  }

  const capturedAt =
    options.capturedAt instanceof Date && !isNaN(options.capturedAt.getTime())
      ? options.capturedAt
      : new Date();

  // Apply overrides. Each field explicitly falls back to the
  // version value when not overridden.
  const amount =
    overrides.amount !== undefined ? overrides.amount : planVersion.amount;

  const currency =
    overrides.currency !== undefined
      ? overrides.currency
      : planVersion.currency;

  const paymentRequired =
    overrides.paymentRequired !== undefined
      ? overrides.paymentRequired
      : planVersion.paymentRequired;

  const durationDays =
    overrides.durationDays !== undefined
      ? overrides.durationDays
      : planVersion.durationDays ?? null;

  return {
    plan: planCode.trim().toUpperCase(),
    planVersion: planVersion.version,
    planVersionId: versionId,

    amount,
    currency: String(currency).trim().toUpperCase(),
    paymentRequired,
    durationDays,

    features: normalizeFeatures(planVersion.features),
    limits: normalizeLimits(planVersion.limits),

    snapshotCapturedAt: capturedAt,
  };
};

module.exports = {
  buildSubscriptionSnapshot,
};