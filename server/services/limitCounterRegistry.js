const {
  LIMIT_CATALOG,
  getLimitDefinition,
} = require("../constants/limitCatalog");

// =========================================================
// 32.16.15.11 — Limit Counter Registry
//
// Strategy-pattern registry that maps limit keys to their
// counter implementations.
//
// Design principles:
//   - One counter per limit key (fail-closed on duplicates)
//   - Registration validated against LIMIT_CATALOG
//   - Frozen config after registration (no runtime mutation)
//   - Unregistered keys → `null` (caller decides how to fail)
//   - `__resetForTests` for test isolation only
//
// This module has NO dependencies on limitService.js or any
// counter implementation. It is a pure lookup + validation
// layer. Counter modules import this registry and call
// `register(...)` at module load.
// =========================================================

const SUPPORTED_PERIOD_TYPES = Object.freeze(
  new Set([
    "LIFETIME_CURRENT",
    "CALENDAR_MONTH_UTC",
    "CURRENT_USAGE",
  ])
);

// Internal registry map (normalized limitKey → frozen config)
const registrations = new Map();

// ---------------------------------------------------------
// Error factory
// ---------------------------------------------------------

const createRegistryError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

// ---------------------------------------------------------
// Public — Register a counter for a limit key
//
// Throws (all set `error.code`):
//   - INVALID_LIMIT_KEY
//   - UNKNOWN_LIMIT
//   - INVALID_COUNTER_CONFIG
//   - UNSUPPORTED_PERIOD_TYPE
//   - PERIOD_TYPE_MISMATCH
//   - MISSING_GET_CURRENT_USAGE
//   - COUNTER_ALREADY_REGISTERED
// ---------------------------------------------------------

const register = (limitKey, config) => {
  if (typeof limitKey !== "string" || !limitKey.trim()) {
    throw createRegistryError(
      "INVALID_LIMIT_KEY",
      "A valid limit key is required"
    );
  }

  const normalized = limitKey.trim().toUpperCase();

  // 1. Must exist in the catalog.
  const definition = getLimitDefinition(normalized);
  if (!definition) {
    throw createRegistryError(
      "UNKNOWN_LIMIT",
      `Cannot register unknown limit: ${normalized}`
    );
  }

  // 2. Config must be a plain object.
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw createRegistryError(
      "INVALID_COUNTER_CONFIG",
      "Counter config must be an object"
    );
  }

  // 3. Period type must be supported.
  if (!SUPPORTED_PERIOD_TYPES.has(config.periodType)) {
    throw createRegistryError(
      "UNSUPPORTED_PERIOD_TYPE",
      `Unsupported period type: ${config.periodType}`
    );
  }

  // 4. Period type must match the catalog definition.
  //    Prevents a runtime that quietly disagrees with the
  //    published catalog (which would confuse callers).
  if (config.periodType !== definition.period) {
    throw createRegistryError(
      "PERIOD_TYPE_MISMATCH",
      `Counter period type (${config.periodType}) does not match catalog (${definition.period}) for ${normalized}`
    );
  }

  // 5. The counter must provide an actual usage lookup.
  if (typeof config.getCurrentUsage !== "function") {
    throw createRegistryError(
      "MISSING_GET_CURRENT_USAGE",
      "getCurrentUsage must be a function"
    );
  }

  // 6. One counter per key.
  if (registrations.has(normalized)) {
    throw createRegistryError(
      "COUNTER_ALREADY_REGISTERED",
      `Counter already registered for ${normalized}`
    );
  }

  // 7. Freeze the config so callers cannot mutate it later.
  registrations.set(
    normalized,
    Object.freeze({
      limitKey: normalized,
      periodType: config.periodType,
      getCurrentUsage: config.getCurrentUsage,
      // `reconcile` is optional; stored for the future
      // reconciliation job in a later phase.
      reconcile:
        typeof config.reconcile === "function"
          ? config.reconcile
          : null,
    })
  );
};

// ---------------------------------------------------------
// Public — Lookup
//
// Returns the frozen config or null. Never throws — callers
// decide whether "not registered" is a fail or a warning.
// ---------------------------------------------------------

const get = (limitKey) => {
  if (typeof limitKey !== "string" || !limitKey.trim()) {
    return null;
  }
  return registrations.get(limitKey.trim().toUpperCase()) || null;
};

const has = (limitKey) => get(limitKey) !== null;

// ---------------------------------------------------------
// Public — Introspection (for dashboards, tests, diagnostics)
// ---------------------------------------------------------

const getRegisteredLimitKeys = () =>
  Array.from(registrations.keys()).sort();

const getUnregisteredLimitKeys = () =>
  Object.keys(LIMIT_CATALOG)
    .filter((key) => !registrations.has(key))
    .sort();

// ---------------------------------------------------------
// Test-only reset
//
// Clears the registry so a single test file can:
//   1. Reset
//   2. Register mock counters
//   3. Assert
//   4. Reset again
//
// MUST NEVER be called from production code.
// ---------------------------------------------------------

const __resetForTests = () => {
  registrations.clear();
};

module.exports = {
  register,
  get,
  has,
  getRegisteredLimitKeys,
  getUnregisteredLimitKeys,
  __resetForTests,
};