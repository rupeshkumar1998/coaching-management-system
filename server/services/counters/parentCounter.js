const User = require("../../models/User");
const limitCounterRegistry = require("../limitCounterRegistry");

// =========================================================
// 32.16.15.11 — MAX_PARENTS Counter
//
// Counts active parent Users within an institute.
// Same active-state rule as students, but role = PARENT.
// =========================================================

const LIMIT_KEY = "MAX_PARENTS";

const getCurrentUsage = async (instituteId, _period, session = null) => {
  let query = User.countDocuments({
    instituteId,
    role: "PARENT",
    isActive: true,
    accountStatus: "ACTIVE",
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