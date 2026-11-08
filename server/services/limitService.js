const {
  LIMIT_CATALOG,
  getLimitDefinition,
} = require("../constants/limitCatalog");

const {
  validateInstituteId,
  resolveEffectiveSubscription,
  checkFeatureInSubscription,
} = require("./entitlementService");

const limitCounterRegistry = require("./limitCounterRegistry");
const UsageCounter = require("../models/UsageCounter");

// =========================================================
// 32.16.15.11 — Limit Service
//
// Central decision + reservation engine for resource limits.
//
// Distinct from Entitlement Service (.10):
//   - Entitlement: "Is feature X available?"
//   - Limit:       "How much of resource X can be used?"
//
// Built incrementally across sub-steps
// 32.16.15.11.5 → 32.16.15.11.15.
// =========================================================

// ---------------------------------------------------------
// Error factory
//
// `code` is the stable identifier consumed by public
// functions. Messages are human-readable only; callers must
// never parse them.
// ---------------------------------------------------------

const createLimitError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// Business error codes
//
// Controlled, expected failures that `checkLimit` converts
// into `{ allowed: false, reason }` instead of throwing.
//
// Anything not in this set is treated as INTERNAL_ERROR.
//
// Frozen to prevent accidental mutation at runtime.
// ---------------------------------------------------------

const BUSINESS_ERROR_CODES = Object.freeze(
  new Set([
    // Reused semantics from .10
    "INSTITUTE_CONTEXT_REQUIRED",
    "SUBSCRIPTION_INACTIVE",
    "ENTITLEMENT_SNAPSHOT_MISSING",
    "ENTITLEMENT_CONFIGURATION_INVALID",

    // New in .11
    "UNKNOWN_LIMIT",
    "LIMIT_NOT_CONFIGURED",
    "FEATURE_DISABLED",
    "RESOURCE_NOT_IMPLEMENTED",
    "LIMIT_REACHED",
    "RELEASE_BELOW_ZERO",

    // Caller-side validation failures
    "INVALID_INCREMENT",
  ])
);

// ---------------------------------------------------------
// .11.5 — Input Validation
//
// Internal helpers THROW on invalid input. Public functions
// (checkLimit, reserveLimit, releaseLimit) will wrap these
// and translate to their respective contracts.
// ---------------------------------------------------------

/**
 * Validate a limit key.
 *
 * Rules:
 *   - Must be a non-empty string
 *   - Must exist in LIMIT_CATALOG
 *   - Must be active in the catalog
 *
 * Normalization:
 *   The returned key is trimmed and uppercased.
 *
 * @param {*} limitKey
 * @returns {string} - normalized uppercase key
 * @throws {Error} - code: UNKNOWN_LIMIT
 */
const validateLimitKey = (limitKey) => {
  if (typeof limitKey !== "string" || !limitKey.trim()) {
    throw createLimitError(
      "UNKNOWN_LIMIT",
      "A valid limit key is required"
    );
  }

  const normalized = limitKey.trim().toUpperCase();
  const definition = getLimitDefinition(normalized);

  if (!definition) {
    throw createLimitError(
      "UNKNOWN_LIMIT",
      `Unknown limit: ${normalized}`
    );
  }

  if (definition.isActive !== true) {
    throw createLimitError(
      "UNKNOWN_LIMIT",
      `Limit is inactive: ${normalized}`
    );
  }

  return normalized;
};

/**
 * Validate that a numeric quantity is a positive safe integer.
 *
 * Used by both `incrementBy` (reserve/check) and `amount`
 * (release) — one rule, one error code.
 *
 * @param {*} value
 * @param {string} fieldName - used only in the error message
 * @returns {number}
 * @throws {Error} - code: INVALID_INCREMENT
 */
const validatePositiveInteger = (value, fieldName) => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw createLimitError(
      "INVALID_INCREMENT",
      `${fieldName} must be a positive safe integer`
    );
  }

  return value;
};

/**
 * Validate the `incrementBy` argument.
 *
 * `undefined` triggers the default (1).
 * `null`, `0`, negatives, floats, and strings are rejected.
 *
 * @param {*} value
 * @returns {number}
 * @throws {Error} - code: INVALID_INCREMENT
 */
const validateIncrementBy = (value) => {
  if (value === undefined) {
    return 1;
  }

  return validatePositiveInteger(value, "incrementBy");
};

/**
 * Validate the `amount` argument (release path).
 *
 * Unlike `incrementBy`, `amount` has NO default — releasing
 * is only meaningful with an explicit amount.
 *
 * @param {*} value
 * @returns {number}
 * @throws {Error} - code: INVALID_INCREMENT
 */
const validateAmount = (value) => {
  return validatePositiveInteger(value, "amount");
};

