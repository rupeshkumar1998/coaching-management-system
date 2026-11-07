const limitCounterRegistry = require("../limitCounterRegistry");

const studentCounter = require("./studentCounter");
const teacherCounter = require("./teacherCounter");
const adminCounter = require("./adminCounter");
const parentCounter = require("./parentCounter");

// =========================================================
// 32.16.15.11 — Counter Bootstrap
//
// Registers all production counters with the registry.
//
// Behavior:
//   - Auto-registers on first require (production path)
//   - Idempotent: skips counters already present
//   - Exported `registerAllCounters()` lets tests re-register
//     after calling `__resetForTests()`
//
// The 9 unregistered limits (CLASSES, BATCHES, LEADS, EXAMS,
// STORAGE, SMS, WHATSAPP, EMAILS, API_REQUESTS) intentionally
// remain unregistered so the Limit Service reports
// RESOURCE_NOT_IMPLEMENTED for them (fail-closed per spec).
// =========================================================

const ALL_COUNTERS = Object.freeze([
  studentCounter,
  teacherCounter,
  adminCounter,
  parentCounter,
]);

const registerAllCounters = () => {
  for (const counter of ALL_COUNTERS) {
    if (!limitCounterRegistry.has(counter.LIMIT_KEY)) {
      counter.register();
    }
  }
};

// Production auto-registration.
registerAllCounters();

module.exports = {
  registerAllCounters,
  counters: ALL_COUNTERS,
};