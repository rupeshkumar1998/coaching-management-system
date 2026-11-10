// =========================================================
// 32.16.16 Sprint 5C — Structured Logger
//
// Minimal, dependency-free structured logger.
//
// Behavior:
//   - Production (NODE_ENV=production): JSON lines
//   - Development/test: human-readable
//   - Respects LOG_LEVEL env (error/warn/info/debug)
//   - Default level: debug (non-prod), info (prod)
//
// Usage:
//   const logger = require("../utils/logger");
//   logger.info("Server started", { port: 5000 });
//   logger.error("DB connection failed", { error: err.message });
// =========================================================

const LEVELS = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
});

const getCurrentLevel = () => {
  const explicit = String(process.env.LOG_LEVEL || "").toLowerCase();
  if (explicit && Object.prototype.hasOwnProperty.call(LEVELS, explicit)) {
    return LEVELS[explicit];
  }
  return process.env.NODE_ENV === "production"
    ? LEVELS.info
    : LEVELS.debug;
};

const CURRENT_LEVEL = getCurrentLevel();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const shouldLog = (level) => LEVELS[level] <= CURRENT_LEVEL;

const formatMessage = (level, message, context) => {
  const timestamp = new Date().toISOString();
  const hasContext =
    context &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    Object.keys(context).length > 0;

  if (IS_PRODUCTION) {
    const payload = { timestamp, level, message };
    if (hasContext) payload.context = context;
    return JSON.stringify(payload);
  }

  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  return hasContext ? `${base} ${JSON.stringify(context)}` : base;
};

const write = (level, message, context) => {
  if (!shouldLog(level)) return;

  const line = formatMessage(level, message, context);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

const logger = {
  error: (message, context) => write("error", message, context),
  warn: (message, context) => write("warn", message, context),
  info: (message, context) => write("info", message, context),
  debug: (message, context) => write("debug", message, context),
};

module.exports = logger;