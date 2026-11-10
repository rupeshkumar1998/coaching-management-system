const Batch = require("../../models/Batch");
const limitCounterRegistry = require("../limitCounterRegistry");

// =========================================================
// 32.16.16 — MAX_BATCHES Counter
//
// Counts non-deleted batches for an institute.
//
// Important: status=INACTIVE does NOT free up capacity.
// Only soft-deleted (isDeleted: true) are excluded — and
// delete is blocked at the model layer anyway.
// =========================================================

const LIMIT_KEY = "MAX_BATCHES";

const getCurrentUsage = async (instituteId, _period, session = null) => {
  let query = Batch.countDocuments({
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