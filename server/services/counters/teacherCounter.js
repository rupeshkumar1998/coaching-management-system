const Teacher = require("../../models/Teacher");
const limitCounterRegistry = require("../limitCounterRegistry");

// =========================================================
// 32.16.15.11 — MAX_TEACHERS Counter
//
// Counts teachers who are currently part of the
// institute's teaching workforce.
//
// Rule (confirmed with product):
//   ACTIVE    → count
//   ON_LEAVE  → count (still employed)
//   INACTIVE  → do NOT count
//   TERMINATED → do NOT count
//
// Source of truth: `Teacher` model, NOT `User.isActive`.
// Rationale: `Teacher.status` is the employment truth;
// `User.isActive` is a login flag. See the architecture
// discussion in the .11 planning.
// =========================================================

const LIMIT_KEY = "MAX_TEACHERS";

const COUNTED_STATUSES = Object.freeze(["ACTIVE", "ON_LEAVE"]);

const getCurrentUsage = async (instituteId, _period, session = null) => {
  let query = Teacher.countDocuments({
    instituteId,
    isDeleted: false,
    status: { $in: COUNTED_STATUSES },
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

module.exports = {
  LIMIT_KEY,
  COUNTED_STATUSES,
  getCurrentUsage,
  register,
};