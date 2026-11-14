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

  {
    phase: "32.16.18a",
    label: "Student Login Flow",
    file: "tests/api/test-student-login-flow.js",
  },
  
  // 32.16.17.6 - Teacher Permission Boundary
  {
    phase: "32.16.17.6",
    label: "Permission Middleware (Teacher)",
    file: "tests/permissions/test-permission-middleware-teacher.js",
  },
  {
    phase: "32.16.17.6",
    label: "Permission Service (Teacher)",
    file: "tests/services/test-permission-service-teacher.js",
  },

  // 32.16.17.7-.13 ΓÇö Student Attendance Management
  {
    phase: "32.16.17.7",
    label: "Student Attendance Model",
    file: "tests/models/test-student-attendance-model.js",
  },
  {
    phase: "32.16.17.10",
    label: "Student Attendance Service",
    file: "tests/services/test-student-attendance-service.js",
  },
  {
    phase: "32.16.17.13",
    label: "Student Attendance Routes (Admin)",
    file: "tests/api/test-student-attendance-routes.js",
  },
  {
    phase: "32.16.17.13",
    label: "Student Attendance Routes (Teacher)",
    file: "tests/api/test-teacher-student-attendance-routes.js",
  },

  {
    phase: "32.16.17.3",
    label: "Teacher Attendance LATE",
    file: "tests/api/test-teacher-attendance-late.js",
  },


  // 32.16.16 — Sprint 1: Class Management
  {
    phase: "32.16.16",
    label: "Class Model",
    file: "tests/models/test-class-model.js",
  },
  {
    phase: "32.16.16",
    label: "Class Service",
    file: "tests/services/test-class-service.js",
  },
  {
    phase: "32.16.16",
    label: "Class Routes",
    file: "tests/api/test-class-routes.js",
  },

  {
    phase: "32.16.16",
    label: "Batch Model",
    file: "tests/models/test-batch-model.js",
  },
  {
    phase: "32.16.16",
    label: "Batch Service",
    file: "tests/services/test-batch-service.js",
  },
  {
    phase: "32.16.16",
    label: "Batch Routes",
    file: "tests/api/test-batch-routes.js",
  },

  {
    phase: "32.16.16",
    label: "User Student Fields",
    file: "tests/models/test-user-student-fields.js",
  },
  {
    phase: "32.16.16",
    label: "Student Service",
    file: "tests/services/test-student-service.js",
  },
  {
    phase: "32.16.16",
    label: "Student Routes",
    file: "tests/api/test-student-routes.js",
  },

  {
    phase: "32.16.16",
    label: "Owner Admin Limit",
    file: "tests/controllers/test-owner-admin-limit.js",
  },
  {
    phase: "32.16.16",
    label: "Parent Service",
    file: "tests/services/test-parent-service.js",
  },
  {
    phase: "32.16.16",
    label: "Parent Routes",
    file: "tests/api/test-parent-routes.js",
  },
  {
    phase: "32.16.16",
    label: "Admin Teacher (limit-wired)",
    file: "tests/controllers/test-admin-teacher.js",
  },

  {
    phase: "32.16.16",
    label: "Subscription Usage Routes",
    file: "tests/api/test-subscription-usage-routes.js",
  },

  {
    phase: "32.16.16",
    label: "Concurrent Limits (HTTP)",
    file: "tests/integration/test-concurrent-limits-http.js",
  },
  {
    phase: "32.16.16",
    label: "Plan Change Limit Impact",
    file: "tests/integration/test-plan-change-limit-impact.js",
  },
  {
    phase: "32.16.16",
    label: "Cross-Feature Limits",
    file: "tests/integration/test-cross-feature-limits.js",
  },

  // 32.16.15 — Milestone (phases .9–.18)
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

  // 32.16.15.12 — Subscription Snapshot Creation
  {
    phase: "32.16.15.12",
    label: "Subscription Snapshot Builder (unit)",
    file: "tests/services/test-subscription-snapshot-builder.js",
  },
  {
    phase: "32.16.15.12",
    label: "Subscription Snapshot Creation",
    file: "tests/services/test-subscription-snapshot-creation.js",
  },
  {
    phase: "32.16.15.12",
    label: "Subscription Service Regression",
    file: "tests/services/test-subscription-service.js",
  },

  // 32.16.15.13 — Legacy Subscription Compatibility
  {
    phase: "32.16.15.13",
    label: "Legacy Subscription Compatibility",
    file: "tests/services/test-legacy-subscription-compatibility.js",
  },
  // 32.16.15.14 — Permission ↔ Entitlement Boundary
  {
    phase: "32.16.15.14",
    label: "Permission-Entitlement Boundary",
    file: "tests/api/test-permission-entitlement-boundary.js",
  },

  // 32.16.15.15 — Trial Offer Admin Routes
  {
    phase: "32.16.15.15",
    label: "Trial Offer Admin Routes",
    file: "tests/api/test-trial-offer-admin-routes.js",
  },

  // 32.16.15.15 — Trial Offer Toggle Regression
  {
    phase: "32.16.15.15",
    label: "Trial Offer Toggle Regression",
    file: "tests/services/test-trial-offer-toggle-regression.js",
  },

  // 32.16.15.16 — Plan Version Regression
  {
    phase: "32.16.15.16",
    label: "Plan Version Immutability (existing)",
    file: "tests/services/test-subscription-plan-version-immutability.js",
  },
  {
    phase: "32.16.15.16",
    label: "Plan Version Regression (consolidated)",
    file: "tests/services/test-plan-version-regression.js",
  },

  // 32.16.15.17 — Feature/Limit Change Regression
  {
    phase: "32.16.15.17",
    label: "Entitlement Catalog Validation (existing)",
    file: "tests/services/test-entitlement-catalog.js",
  },
  {
    phase: "32.16.15.17",
    label: "Feature-Limit Change Regression",
    file: "tests/services/test-feature-limit-change-regression.js",
  },

  // 32.16.15.18 — Final Entitlement Security Regression
  {
    phase: "32.16.15.18",
    label: "Final Entitlement Security Regression",
    file: "tests/api/test-final-entitlement-security-regression.js",
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
  console.log("  Coaching Management — Full Test Suite");
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