// ---------------------------------------------------------
// Exports (temporary — will be extended in .11.6 → .11.13)
// ---------------------------------------------------------
// ---------------------------------------------------------
// .11.6 — Limit Resolution
//
// Extracts the limit value for a specific key from the
// subscription's immutable limit snapshot.
//
// Design rationale:
//   - Feature snapshot (.10) required strict validation
//     because a malformed feature could silently disable
//     a security control.
//   - Limit snapshot is more forgiving:
//       * `limits === undefined` / `null` → treated as []
//         (legacy subscriptions without limit data)
//       * Individual malformed entries → fail closed with
//         ENTITLEMENT_CONFIGURATION_INVALID
//   - A requested key that is NOT in the snapshot →
//     LIMIT_NOT_CONFIGURED (explicit, not implicit deny)
//
// Why LIMIT_NOT_CONFIGURED (not LIMIT_REACHED)?
//   The two are semantically distinct:
//     LIMIT_NOT_CONFIGURED → "this limit isn't in your plan"
//                            (client should not even try)
//     LIMIT_REACHED        → "this limit is exhausted"
//                            (client should wait/upgrade)
//   Conflating them would mislead the UI.
//
// Not part of this step:
//   - Actual usage lookup (.11.10)
//   - Feature dependency check (.11.9)
//   - Unregistered counters (.11.12)
// ---------------------------------------------------------

/**
 * Verify that the limits snapshot is structurally usable.
 *
 * `undefined` / `null` are treated as an empty snapshot
 * (legacy behavior). Any non-array is corruption.
 *
 * @param {*} subscription - Mongoose Subscription document
 * @throws {Error} - code: SUBSCRIPTION_INACTIVE | ENTITLEMENT_CONFIGURATION_INVALID
 */
const assertLimitsSnapshotUsable = (subscription) => {
  if (!subscription) {
    throw createLimitError(
      "SUBSCRIPTION_INACTIVE",
      "A subscription is required"
    );
  }

  if (
    subscription.limits === undefined ||
    subscription.limits === null
  ) {
    // Legacy subscription without limit snapshot.
    // Treated as an empty snapshot; no limit is configured.
    return;
  }

  if (!Array.isArray(subscription.limits)) {
    console.error(
      "[limitService] malformed limits snapshot",
      {
        subscriptionId: String(subscription._id),
        instituteId: String(subscription.instituteId),
        limitsType: typeof subscription.limits,
      }
    );

    throw createLimitError(
      "ENTITLEMENT_CONFIGURATION_INVALID",
      "Subscription limits snapshot is malformed"
    );
  }
};

/**
 * Build a validated, normalized Map of limitKey → value.
 *
 * Validates EVERY entry — not just the requested one.
 * A single malformed entry means some write path bypassed
 * entitlementCatalogService and we cannot trust the snapshot.
 *
 * @param {Array} limits
 * @returns {Map<string, number|null>}
 * @throws {Error} - code: ENTITLEMENT_CONFIGURATION_INVALID
 */
