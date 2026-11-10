// =========================================================
// 32.16.16 Sprint 5D — Environment Validation
//
// Fails fast on startup if required env vars are missing
// or invalid. Prevents cryptic runtime errors later.
//
// Called once from server.js BEFORE app.listen().
// =========================================================

const REQUIRED = [
  { key: "MONGO_URI", description: "MongoDB connection string" },
  { key: "JWT_SECRET", description: "Secret used to sign JWT tokens" },
  { key: "CLIENT_URL", description: "Frontend URL for CORS" },
];

const validateEnv = () => {
  const missing = [];

  for (const { key, description } of REQUIRED) {
    const value = process.env[key];

    if (!value || typeof value !== "string" || value.trim() === "") {
      missing.push(`  - ${key} (${description})`);
    }
  }

  if (missing.length > 0) {
    console.error("");
    console.error("❌ Environment validation failed. Missing required variables:");
    console.error(missing.join("\n"));
    console.error("");
    console.error("Fix:");
    console.error("  1. Copy .env.example to .env");
    console.error("  2. Fill in the missing values");
    console.error("  3. Restart the server");
    console.error("");
    process.exit(1);
  }

  // Additional sanity checks
  if (
    process.env.NODE_ENV === "production" &&
    process.env.JWT_SECRET.length < 32
  ) {
    console.error("");
    console.error("❌ JWT_SECRET must be at least 32 characters in production.");
    console.error("");
    process.exit(1);
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.CLIENT_URL.includes("localhost")
  ) {
    console.warn(
      "⚠️  CLIENT_URL still points to localhost in production. " +
        "Update it before deploying."
    );
  }
};

module.exports = validateEnv;