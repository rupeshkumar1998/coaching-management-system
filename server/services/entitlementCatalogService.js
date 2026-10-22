const {
  FEATURE_CATALOG,
  getFeatureDefinition,
  getMandatoryFeatureKeys,
} = require("../constants/featureCatalog");

const {
  LIMIT_CATALOG,
  getLimitDefinition,
} = require("../constants/limitCatalog");

const createEntitlementError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const normalizeKey = (key, type) => {
  if (typeof key !== "string" || !key.trim()) {
    throw createEntitlementError(
      "INVALID_ENTITLEMENT_KEY",
      `${type} key must be a non-empty string`
    );
  }

  return key.trim().toUpperCase();
};

const validateFeatures = (features) => {
  if (!Array.isArray(features)) {
    throw createEntitlementError(
      "INVALID_FEATURES",
      "Features must be an array"
    );
  }

  const seen = new Set();
  const normalized = [];

  for (const item of features) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createEntitlementError(
        "INVALID_FEATURE_ENTRY",
        "Each feature must be an object"
      );
    }

    const key = normalizeKey(item.key, "Feature");

    if (seen.has(key)) {
      throw createEntitlementError(
        "DUPLICATE_FEATURE",
        `Duplicate feature: ${key}`
      );
    }

    seen.add(key);

    const definition = getFeatureDefinition(key);

    if (!definition) {
      throw createEntitlementError(
        "UNKNOWN_FEATURE",
        `Unknown feature: ${key}`
      );
    }
    if (definition.isActive !== true) {
      throw createEntitlementError(
        "INACTIVE_FEATURE",
        `Feature is inactive and cannot be configured: ${key}`
      );
   }

    if (typeof item.enabled !== "boolean") {
      throw createEntitlementError(
        "INVALID_FEATURE_VALUE",
        `Feature ${key} must have a boolean enabled value`
      );
    }

    if (definition.category === "CORE" && item.enabled !== true) {
      throw createEntitlementError(
        "CORE_FEATURE_CANNOT_BE_DISABLED",
        `Mandatory core feature cannot be disabled: ${key}`
      );
    }

    normalized.push({
      key,
      enabled: item.enabled,
    });
  }

  const suppliedKeys = new Set(
    normalized.map((item) => item.key)
  );

  for (const key of getMandatoryFeatureKeys()) {
    if (!suppliedKeys.has(key)) {
      throw createEntitlementError(
        "MISSING_CORE_FEATURE",
        `Mandatory core feature is missing: ${key}`
      );
    }
  }

  return normalized;
};

const validateLimits = (limits, features) => {
  if (!Array.isArray(limits)) {
    throw createEntitlementError(
      "INVALID_LIMITS",
      "Limits must be an array"
    );
  }

  const seen = new Set();

  const featureState = new Map(
    features.map((item) => [item.key, item.enabled])
  );

  const normalized = [];

  for (const item of limits) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createEntitlementError(
        "INVALID_LIMIT_ENTRY",
        "Each limit must be an object"
      );
    }

    const key = normalizeKey(item.key, "Limit");

    if (seen.has(key)) {
      throw createEntitlementError(
        "DUPLICATE_LIMIT",
        `Duplicate limit: ${key}`
      );
    }

    seen.add(key);

    const definition = getLimitDefinition(key);

    if (!definition) {
      throw createEntitlementError(
        "UNKNOWN_LIMIT",
        `Unknown limit: ${key}`
      );
    }
    if (definition.isActive !== true) {
      throw createEntitlementError(
       "INACTIVE_LIMIT",
       `Limit is inactive and cannot be configured: ${key}`
    );
    }

    const value = item.value;

    if (
      value !== null &&
      (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 0
      )
    ) {
      throw createEntitlementError(
        "INVALID_LIMIT_VALUE",
        `Limit ${key} must be a non-negative safe integer or null`
      );
    }

    const featureEnabled = featureState.get(
      definition.requiredFeature
    );

    if (featureEnabled !== true) {
      throw createEntitlementError(
        "LIMIT_REQUIRES_FEATURE",
        `Limit ${key} requires enabled feature ${definition.requiredFeature}`
      );
    }

    normalized.push({
      key,
      value,
    });
  }

  return normalized;
};

const validateEntitlementConfiguration = ({
  features,
  limits,
}) => {
  const normalizedFeatures = validateFeatures(features);

  const normalizedLimits = validateLimits(
    limits,
    normalizedFeatures
  );

  return {
    features: normalizedFeatures,
    limits: normalizedLimits,
  };
};

const getCatalogSummary = () => ({
  coreFeatures: Object.keys(
    require("../constants/featureCatalog").CORE_FEATURES
  ),
  commercialFeatures: Object.keys(
    require("../constants/featureCatalog").COMMERCIAL_FEATURES
  ),
  limits: Object.keys(LIMIT_CATALOG),
});

module.exports = {
  validateFeatures,
  validateLimits,
  validateEntitlementConfiguration,
  getCatalogSummary,
};