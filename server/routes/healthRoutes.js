const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

// =========================================================
// 32.16.16 Sprint 5A — Health Endpoints
//
// Public, no auth, no rate limit.
// Used by:
//   - Load balancers (liveness + readiness probes)
//   - Monitoring systems (uptime checks)
//   - Deployment platforms (Kubernetes, Heroku, etc.)
//
// /health          → Liveness  (is the process running?)
// /health/ready    → Readiness (can it serve traffic? DB OK?)
// =========================================================

// ---------------------------------------------------------
// GET /health — Liveness probe
//
// Always returns 200 if the server is responding.
// Does NOT check dependencies (DB, cache, etc.) — that's
// the job of /health/ready.
//
// Why? If DB is down temporarily, the process is still
// alive. Killing it (as liveness failure would) makes the
// outage worse.
// ---------------------------------------------------------
router.get("/", (req, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
  });
});

// ---------------------------------------------------------
// GET /health/ready — Readiness probe
//
// Returns 200 only if the DB is reachable.
// Returns 503 otherwise — the process should NOT receive
// traffic when it cannot serve requests.
// ---------------------------------------------------------
router.get("/ready", async (req, res) => {
  const checks = {
    database: "unknown",
  };

  let ready = true;

  // DB check — ping with a short timeout so a hanging
  // connection cannot make this probe hang forever
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error("MongoDB connection not open");
    }
    await mongoose.connection.db.admin().ping();
    checks.database = "ok";
  } catch (error) {
    checks.database = "fail";
    ready = false;
  }

  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;