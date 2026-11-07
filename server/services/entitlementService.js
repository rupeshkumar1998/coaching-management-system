const mongoose = require("mongoose");

const {
  getFeatureDefinition,
  isCoreFeature,
} = require("../constants/featureCatalog");

// =========================================================
// 32.16.15.10 — Entitlement Service
//
// Central resolver: "Does this institute's current
// subscription include feature X?"
//
// Distinct from:
//   - Permission check  (can this USER do this action?)
//   - Limit check       (HOW MUCH can they use?)
//
// This file is built incrementally across sub-steps
// 32.16.15.10.3 → 32.16.15.10.13.
// =========================================================

// ---------------------------------------------------------
// Shared error factory
//
// `code` is the stable identifier consumed by the public
// functions in later steps. Messages are human-readable
// only; they are never parsed by callers.
// ---------------------------------------------------------

const createEntitlementError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// Business error codes
//
// These are the *expected*, controlled failures that the
// public API converts into `{ allowed: false, reason }`.
// Anything not in this set is treated as an unexpected
// error and reported as INTERNAL_ERROR.
//
// Frozen to prevent accidental mutation at runtime.
// ---------------------------------------------------------
const BUSINESS_ERROR_CODES = Object.freeze(
  new Set([
    "INSTITUTE_CONTEXT_REQUIRED",
    "UNKNOWN_FEATURE",
    "SUBSCRIPTION_INACTIVE",
    "ENTITLEMENT_SNAPSHOT_MISSING",       // used from .10.7 onward
    "ENTITLEMENT_CONFIGURATION_INVALID",
  ])
);

// ---------------------------------------------------------
// .10.3 — Input Validation Layer
//
// These helpers THROW on invalid input. The public
// `checkFeatureAccess` (built in .10.5) wraps them and
// converts the thrown errors into the `{ allowed, reason }`
// contract.
//
// Rationale:
//   - Internal helpers throw → simpler code, less repetition
//   - Public function catches → predictable caller contract
// ---------------------------------------------------------

/**
 * Validate an institute identifier coming from a trusted
 * request context.
 *
 * Trust boundary:
 *   The caller (controller / middleware) is responsible for
 *   ensuring `instituteId` came from the authenticated
 *   request context, NEVER directly from user input.
 *
 * @param {*} instituteId  - ObjectId or ObjectId-like string
 * @returns {string}       - normalized id (string form)
 * @throws {Error}         - with code INSTITUTE_CONTEXT_REQUIRED
 */
const validateInstituteId = (instituteId) => {
  if (!instituteId) {
    throw createEntitlementError(
      "INSTITUTE_CONTEXT_REQUIRED",
      "A valid institute context is required"
    );
  }

  if (!mongoose.isValidObjectId(instituteId)) {
    throw createEntitlementError(
      "INSTITUTE_CONTEXT_REQUIRED",
      "A valid institute context is required"
    );
  }

  return String(instituteId);
};

/**
 * Validate a feature key.
 *
 * Rules:
 *   - Must be a non-empty string
 *   - Must be a known feature in the catalog
 *   - Must be active in the catalog
 *     (a retired feature is treated as UNKNOWN_FEATURE because
 *      the catalog no longer exposes it for use; this is the
 *      fail-closed behavior)
 *
 * Normalization:
 *   The returned key is trimmed and uppercased so that callers
 *   can pass "exam_test_management" or " EXAM_TEST_MANAGEMENT "
 *   and both resolve identically.
 *
 * @param {*} featureKey   - string
 * @returns {string}       - normalized uppercase key
 * @throws {Error}         - with code UNKNOWN_FEATURE
 */
const validateFeatureKey = (featureKey) => {
  if (typeof featureKey !== "string" || !featureKey.trim()) {
    throw createEntitlementError(
      "UNKNOWN_FEATURE",
      "A valid feature key is required"
    );
  }

  const normalized = featureKey.trim().toUpperCase();
  const definition = getFeatureDefinition(normalized);

  if (!definition) {
    throw createEntitlementError(
      "UNKNOWN_FEATURE",
      `Unknown feature: ${normalized}`
    );
  }

  if (definition.isActive !== true) {
    throw createEntitlementError(
      "UNKNOWN_FEATURE",
      `Feature is inactive: ${normalized}`
    );
  }

  return normalized;
};

