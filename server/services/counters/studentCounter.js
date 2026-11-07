const User = require("../../models/User");
const limitCounterRegistry = require("../limitCounterRegistry");

// =========================================================
// 32.16.15.11 — MAX_STUDENTS Counter
//
// Counts active student Users within an institute.
//
// Active means:
//   isActive: true   AND
//   accountStatus: "ACTIVE"   AND
//   isDeleted: false
//
// Not counted: pending, suspended, rejected, deleted.
// =========================================================

const LIMIT_KEY = "MAX_STUDENTS";

const getCurrentUsage = async (instituteId, _period, session = null) => {
  let query = User.countDocuments({
    instituteId,
    role: "STUDENT",
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