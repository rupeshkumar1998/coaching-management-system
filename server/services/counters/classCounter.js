const Class = require("../../models/Class");
const limitCounterRegistry = require("../limitCounterRegistry");

// =========================================================
// 32.16.16 — MAX_CLASSES Counter
//
// Counts active (non-deleted) classes for an institute.
//
// Important: `isActive: false` does NOT free up capacity.
// This prevents abuse where an institute could:
//   1. Disable a class → create a new one
//   2. Re-enable the old one
//   3. Now exceed the plan limit
//
// Only soft-deleted classes (isDeleted: true) are excluded.
// =========================================================

const LIMIT_KEY = "MAX_CLASSES";

const getCurrentUsage = async (instituteId, _period, session = null) => {
  let query = Class.countDocuments({
    instituteId,
    isDeleted: false,
  });

  if (session) {
    query = query.session(session);
  }

  return query;
};

const register = () => {
  limitCounterRegistry.register(LIMIT_KEY, {
    periodType: "LIFETIME_CURRENT",
    getCurrentUsage,
  });
};

module.exports = { LIMIT_KEY, getCurrentUsage, register };