// =========================================================
// 32.16.15.9.17 — Final Verification Master Runner
//
// Runs every subscription-plan test file in order and produces
// an aggregated PASS/FAIL report. Designed for CI use.
//
// Usage:
//   node tests/run-all-subscription-plan-tests.js
// =========================================================

const { spawn } = require("child_process");
const path = require("path");

const TEST_FILES = [
  // .13 — Institute read-only boundary
  {
    phase: "32.16.15.9.13",
    label: "Institute Plan Controller (unit)",
    file: "tests/controllers/test-institute-subscription-plan-controller.js",
  },

  // .14 — Audit logging
  {
    phase: "32.16.15.9.14",
    label: "Plan Audit Logging",
    file: "tests/services/test-plan-audit-logging.js",
  },
  {
    phase: "32.16.15.9.14",
    label: "Plan Service Regression",
    file: "tests/services/test-subscription-plan-service.js",
  },
  {
    phase: "32.16.15.9.14",
    label: "Plan Version Service Regression",
    file: "tests/services/test-subscription-plan-version-service.js",
  },
  {
    phase: "32.16.15.9.14",
    label: "Snapshot Immutability Regression",
    file: "tests/services/test-subscription-snapshot-immutability.js",
  },

  // .15 — Financial integrity
  {
    phase: "32.16.15.9.15",
    label: "Financial Integrity",
    file: "tests/services/test-financial-integrity.js",
  },

  // // 32.16.15.10 — Entitlement Service
  // {
  //   phase: "32.16.15.10",
  //   label: "Entitlement Service",
  //   file: "tests/services/test-entitlement-service.js",
  // },

  // .16 — Security and regression (API level)
  {
    phase: "32.16.15.9.16",
    label: "Institute Read-Only API",
    file: "tests/api/test-institute-plan-read-only-api.js",
  },
  {
    phase: "32.16.15.9.16",
    label: "Audit Log API",
    file: "tests/api/test-audit-log-api.js",
  },
  {
    phase: "32.16.15.9.16",
    label: "E2E Plan Management Regression",
    file: "tests/integration/test-plan-management-regression.js",
  },
  {
    phase: "32.16.15.9.16",
    label: "Super Admin Write Boundary Matrix",
    file: "tests/api/test-super-admin-write-boundary.js",
  },


   // 32.16.15.10 — Entitlement Service
  {
    phase: "32.16.15.10",
    label: "Entitlement Service",
    file: "tests/services/test-entitlement-service.js",
  },

    // 32.16.15.11 — Limit Service
  {
    phase: "32.16.15.11",
    label: "Limit Counter Registry",
    file: "tests/services/test-limit-counter-registry.js",
  },
  {
    phase: "32.16.15.11",
    label: "Limit Counter Implementations",
    file: "tests/services/test-limit-counters.js",
  },
  {
    phase: "32.16.15.11",
    label: "Limit Service Core",
    file: "tests/services/test-limit-service.js",
  },
];


function runTestFile(relativeFile) {
  return new Promise((resolve) => {
    const absolutePath = path.join(__dirname, "..", relativeFile);

    const child = spawn(process.execPath, [absolutePath], {
      cwd: path.join(__dirname, ".."),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      // Primary format: "Passed: X" / "Failed: Y"
      // (used by the majority of test files)
      const passedMatch = stdout.match(/Passed:\s*(\d+)/);
      const failedMatch = stdout.match(/Failed:\s*(\d+)/);

      let passed = passedMatch ? parseInt(passedMatch[1], 10) : null;
      let failed = failedMatch ? parseInt(failedMatch[1], 10) : null;

      // Fallback format 1: "X PASS / Y FAIL"
      if (passed === null) {
        const altPass = stdout.match(/(\d+)\s+PASS/i);
        if (altPass) {
          passed = parseInt(altPass[1], 10);
        }
      }
      if (failed === null) {
        const altFail = stdout.match(/(\d+)\s+FAIL/i);
        if (altFail) {
          failed = parseInt(altFail[1], 10);
        }
      }

      // Fallback format 2: count "PASS: ..." / "FAIL: ..." lines
      if (passed === null) {
        const passLines = stdout.match(/^PASS:/gm);
        passed = passLines ? passLines.length : 0;
      }
      if (failed === null) {
        const failLines = stdout.match(/^FAIL:/gm);
        failed = failLines ? failLines.length : 0;
      }

      resolve({
        exitCode: code,
        passed: passed ?? 0,
        failed: failed ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

async function run() {
  console.log("═".repeat(72));
  console.log("  32.16.15 — Subscription & Entitlement Stack (Phases .9–.11): FULL TEST SUITE");
  console.log("═".repeat(72));
  console.log();

  let totalPassed = 0;
  let totalFailed = 0;
  const results = [];

  for (const entry of TEST_FILES) {
    process.stdout.write(
      `[${entry.phase}] ${entry.label} ... `
    );

    const result = await runTestFile(entry.file);

    if (result.exitCode === 0 && result.failed === 0) {
      console.log(`✅ ${result.passed} passed`);
    } else {
      console.log(`❌ ${result.failed} failed (exit ${result.exitCode})`);
      console.log();
      console.log("── stdout ──");
      console.log(result.stdout);
      console.log("── stderr ──");
      console.log(result.stderr);
      console.log();
    }

    totalPassed += result.passed;
    totalFailed += result.failed;
    results.push({ entry, result });
  }

  console.log();
  console.log("═".repeat(72));
  console.log("  FINAL SUMMARY");
  console.log("═".repeat(72));

  for (const { entry, result } of results) {
    const status =
      result.exitCode === 0 && result.failed === 0 ? "PASS" : "FAIL";
    console.log(
      `  [${status}] ${entry.phase.padEnd(16)} ${entry.label.padEnd(42)} ${String(result.passed).padStart(3)} passed, ${result.failed} failed`
    );
  }

  console.log("─".repeat(72));
  console.log(
    `  TOTAL: ${totalPassed} passed, ${totalFailed} failed`
  );
  console.log("═".repeat(72));

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("MASTER RUNNER ERROR:", error);
  process.exitCode = 1;
});