// ---------------------------------------------------------
// Exports (temporary — will be extended in .10.4 → .10.9)
// ---------------------------------------------------------

// ---------------------------------------------------------
// .10.4 — Effective Subscription Resolution
//
// Wraps subscriptionService.getEffectiveSubscription.
//
// Why a wrapper?
//   1. Centralizes the "no active subscription → error" rule
//   2. Reuses the battle-tested date/status logic in
//      subscriptionService instead of duplicating it
//   3. Keeps the rest of entitlementService free from
//      subscription-specific plumbing
//
// Trust boundary:
//   instituteId must already be validated by the caller.
//   We validate again defensively — cheap and safe.
//
// Behavior:
//   - Missing / invalid instituteId    → throws INSTITUTE_CONTEXT_REQUIRED
//   - No effective subscription        → throws SUBSCRIPTION_INACTIVE
//   - Otherwise returns the Mongoose Subscription document
// ---------------------------------------------------------

/**
 * Resolve the institute's currently effective subscription.
 *
 * @param {*} instituteId - ObjectId or ObjectId-like string
 * @returns {Promise<import("mongoose").Document>} - Subscription document
 * @throws {Error} - code: INSTITUTE_CONTEXT_REQUIRED | SUBSCRIPTION_INACTIVE
 */
const resolveEffectiveSubscription = async (instituteId) => {
  const normalizedInstituteId = validateInstituteId(instituteId);

  // Lazy require to avoid loading subscriptionService at module
  // load time. This keeps the dependency graph shallow and makes
  // future testing (e.g. stubbing subscriptionService) trivial.
  const {
    getEffectiveSubscription,
  } = require("./subscriptionService");

  const subscription = await getEffectiveSubscription(
    normalizedInstituteId
  );

  if (!subscription) {
    throw createEntitlementError(
      "SUBSCRIPTION_INACTIVE",
      "Institute has no effective active subscription"
    );
  }

  return subscription;
};

// ---------------------------------------------------------
// .10.7 — Feature Snapshot Usability
//
// Distinguishes three states of `subscription.features`:
//
//   1. undefined  → legacy record, data migration required
//                   code: ENTITLEMENT_SNAPSHOT_MISSING
//
//   2. non-array  → corruption (string, object, null, ...)
//                   code: ENTITLEMENT_CONFIGURATION_INVALID
//
//   3. array      → OK; per-entry validation happens later
//                   (in .10.8 for feature entries; .10.6 for
//                   CORE mandatory presence)
//
// Both 1 and 2 log with full context so that on-call
// engineers can act on the data integrity issue without
// having to re-run queries themselves.
//
// Why a helper?
//   .10.9 (getInstituteEntitlements) will need the same
//   check. Duplicating it would invite drift between the
//   two code paths.
// ---------------------------------------------------------
const assertFeatureSnapshotUsable = (subscription) => {
  if (!subscription) {
    throw createEntitlementError(
      "SUBSCRIPTION_INACTIVE",
      "A subscription is required"
    );
  }

  if (subscription.features === undefined) {
    console.error(
      "[entitlementService] legacy subscription without feature snapshot",
      {
        subscriptionId: String(subscription._id),
        instituteId: String(subscription.instituteId),
        planVersion: subscription.planVersion,
        planVersionId: subscription.planVersionId
          ? String(subscription.planVersionId)
          : null,
        subscriptionType: subscription.subscriptionType,
        createdAt: subscription.createdAt,
      }
    );

    throw createEntitlementError(
      "ENTITLEMENT_SNAPSHOT_MISSING",
      "Subscription has no feature snapshot; data migration required"
    );
  }

  if (!Array.isArray(subscription.features)) {
    console.error(
      "[entitlementService] malformed feature snapshot",
      {
        subscriptionId: String(subscription._id),
        instituteId: String(subscription.instituteId),
        featuresType: typeof subscription.features,
      }
    );

    throw createEntitlementError(
      "ENTITLEMENT_CONFIGURATION_INVALID",
      "Subscription feature snapshot is malformed"
    );
  }
};