const buildLimitIndex = (limits) => {
  if (!Array.isArray(limits)) {
    // Defensive — assertLimitsSnapshotUsable already guarantees this.
    throw createLimitError(
      "ENTITLEMENT_CONFIGURATION_INVALID",
      "Limits must be an array"
    );
  }

  const index = new Map();

  for (let i = 0; i < limits.length; i++) {
    const entry = limits[i];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      console.error(
        "[limitService] malformed limit entry",
        { index: i, entryType: typeof entry }
      );
      throw createLimitError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Limit entry at index ${i} is not an object`
      );
    }

    if (typeof entry.key !== "string" || !entry.key.trim()) {
      console.error(
        "[limitService] limit entry has invalid key",
        { index: i, keyType: typeof entry.key, key: entry.key }
      );
      throw createLimitError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Limit entry at index ${i} has an invalid key`
      );
    }

    const normalizedKey = entry.key.trim().toUpperCase();

    if (index.has(normalizedKey)) {
      console.error(
        "[limitService] duplicate limit entry",
        { index: i, key: normalizedKey }
      );
      throw createLimitError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Duplicate limit entry: ${normalizedKey}`
      );
    }

    const value = entry.value;

    if (value !== null) {
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        console.error(
          "[limitService] limit entry has invalid value",
          {
            index: i,
            key: normalizedKey,
            valueType: typeof value,
            value,
          }
        );
        throw createLimitError(
          "ENTITLEMENT_CONFIGURATION_INVALID",
          `Limit entry ${normalizedKey} must have a non-negative safe integer or null value`
        );
      }
    }

    index.set(normalizedKey, value);
  }

  return index;
};

/**
 * Resolve the configured limit for a specific key.
 *
 * @param {*} subscription - Mongoose Subscription document
 * @param {string} normalizedLimitKey - already validated by validateLimitKey
 * @returns {{ limitKey: string, limit: number|null, unlimited: boolean }}
 * @throws {Error}
 *   - SUBSCRIPTION_INACTIVE
 *   - ENTITLEMENT_CONFIGURATION_INVALID
 *   - LIMIT_NOT_CONFIGURED
 */
const resolveLimitValue = (subscription, normalizedLimitKey) => {
  assertLimitsSnapshotUsable(subscription);

  const limitIndex = buildLimitIndex(subscription.limits || []);

  // =========================================================
  // ⚠️ 32.16.15.13 — LEGACY COMPATIBILITY PATH — DO NOT REMOVE
  //
  // Missing limit in snapshot → fail closed with
  // LIMIT_NOT_CONFIGURED. Never assume "null = unlimited".
  //
  // Protected by tests:
  //   tests/services/test-legacy-subscription-compatibility.js
  //     (Group D: limitService Legacy Behavior)
  // =========================================================
  if (!limitIndex.has(normalizedLimitKey)) {
    throw createLimitError(
      "LIMIT_NOT_CONFIGURED",
      `Limit ${normalizedLimitKey} is not configured in this subscription`
    );
  }

  const limit = limitIndex.get(normalizedLimitKey);

  return {
    limitKey: normalizedLimitKey,
    limit,
    unlimited: limit === null,
  };
};

// ---------------------------------------------------------
// .11.7 — Period Derivation (basic)
//
// Maps catalog period type → counter period key.
//
// The full, catalog-aware period handling lands in .11.11
// (e.g., historical lookups, timezone policy, .11.11 will
// also verify what the counter registry returned actually
// matches this).
//
// For .11.7, this is intentionally simple and only covers
// what `checkLimit` needs to pass to the counter.
// ---------------------------------------------------------
// ---------------------------------------------------------
// .11.11 — Monthly Period Logic
//
// V1 policy: calendar month in UTC.
//
// Rationale for UTC (per spec §7):
//   - Unambiguous, no DST edge cases
//   - Institute-local periods deferred until business
//     confirms the need
//   - Reconciliation and audit stay consistent across
//     timezones
//
// Period formats:
//   - LIFETIME_CURRENT   → "lifetime"
//   - CURRENT_USAGE      → "current"
//   - CALENDAR_MONTH_UTC → "YYYY-MM" (zero-padded, UTC)
//
// `referenceDate` is optional and defaults to `new Date()`.
// It exists for:
//   1. Test determinism (freeze time)
//   2. Future reconciliation / historical reporting
//
// Production callers (checkLimit, reserveLimit, releaseLimit)
// never pass `referenceDate` — they always use "now".
// ---------------------------------------------------------
const derivePeriod = (periodType, referenceDate = new Date()) => {
  if (periodType === "CALENDAR_MONTH_UTC") {
    const year = referenceDate.getUTCFullYear();
    const month = String(referenceDate.getUTCMonth() + 1).padStart(
      2,
      "0"
    );
    return `${year}-${month}`;
  }

  if (periodType === "CURRENT_USAGE") {
    return "current";
  }

  return "lifetime";
};

/**
 * Derive the period for a specific limit key.
 *
 * Convenience wrapper used by tests and (future)
 * reconciliation tooling. Validates the key against the
 * catalog so callers cannot silently request a period for
 * a non-existent limit.
 *
 * @param {string} limitKey
 * @param {Date}   [referenceDate=new Date()]
 * @returns {string}
 * @throws {Error} - UNKNOWN_LIMIT
 */
const derivePeriodForKey = (limitKey, referenceDate = new Date()) => {
  if (typeof limitKey !== "string" || !limitKey.trim()) {
    throw createLimitError(
      "UNKNOWN_LIMIT",
      "A valid limit key is required"
    );
  }

  const normalized = limitKey.trim().toUpperCase();
  const definition = getLimitDefinition(normalized);

  if (!definition) {
    throw createLimitError(
      "UNKNOWN_LIMIT",
      `Unknown limit: ${normalized}`
    );
  }

  return derivePeriod(definition.period, referenceDate);
};

/**
 * Return the UTC start/end boundaries of a period key.
 *
 * `end` is EXCLUSIVE (start of the next period). This matches
 * MongoDB's canonical half-open interval convention and makes
 * range queries trivial:
 *
 *   { timestamp: { $gte: bounds.start, $lt: bounds.end } }
 *
 * Returns `null` for "lifetime" and "current" because those
 * periods have no calendar bounds.
 *
 * @param {string} period
 * @returns {{ start: Date, end: Date } | null}
 * @throws {Error} - INVALID_PERIOD
 */
const getPeriodBounds = (period) => {
  if (period === "lifetime" || period === "current") {
    return null;
  }

  if (typeof period !== "string") {
    throw createLimitError(
      "INVALID_PERIOD",
      "Period must be a string"
    );
  }

  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) {
    throw createLimitError(
      "INVALID_PERIOD",
      `Invalid period format: ${period}`
    );
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);

  return {
    // Date.UTC month is 0-indexed, so (month - 1).
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    // End = first millisecond of the next month (exclusive).
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
  };
};
// ---------------------------------------------------------
// .11.10 — Counter Access Helpers
// ---------------------------------------------------------

/**
 * Read current usage for a limit.
 *
 * Strategy:
 *   - If a UsageCounter exists → use its `used` value
 *   - Otherwise → fall back to actual DB count (spec §4)
 *
 * Read-only: never creates a counter.
 */
const readCurrentUsage = async ({
  instituteId,
  limitKey,
  period,
  counterConfig,
}) => {
  const counter = await UsageCounter.findOne({
    instituteId,
    limitKey,
    period,
  }).lean();

  if (counter) {
    return counter.used;
  }

  return counterConfig.getCurrentUsage(instituteId, period);
};

/**
 * Ensure a UsageCounter exists for (instituteId, limitKey, period).
 *
 * If missing → create it initialized to the actual DB count
 * (spec §4: "authoritative database records").
 *
 * Race handling: if two callers try to create simultaneously,
 * one wins; the other catches E11000 and re-fetches.
 *
 * @param {object}   params
 * @param {string}   params.instituteId
 * @param {string}   params.limitKey
 * @param {string}   params.period
 * @param {object}   params.counterConfig - registry config
 * @param {object?}  params.session       - Mongoose session
 * @returns {Promise<Document>}
 */
const ensureCounterExists = async ({
  instituteId,
  limitKey,
  period,
  counterConfig,
  session = null,
}) => {
  let query = UsageCounter.findOne({ instituteId, limitKey, period });
  if (session) query = query.session(session);
  const existing = await query;

  if (existing) {
    return existing;
  }

  const actualUsage = await counterConfig.getCurrentUsage(
    instituteId,
    period,
    session
  );

  try {
    const doc = new UsageCounter({
      instituteId,
      limitKey,
      period,
      used: actualUsage,
    });

    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }

    return doc;
  } catch (error) {
    if (error && error.code === 11000) {
      let reQuery = UsageCounter.findOne({
        instituteId,
        limitKey,
        period,
      });
      if (session) reQuery = reQuery.session(session);
      const refetched = await reQuery;

      if (refetched) {
        return refetched;
      }

      throw createLimitError(
        "INTERNAL_ERROR",
        "Counter creation race: re-fetch failed"
      );
    }

    throw error;
  }
};

/**
 * Assert that the limit's required feature is enabled.
 * Throws FEATURE_DISABLED (or propagates corruption codes).
 */
const assertFeatureEnabledOrThrow = (subscription, definition) => {
  if (!definition.requiredFeature) {
    return;
  }

  const featureCheck = checkFeatureInSubscription(
    subscription,
    definition.requiredFeature
  );

  if (!featureCheck.allowed) {
    if (featureCheck.reason === "FEATURE_NOT_INCLUDED") {
      throw createLimitError(
        "FEATURE_DISABLED",
        `Feature ${definition.requiredFeature} is not enabled in this plan`
      );
    }
    throw createLimitError(
      featureCheck.reason || "INTERNAL_ERROR",
      `Feature check failed for ${definition.requiredFeature}: ${featureCheck.reason}`
    );
  }
};
// ---------------------------------------------------------
// .11.8 — Unlimited Response Builder
//
// Unlimited means `subscription.limits[limitKey].value === null`
// (there is NO plan-level cap on this resource).
//
// Semantics:
//   - allowed:    always true (unless input itself is invalid)
//   - limit:      null      → "no cap set"
//   - current:    null      → "no counter consulted"
//   - remaining:  null      → "not applicable"
//   - unlimited:  true      → explicit discriminator
//
// Why `current: null` and not `current: 0`?
//   0 would imply a real measurement taken against a real limit.
//   With no limit, there is nothing to measure "against". `null`
//   is the honest answer and avoids misleading UIs.
//
// Why centralize here?
//   1. Single source of truth for the response shape
//   2. Easier to add optional fields later (e.g. usage info) in
//      exactly one place
//   3. `.11.10` (reserveLimit) and `.11.13` (getLimitStatus)
//      will have their own shapes, but they share the same
//      "unlimited" semantic and can reuse this discriminator
//      reasoning.
//
// Counter guarantee:
//   The unlimited path MUST NEVER invoke the counter. This is
//   tested explicitly in `.11.8` with a counter stub that
//   throws if called.
// ---------------------------------------------------------
const buildUnlimitedDecision = ({
  limitKey,
  requested,
  period,
}) => ({
  allowed: true,
  limitKey,
  reason: null,
  limit: null,
  current: null,
  requested,
  remaining: null,
  unlimited: true,
  period,
  source: "SUBSCRIPTION",
});

// ---------------------------------------------------------
// .11.7 — Core: checkLimit
//
// Public contract (read-only — no state change):
//   checkLimit({ instituteId, limitKey, incrementBy })
//     → { allowed, limitKey, reason, limit, current,
//         requested, remaining, unlimited, period, source }
//
// Behavior summary:
//   - Never throws for expected/business failures
//   - Returns INTERNAL_ERROR for unexpected failures
//     (fail closed + console.error)
//   - For unlimited limits (null value), returns
//     allowed: true without invoking the counter
//   - For configured limits, invokes the registered
//     counter's getCurrentUsage to obtain current usage
//   - `source` is "SUBSCRIPTION" only when the decision
//     was derived from the subscription snapshot
//
// Deferred (later sub-steps):
//   - .11.8: richer unlimited edge cases + dedicated tests
//   - .11.9: feature dependency check before counter lookup
//   - .11.10: reserveLimit / releaseLimit (state-mutating)
//   - .11.11: catalog-aware period derivation (timezone,
//             historical periods)
//   - .11.12: register counters for real limits
// ---------------------------------------------------------

/**
 * Decide whether a resource creation would fit within the
 * institute's plan limit for the given key.
 *
 * Read-only: performs no writes to UsageCounter.
 *
 * @param {object} params
 * @param {*}      params.instituteId
 * @param {*}      params.limitKey
 * @param {number} [params.incrementBy=1]
 * @returns {Promise<{
 *   allowed: boolean,
 *   limitKey: string | null,
 *   reason: string | null,
 *   limit: number | null,
 *   current: number | null,
 *   requested: number | null,
 *   remaining: number | null,
 *   unlimited: boolean,
 *   period: string | null,
 *   source: "SUBSCRIPTION" | null
 * }>}
 */
const checkLimit = async ({
  instituteId,
  limitKey,
  incrementBy,
} = {}) => {
  // Captured early so the error/denied path can echo them back.
  let normalizedLimitKey = null;
  let normalizedIncrement = null;
  let resolvedLimit = null;
  let resolvedPeriod = null;

  try {
    const validatedInstituteId = validateInstituteId(instituteId);

    normalizedLimitKey = validateLimitKey(limitKey);
    normalizedIncrement = validateIncrementBy(incrementBy);

    // .10 — Resolve effective subscription.
    const subscription = await resolveEffectiveSubscription(
      validatedInstituteId
    );

    // .11.9 — Feature dependency check
    //
    // Every limit in the catalog declares a `requiredFeature`.
    // If that feature is not enabled in the subscription, the
    // limit check must fail with FEATURE_DISABLED — even if a
    // limit value happens to be configured.
    //
    // This matches the spec's "Limit configuration alone does
    // not grant feature access" rule.
    //
    // We check the feature BEFORE resolving the limit value
    // for two reasons:
    //   1. The feature is the more fundamental entitlement;
    //      "your plan doesn't include this feature" is a
    //      clearer message than "this limit isn't configured".
    //   2. Feature snapshot corruption is a bigger security
    //      concern than limit snapshot corruption — surfacing
    //      it first avoids masking it.
    const definition = getLimitDefinition(normalizedLimitKey);

    if (definition.requiredFeature) {
      const featureCheck = checkFeatureInSubscription(
        subscription,
        definition.requiredFeature
      );

      if (!featureCheck.allowed) {
        if (featureCheck.reason === "FEATURE_NOT_INCLUDED") {
          throw createLimitError(
            "FEATURE_DISABLED",
            `Feature ${definition.requiredFeature} is not enabled in this plan`
          );
        }

        // Propagate other failure codes (corruption, core feature
        // disabled, internal error) as-is — they are already
        // meaningful to the caller.
        throw createLimitError(
          featureCheck.reason || "INTERNAL_ERROR",
          `Feature check failed for ${definition.requiredFeature}: ${featureCheck.reason}`
        );
      }
    }

    // .11.6 — Resolve the limit value from the snapshot.
    const { limit, unlimited } = resolveLimitValue(
      subscription,
      normalizedLimitKey
    );
    resolvedLimit = limit;

    // Derive counter period key.
    resolvedPeriod = derivePeriod(definition.period);

    // -----------------------------------------------------
    // Unlimited short-circuit
    //
    // No counter is needed for "no cap". A null value means
    // there is no plan-level quantity limit; we return
    // immediately with current: null (nothing to count
    // against).
    // -----------------------------------------------------
    if (unlimited) {
      return buildUnlimitedDecision({
        limitKey: normalizedLimitKey,
        requested: normalizedIncrement,
        period: resolvedPeriod,
      });
    }

    // -----------------------------------------------------
    // Counter lookup
    //
    // A configured (non-null) limit without a registered
    // counter is a fail-closed condition. We refuse to
    // silently allow or deny — the caller must know the
    // counter is missing.
    // -----------------------------------------------------
    const counterConfig = limitCounterRegistry.get(normalizedLimitKey);

    if (!counterConfig) {
      throw createLimitError(
        "RESOURCE_NOT_IMPLEMENTED",
        `Counter not implemented for ${normalizedLimitKey}`
      );
    }

    // -----------------------------------------------------
    // Current usage
    //
    // .11.10 refactor: use counter value when available
    // (consistent with reserveLimit), fall back to actual
    // DB count otherwise. Read-only — never creates counter.
    // -----------------------------------------------------
    const currentUsage = await readCurrentUsage({
      instituteId: validatedInstituteId,
      limitKey: normalizedLimitKey,
      period: resolvedPeriod,
      counterConfig,
    });

    if (
      typeof currentUsage !== "number" ||
      !Number.isSafeInteger(currentUsage) ||
      currentUsage < 0
    ) {
      throw createLimitError(
        "INTERNAL_ERROR",
        "Counter returned invalid usage"
      );
    }

    const wouldBe = currentUsage + normalizedIncrement;
    const allowed = wouldBe <= resolvedLimit;

    return {
      allowed,
      limitKey: normalizedLimitKey,
      reason: allowed ? null : "LIMIT_REACHED",
      limit: resolvedLimit,
      current: currentUsage,
      requested: normalizedIncrement,
      remaining: Math.max(0, resolvedLimit - currentUsage),
      unlimited: false,
      period: resolvedPeriod,
      source: "SUBSCRIPTION",
    };
  } catch (error) {
    if (error && BUSINESS_ERROR_CODES.has(error.code)) {
      return {
        allowed: false,
        limitKey: normalizedLimitKey,
        reason: error.code,
        limit: resolvedLimit,
        current: null,
        requested: normalizedIncrement,
        remaining: null,
        unlimited: false,
        period: resolvedPeriod,
        source: null,
      };
    }

    // Unexpected error — fail closed, log with context,
    // never leak internals to the caller.
    console.error(
      "[limitService] checkLimit unexpected failure",
      {
        instituteId: String(instituteId),
        limitKey: normalizedLimitKey,
        errorName: error?.name,
        errorMessage: error?.message,
      }
    );

    return {
      allowed: false,
      limitKey: normalizedLimitKey,
      reason: "INTERNAL_ERROR",
      limit: resolvedLimit,
      current: null,
      requested: normalizedIncrement,
      remaining: null,
      unlimited: false,
      period: resolvedPeriod,
      source: null,
    };
  }
};

// ---------------------------------------------------------
// .11.10 — reserveLimit
//
// Atomically reserve capacity for a resource creation.
//
// State-mutating: increments UsageCounter.used by incrementBy.
// Throws on failure (resolver contract).
//
// Race-safe: the atomic findOneAndUpdate guarantees that
// concurrent callers cannot both observe the same `used`
// value and both increment past the limit.
//
// Transaction support: pass `session` to participate in a
// caller-side transaction (e.g., reserve + create resource
// atomically).
// ---------------------------------------------------------

/**
 * Atomically reserve `incrementBy` units of a limit.
 *
 * @param {object}   params
 * @param {*}        params.instituteId
 * @param {*}        params.limitKey
 * @param {number}   [params.incrementBy=1]
 * @param {object?}  params.session
 * @returns {Promise<{
 *   reserved: true,
 *   limitKey: string,
 *   limit: number|null,
 *   current: number|null,
 *   period: string,
 *   unlimited: boolean,
 *   counterId: string|null
 * }>}
 * @throws {Error} - any of the business codes
 */
const reserveLimit = async ({
  instituteId,
  limitKey,
  incrementBy,
  session = null,
} = {}) => {
  const validatedInstituteId = validateInstituteId(instituteId);
  const normalizedLimitKey = validateLimitKey(limitKey);
  const normalizedIncrement = validateIncrementBy(incrementBy);

  const subscription = await resolveEffectiveSubscription(
    validatedInstituteId
  );

  const definition = getLimitDefinition(normalizedLimitKey);
  assertFeatureEnabledOrThrow(subscription, definition);

  const { limit, unlimited } = resolveLimitValue(
    subscription,
    normalizedLimitKey
  );

  const period = derivePeriod(definition.period);

  if (unlimited) {
    return {
      reserved: true,
      limitKey: normalizedLimitKey,
      limit: null,
      current: null,
      period,
      unlimited: true,
      counterId: null,
    };
  }

  if (normalizedIncrement > limit) {
    throw createLimitError(
      "LIMIT_REACHED",
      `Requested ${normalizedIncrement} exceeds limit ${limit}`
    );
  }

  const counterConfig = limitCounterRegistry.get(normalizedLimitKey);
  if (!counterConfig) {
    throw createLimitError(
      "RESOURCE_NOT_IMPLEMENTED",
      `Counter not implemented for ${normalizedLimitKey}`
    );
  }

  const counter = await ensureCounterExists({
    instituteId: validatedInstituteId,
    limitKey: normalizedLimitKey,
    period,
    counterConfig,
    session,
  });

  // Atomic guard: only increment if used + increment <= limit
  //   ⇔ used <= limit - increment
  const filter = {
    _id: counter._id,
    used: { $lte: limit - normalizedIncrement },
  };

  const options = { returnDocument: "after" };
  if (session) options.session = session;

  const result = await UsageCounter.findOneAndUpdate(
    filter,
    { $inc: { used: normalizedIncrement } },
    options
  );

  if (!result) {
    throw createLimitError(
      "LIMIT_REACHED",
      `Would exceed limit ${limit} for ${normalizedLimitKey}`
    );
  }

  return {
    reserved: true,
    limitKey: normalizedLimitKey,
    limit,
    current: result.used,
    period,
    unlimited: false,
    counterId: String(result._id),
  };
};
// ---------------------------------------------------------
// .11.10 — releaseLimit
//
// Atomically release `amount` units previously reserved.
//
// Use cases (server-side only — NEVER expose to end users):
//   - Resource creation failed after a successful reserve
//   - Manual correction after an abnormal event
//
// Safety:
//   - Floors at zero via atomic filter; throws
//     RELEASE_BELOW_ZERO instead of going negative.
//   - Does NOT check feature dependency — this is a
//     correction operation; blocking it on disabled
//     features would leave phantom usage.
// ---------------------------------------------------------

/**
 * Atomically release `amount` units of a limit.
 *
 * @param {object}   params
 * @param {*}        params.instituteId
 * @param {*}        params.limitKey
 * @param {number}   params.amount - required, positive integer
 * @param {object?}  params.session
 * @returns {Promise<{
 *   released: true,
 *   limitKey: string,
 *   current: number|null,
 *   period: string,
 *   unlimited: boolean
 * }>}
 * @throws {Error} - any business code including RELEASE_BELOW_ZERO
 */
const releaseLimit = async ({
  instituteId,
  limitKey,
  amount,
  session = null,
} = {}) => {
  const validatedInstituteId = validateInstituteId(instituteId);
  const normalizedLimitKey = validateLimitKey(limitKey);
  const normalizedAmount = validateAmount(amount);

  const subscription = await resolveEffectiveSubscription(
    validatedInstituteId
  );

  const definition = getLimitDefinition(normalizedLimitKey);
  const { unlimited } = resolveLimitValue(
    subscription,
    normalizedLimitKey
  );

  const period = derivePeriod(definition.period);

  if (unlimited) {
    return {
      released: true,
      limitKey: normalizedLimitKey,
      current: null,
      period,
      unlimited: true,
    };
  }

  const counterConfig = limitCounterRegistry.get(normalizedLimitKey);
  if (!counterConfig) {
    throw createLimitError(
      "RESOURCE_NOT_IMPLEMENTED",
      `Counter not implemented for ${normalizedLimitKey}`
    );
  }

  const counter = await ensureCounterExists({
    instituteId: validatedInstituteId,
    limitKey: normalizedLimitKey,
    period,
    counterConfig,
    session,
  });

  const filter = {
    _id: counter._id,
    used: { $gte: normalizedAmount },
  };

  const options = { returnDocument: "after" };
  if (session) options.session = session;

  const result = await UsageCounter.findOneAndUpdate(
    filter,
    { $inc: { used: -normalizedAmount } },
    options
  );

  if (!result) {
    console.warn(
      "[limitService] releaseLimit would go below zero",
      {
        instituteId: String(validatedInstituteId),
        limitKey: normalizedLimitKey,
        period,
        attemptedAmount: normalizedAmount,
        currentUsed: counter.used,
      }
    );
    throw createLimitError(
      "RELEASE_BELOW_ZERO",
      `Cannot release ${normalizedAmount} when only ${counter.used} used`
    );
  }

  return {
    released: true,
    limitKey: normalizedLimitKey,
    current: result.used,
    period,
    unlimited: false,
  };
};

// ---------------------------------------------------------
// .11.13 — getLimitStatus
//
// Read-only status of a single limit.
//
// Resolver contract (throws on failure), consistent with
// reserveLimit and releaseLimit:
//   - FEATURE_DISABLED for limits whose required feature
//     is not enabled
//   - RESOURCE_NOT_IMPLEMENTED for limits whose counter
//     is not registered
//   - LIMIT_NOT_CONFIGURED for limits absent from snapshot
//   - ENTITLEMENT_CONFIGURATION_INVALID for corrupted data
//   - SUBSCRIPTION_INACTIVE for missing subscription
//
// For a bulk dashboard view (which must NOT throw on
// per-limit failures), use `getAllLimitStatuses`.
//
// `LIMIT_REACHED` is intentionally NOT thrown here — this
// is a status query, not a reservation attempt.
// ---------------------------------------------------------

/**
 * Full status of a single limit.
 *
 * @param {object} params
 * @param {*}      params.instituteId
 * @param {*}      params.limitKey
 * @returns {Promise<{
 *   limitKey: string,
 *   limit: number | null,
 *   current: number | null,
 *   remaining: number | null,
 *   unlimited: boolean,
 *   period: string,
 *   lastReconciledAt: Date | null
 * }>}
 */
const getLimitStatus = async ({ instituteId, limitKey } = {}) => {
  const validatedInstituteId = validateInstituteId(instituteId);
  const normalizedLimitKey = validateLimitKey(limitKey);

  const subscription = await resolveEffectiveSubscription(
    validatedInstituteId
  );

  const definition = getLimitDefinition(normalizedLimitKey);
  assertFeatureEnabledOrThrow(subscription, definition);

  const { limit, unlimited } = resolveLimitValue(
    subscription,
    normalizedLimitKey
  );
  const period = derivePeriod(definition.period);

  if (unlimited) {
    return {
      limitKey: normalizedLimitKey,
      limit: null,
      current: null,
      remaining: null,
      unlimited: true,
      period,
      lastReconciledAt: null,
    };
  }

  const counterConfig = limitCounterRegistry.get(normalizedLimitKey);
  if (!counterConfig) {
    throw createLimitError(
      "RESOURCE_NOT_IMPLEMENTED",
      `Counter not implemented for ${normalizedLimitKey}`
    );
  }

  const currentUsage = await readCurrentUsage({
    instituteId: validatedInstituteId,
    limitKey: normalizedLimitKey,
    period,
    counterConfig,
  });

  // Extra read for reconciliation metadata (optional field).
  const counter = await UsageCounter.findOne({
    instituteId: validatedInstituteId,
    limitKey: normalizedLimitKey,
    period,
  }).lean();

  return {
    limitKey: normalizedLimitKey,
    limit,
    current: currentUsage,
    remaining: Math.max(0, limit - currentUsage),
    unlimited: false,
    period,
    lastReconciledAt: counter?.lastReconciledAt ?? null,
  };
};

// ---------------------------------------------------------
// .11.13 — getAllLimitStatuses
//
// Dashboard-friendly bulk view.
//
// Key differences from getLimitStatus:
//   1. Returns ALL 13 catalog limits in one call
//   2. Never throws on per-limit failures — marks each entry
//      with `implemented: false` and the `error` code
//   3. Single subscription fetch (not 13)
//   4. Order follows LIMIT_CATALOG definition order
//      (matches intuitive dashboard layout)
//
// Per-limit `implemented` semantics:
//   - true  : limit is configured AND counter is registered,
//             so `current`/`remaining` are real numbers
//   - false : either the limit isn't configured in the
//             snapshot (error: LIMIT_NOT_CONFIGURED) or the
//             counter isn't registered
//             (error: RESOURCE_NOT_IMPLEMENTED)
//
// Feature dependency is NOT evaluated here. Feature state
// belongs to the entitlement layer (getInstituteEntitlements).
// The UI is expected to combine both calls. This separation
// keeps `getAllLimitStatuses` single-purpose.
//
// The only exceptions this function throws are "whole-call"
// failures (invalid institute, no subscription, corrupted
// snapshot) — because without a subscription there is no
// meaningful bulk answer.
// ---------------------------------------------------------

/**
 * Full status of every limit in the catalog for one institute.
 *
 * @param {object} params
 * @param {*}      params.instituteId
 * @returns {Promise<{
 *   instituteId: string,
 *   subscription: {
 *     id: string,
 *     plan: string,
 *     planVersion: number,
 *     status: string,
 *     endDate: Date | null
 *   },
 *   limits: Array<{
 *     limitKey: string,
 *     limit: number | null,
 *     current: number | null,
 *     remaining: number | null,
 *     unlimited: boolean,
 *     implemented: boolean,
 *     period: string,
 *     error: string | null
 *   }>
 * }>}
 */
const getAllLimitStatuses = async ({ instituteId } = {}) => {
  const validatedInstituteId = validateInstituteId(instituteId);

  const subscription = await resolveEffectiveSubscription(
    validatedInstituteId
  );

  assertLimitsSnapshotUsable(subscription);
  const limitIndex = buildLimitIndex(subscription.limits || []);

  const results = [];

  for (const limitKey of Object.keys(LIMIT_CATALOG)) {
    const definition = LIMIT_CATALOG[limitKey];
    const period = derivePeriod(definition.period);

    // Not configured in this subscription.
    if (!limitIndex.has(limitKey)) {
      results.push({
        limitKey,
        limit: null,
        current: null,
        remaining: null,
        unlimited: false,
        implemented: false,
        period,
        error: "LIMIT_NOT_CONFIGURED",
      });
      continue;
    }

    const limit = limitIndex.get(limitKey);
    const unlimited = limit === null;

    // Unlimited — no counter needed.
    if (unlimited) {
      results.push({
        limitKey,
        limit: null,
        current: null,
        remaining: null,
        unlimited: true,
        implemented: true,
        period,
        error: null,
      });
      continue;
    }

    // Configured, but no counter registered (pending limit).
    const counterConfig = limitCounterRegistry.get(limitKey);
    if (!counterConfig) {
      results.push({
        limitKey,
        limit,
        current: null,
        remaining: null,
        unlimited: false,
        implemented: false,
        period,
        error: "RESOURCE_NOT_IMPLEMENTED",
      });
      continue;
    }

    // Read usage — isolate failures per limit so one broken
    // counter doesn't break the entire dashboard.
    let currentUsage;
    try {
      currentUsage = await readCurrentUsage({
        instituteId: validatedInstituteId,
        limitKey,
        period,
        counterConfig,
      });
    } catch (err) {
      console.error(
        "[limitService] getAllLimitStatuses: usage read failed",
        {
          instituteId: validatedInstituteId,
          limitKey,
          period,
          errorMessage: err?.message,
        }
      );

      results.push({
        limitKey,
        limit,
        current: null,
        remaining: null,
        unlimited: false,
        implemented: true,
        period,
        error: "INTERNAL_ERROR",
      });
      continue;
    }

    results.push({
      limitKey,
      limit,
      current: currentUsage,
      remaining: Math.max(0, limit - currentUsage),
      unlimited: false,
      implemented: true,
      period,
      error: null,
    });
  }

  return {
    instituteId: validatedInstituteId,
    subscription: {
      id: String(subscription._id),
      plan: subscription.plan,
      planVersion: subscription.planVersion,
      status: subscription.status,
      endDate: subscription.endDate ?? null,
    },
    limits: results,
  };
};

// ---------------------------------------------------------
// .11.12 — Counter bootstrap
//
// Requiring this file registers all production counters.
// Must run after limitService itself is fully defined —
// hence placement at the bottom (avoid circular init).
//
// The require is idempotent: re-requiring from another
// module or test reuses the cached registration.
// ---------------------------------------------------------
require("./counters");
module.exports = {
  validateLimitKey,
  validateIncrementBy,
  validateAmount,
  resolveLimitValue,
  assertLimitsSnapshotUsable,
  checkLimit,
  reserveLimit,
  releaseLimit,
  derivePeriodForKey,
  getPeriodBounds,
  getLimitStatus,
  getAllLimitStatuses,
};