// ---------------------------------------------------------
// .10.8 — Feature Index Builder
//
// Validates every feature entry and returns a Map
// { normalizedKey → enabled }.
//
// Why validate ALL entries (not just the requested one)?
//   A malformed entry means some write path bypassed
//   entitlementCatalogService — so we cannot trust the
//   snapshot as a whole. Fail-closed on any corruption.
//
// Why build a Map instead of Array.find?
//   1. O(1) lookup instead of O(n)
//   2. Duplicate detection for free
//   3. Normalization happens once
//
// Silent about which features exist?
//   We do NOT validate that keys are in the current
//   catalog — a snapshot may legitimately contain
//   features that were retired from the catalog later.
//   Requests for such features are already rejected by
//   validateFeatureKey (.10.3).
// ---------------------------------------------------------
const buildFeatureIndex = (features) => {
  if (!Array.isArray(features)) {
    // Defensive — .10.7 already guarantees this.
    throw createEntitlementError(
      "ENTITLEMENT_CONFIGURATION_INVALID",
      "Features must be an array"
    );
  }

  const index = new Map();

  for (let i = 0; i < features.length; i++) {
    const entry = features[i];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      console.error(
        "[entitlementService] malformed feature entry",
        { index: i, entryType: typeof entry }
      );
      throw createEntitlementError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Feature entry at index ${i} is not an object`
      );
    }

    if (typeof entry.key !== "string" || !entry.key.trim()) {
      console.error(
        "[entitlementService] feature entry has invalid key",
        { index: i, keyType: typeof entry.key, key: entry.key }
      );
      throw createEntitlementError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Feature entry at index ${i} has an invalid key`
      );
    }

    const normalizedKey = entry.key.trim().toUpperCase();

    if (index.has(normalizedKey)) {
      console.error(
        "[entitlementService] duplicate feature entry",
        { index: i, key: normalizedKey }
      );
      throw createEntitlementError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Duplicate feature entry: ${normalizedKey}`
      );
    }

    if (typeof entry.enabled !== "boolean") {
      console.error(
        "[entitlementService] feature entry has non-boolean enabled",
        {
          index: i,
          key: normalizedKey,
          enabledType: typeof entry.enabled,
          enabled: entry.enabled,
        }
      );
      throw createEntitlementError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        `Feature entry ${normalizedKey} has a non-boolean enabled value`
      );
    }

    index.set(normalizedKey, entry.enabled);
  }

  return index;
};

// ---------------------------------------------------------
// .10.5 — Core: Feature Access Decision
//
// Public contract:
//   checkFeatureAccess(instituteId, featureKey)
//     → { allowed, featureKey, reason, source }
//
// Behavior summary:
//   - Never throws for expected/business failures
//   - Returns `INTERNAL_ERROR` for unexpected failures
//     (fail closed, plus console.error for debugging)
//   - `source` is "SUBSCRIPTION" only when the decision was
//     derived from the subscription's feature snapshot;
//     otherwise null.
//
// Edge cases handled:
//   - Invalid instituteId / featureKey  → .10.3
//   - No effective subscription         → .10.4
//   - Malformed features array          → defensive guard
//
// Edge cases deferred to later steps:
//   - CORE feature disabled in snapshot → .10.6
//   - features === undefined (legacy)   → .10.7
//   - Malformed feature *entries*       → .10.8
//
// IMPORTANT — what this function does NOT do:
//   - Permission checking (that's permissionMiddleware)
//   - Limit checking (that's .11)
//   - Cross-tenant resolution (tenantId must be trusted
//     from auth context by the caller)
// ---------------------------------------------------------

/**
 * Decide whether an institute's current subscription includes
 * and enables a specific feature.
 *
 * @param {*} instituteId - ObjectId or ObjectId-like string
 * @param {*} featureKey  - feature key (case-insensitive)
 * @returns {Promise<{
 *   allowed: boolean,
 *   featureKey: string | null,
 *   reason: string | null,
 *   source: "SUBSCRIPTION" | null
 * }>}
 */
const checkFeatureAccess = async (instituteId, featureKey) => {
  // Captured early so the error/denied path can echo it back.
  // Stays null until validateFeatureKey succeeds.
  let normalizedFeatureKey = null;

  try {
    const validatedInstituteId = validateInstituteId(instituteId);

    normalizedFeatureKey = validateFeatureKey(featureKey);

    const subscription = await resolveEffectiveSubscription(
      validatedInstituteId
    );

    // .10.7 — Reusable snapshot validation.
    // Distinguishes legacy-missing from corrupted-malformed.
    assertFeatureSnapshotUsable(subscription);

    // .10.8 — Build a validated, normalized feature index.
    // Any malformed entry → snapshot corruption → fail closed.
    const featureIndex = buildFeatureIndex(subscription.features);

    const isEnabled = featureIndex.get(normalizedFeatureKey) === true;
    const requestedIsCore = isCoreFeature(normalizedFeatureKey);

    // -----------------------------------------------------
    // .10.6 — Core Security Feature Protection
    //
    // CORE features are mandatory by contract and can never
    // be disabled through the catalog validation layer.
    //
    // If we find one disabled (or missing) in the snapshot,
    // the snapshot is corrupted → fail closed with
    // ENTITLEMENT_CONFIGURATION_INVALID and log for the
    // on-call engineer.
    //
    // This is a defense-in-depth check: normal writes go
    // through entitlementCatalogService, but DB-level
    // corruption or a bypassed path must never silently
    // disable a core security control.
    // -----------------------------------------------------
    if (requestedIsCore) {
      if (!isEnabled) {
        console.error(
          "[entitlementService] CORE feature corrupted in subscription snapshot",
          {
            instituteId: validatedInstituteId,
            subscriptionId: String(subscription._id),
            featureKey: normalizedFeatureKey,
            entryFound: featureIndex.has(normalizedFeatureKey),
            enabled: featureIndex.get(normalizedFeatureKey) ?? null,
          }
        );

        return {
          allowed: false,
          featureKey: normalizedFeatureKey,
          reason: "ENTITLEMENT_CONFIGURATION_INVALID",
          source: null,
        };
      }

      return {
        allowed: true,
        featureKey: normalizedFeatureKey,
        reason: null,
        source: "SUBSCRIPTION",
      };
    }

    // -----------------------------------------------------
    // Commercial feature path — unchanged from .10.5
    // -----------------------------------------------------
    if (!isEnabled) {
      return {
        allowed: false,
        featureKey: normalizedFeatureKey,
        reason: "FEATURE_NOT_INCLUDED",
        source: "SUBSCRIPTION",
      };
    }

    return {
      allowed: true,
      featureKey: normalizedFeatureKey,
      reason: null,
      source: "SUBSCRIPTION",
    };


  } catch (error) {
    if (error && BUSINESS_ERROR_CODES.has(error.code)) {
      return {
        allowed: false,
        featureKey: normalizedFeatureKey,
        reason: error.code,
        source: null,
      };
    }

    // Unexpected error — never leak internals to the caller,
    // never allow access, always log for observability.
    console.error(
      "[entitlementService] checkFeatureAccess unexpected failure",
      {
        instituteId: String(instituteId),
        featureKey: normalizedFeatureKey,
        errorName: error?.name,
        errorMessage: error?.message,
      }
    );

    return {
      allowed: false,
      featureKey: normalizedFeatureKey,
      reason: "INTERNAL_ERROR",
      source: null,
    };
  }
};

// ---------------------------------------------------------
// .11.9 — Check feature in an already-loaded subscription
//
// Same decision logic as `checkFeatureAccess`, but avoids
// the redundant DB round-trip when the caller already has
// the subscription document (e.g., LimitService.checkLimit).
//
// This is the reusable primitive that lets higher layers
// enforce feature dependencies without a second query.
//
// Note: The middle portion duplicates the logic from
// `checkFeatureAccess`. If the duplication ever causes
// drift, refactor both to share an internal helper.
// For now, keeping the public surface stable is more
// valuable than micro-optimizing code size.
// ---------------------------------------------------------

/**
 * Check whether a specific feature is enabled in an
 * already-resolved subscription. Pure — no DB calls.
 *
 * @param {object} subscription - Mongoose Subscription document
 * @param {*} featureKey        - case-insensitive feature key
 * @returns {{ allowed: boolean, featureKey: string|null, reason: string|null, source: "SUBSCRIPTION"|null }}
 */
const checkFeatureInSubscription = (subscription, featureKey) => {
  let normalizedFeatureKey = null;

  try {
    if (!subscription) {
      throw createEntitlementError(
        "SUBSCRIPTION_INACTIVE",
        "A subscription is required"
      );
    }

    normalizedFeatureKey = validateFeatureKey(featureKey);
    assertFeatureSnapshotUsable(subscription);

    const featureIndex = buildFeatureIndex(subscription.features);
    const isEnabled = featureIndex.get(normalizedFeatureKey) === true;
    const requestedIsCore = isCoreFeature(normalizedFeatureKey);

    if (requestedIsCore) {
      if (!isEnabled) {
        console.error(
          "[entitlementService] CORE feature corrupted in subscription snapshot",
          {
            subscriptionId: String(subscription._id),
            featureKey: normalizedFeatureKey,
            entryFound: featureIndex.has(normalizedFeatureKey),
            enabled: featureIndex.get(normalizedFeatureKey) ?? null,
          }
        );

        return {
          allowed: false,
          featureKey: normalizedFeatureKey,
          reason: "ENTITLEMENT_CONFIGURATION_INVALID",
          source: null,
        };
      }

      return {
        allowed: true,
        featureKey: normalizedFeatureKey,
        reason: null,
        source: "SUBSCRIPTION",
      };
    }

    if (!isEnabled) {
      return {
        allowed: false,
        featureKey: normalizedFeatureKey,
        reason: "FEATURE_NOT_INCLUDED",
        source: "SUBSCRIPTION",
      };
    }

    return {
      allowed: true,
      featureKey: normalizedFeatureKey,
      reason: null,
      source: "SUBSCRIPTION",
    };
  } catch (error) {
    if (error && BUSINESS_ERROR_CODES.has(error.code)) {
      return {
        allowed: false,
        featureKey: normalizedFeatureKey,
        reason: error.code,
        source: null,
      };
    }

    console.error(
      "[entitlementService] checkFeatureInSubscription unexpected failure",
      {
        subscriptionId: String(subscription?._id || "unknown"),
        featureKey: normalizedFeatureKey,
        errorName: error?.name,
        errorMessage: error?.message,
      }
    );

    return {
      allowed: false,
      featureKey: normalizedFeatureKey,
      reason: "INTERNAL_ERROR",
      source: null,
    };
  }
};

/**
 * Convenience wrapper: boolean-only form of checkFeatureAccess.
 *
 * Use this in controllers where you only need a boolean.
 * For controllers that must branch on WHY access was denied,
 * use checkFeatureAccess directly.
 *
 * @param {*} instituteId
 * @param {*} featureKey
 * @returns {Promise<boolean>}
 */
const hasFeature = async (instituteId, featureKey) => {
  const result = await checkFeatureAccess(instituteId, featureKey);
  return result.allowed === true;
};

// ---------------------------------------------------------
// .10.9 — Bulk Entitlements
//
// Resolver (not decision):
//   - Returns the full entitlement configuration
//   - THROWS on invalid input / inactive sub / corrupted data
//   - Caller is expected to try/catch
//
// Contrast with checkFeatureAccess:
//   - checkFeatureAccess returns { allowed, reason }
//   - checkFeatureAccess never throws for business errors
//
// Use cases:
//   - Institute dashboard: show current plan + features + limits
//   - Controller bulk check: obtain the whole snapshot once,
//     then decide locally without extra DB queries
//   - Audit / reporting: capture the current entitlement state
//
// Feature ordering:
//   Features are sorted alphabetically so dashboard rendering
//   is stable regardless of the order stored in MongoDB.
//
// Limits handling:
//   - `limits === undefined` → empty array (legacy subs where
//     limits were not snapshotted; truthful "no explicit limits")
//   - non-array → ENTITLEMENT_CONFIGURATION_INVALID
//   - array → returned with a light structural map (entries
//     lacking `key` or with non-numeric `value` are passed
//     through but marked; full semantic validation lives in .11)
//
// Deferred:
//   - `verifyIntegrity` option: cross-checks against the
//     referenced SubscriptionPlanVersion. Not implemented in
//     .10.9; will be added when the caller needs it.
// ---------------------------------------------------------

/**
 * Return the full entitlement configuration for an institute.
 *
 * @param {*} instituteId - ObjectId or ObjectId-like string
 * @returns {Promise<{
 *   instituteId: string,
 *   subscription: {
 *     id: string,
 *     type: "STANDARD" | "TRIAL",
 *     plan: string,
 *     planVersion: number,
 *     planVersionId: string | null,
 *     status: string,
 *     startDate: Date | null,
 *     endDate: Date | null,
 *     effectiveUntil: Date | null
 *   },
 *   features: Array<{ key: string, enabled: boolean }>,
 *   limits: Array<{ key: string | null, value: number | null }>,
 *   source: "SUBSCRIPTION"
 * }>}
 *
 * @throws {Error}
 *   - INSTITUTE_CONTEXT_REQUIRED
 *   - SUBSCRIPTION_INACTIVE
 *   - ENTITLEMENT_SNAPSHOT_MISSING
 *   - ENTITLEMENT_CONFIGURATION_INVALID
 */
const getInstituteEntitlements = async (instituteId) => {
  const validatedInstituteId = validateInstituteId(instituteId);

  const subscription = await resolveEffectiveSubscription(
    validatedInstituteId
  );

  // Same guards as checkFeatureAccess — snapshot must be usable
  // before we expose it to the caller.
  assertFeatureSnapshotUsable(subscription);
  const featureIndex = buildFeatureIndex(subscription.features);

  const features = Array.from(featureIndex.entries())
    .map(([key, enabled]) => ({ key, enabled }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Limits: light structural handling. Semantic validation
  // (requiredFeature dependency, value type, etc.) belongs to
  // .11 — Limit Service. Here we only guarantee a usable array
  // shape for dashboards.
  let limits = [];

  if (subscription.limits !== undefined && subscription.limits !== null) {
    if (!Array.isArray(subscription.limits)) {
      console.error(
        "[entitlementService] malformed limits snapshot",
        {
          subscriptionId: String(subscription._id),
          instituteId: validatedInstituteId,
          limitsType: typeof subscription.limits,
        }
      );

      throw createEntitlementError(
        "ENTITLEMENT_CONFIGURATION_INVALID",
        "Subscription limits snapshot is malformed"
      );
    }

    limits = subscription.limits.map((item) => ({
      key:
        item && typeof item.key === "string"
          ? item.key.trim().toUpperCase()
          : null,
      value:
        item && typeof item.value === "number" ? item.value : null,
    }));
  }

  return {
    instituteId: validatedInstituteId,
    subscription: {
      id: String(subscription._id),
      type: subscription.subscriptionType,
      plan: subscription.plan,
      planVersion: subscription.planVersion,
      planVersionId: subscription.planVersionId
        ? String(subscription.planVersionId)
        : null,
      status: subscription.status,
      startDate: subscription.startDate ?? null,
      endDate: subscription.endDate ?? null,
      // For now, effectiveUntil equals endDate. When auto-renew
      // logic lands, this is the field to recompute without
      // touching the historical `endDate`.
      effectiveUntil: subscription.endDate ?? null,
    },
    features,
    limits,
    source: "SUBSCRIPTION",
  };
};

module.exports = {
  validateInstituteId,
  validateFeatureKey,
  resolveEffectiveSubscription,
  checkFeatureAccess,
  checkFeatureInSubscription,
  hasFeature,
  getInstituteEntitlements,
};