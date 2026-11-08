require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");


const connectTestDB = require("../helpers/connectTestDB");

const protect = require("../../middleware/authMiddleware");
const tenantIsolation = require("../../middleware/tenantMiddleware");
const requirePermission = require("../../middleware/permissionMiddleware");
const {
  checkFeatureAccess,
} = require("../../services/entitlementService");

// =========================================================
// 32.16.15.14 — Permission ↔ Entitlement Boundary Tests
//
// Part A (this file section):
//   Contract-level verification that permission and
//   entitlement are INDEPENDENT. Passing one does NOT
//   grant the other.
//
// Part B (added in .14.4):
//   API-level integration with both middlewares active.
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPermissionIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const instituteId = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `PE_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Permission-Entitlement Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);
  return instituteId;
};

const makeActiveSubscription = async (instituteId, features = []) => {
  const now = Date.now();
  const subId = new mongoose.Types.ObjectId();
  await Subscription.collection.insertOne({
    _id: subId,
    instituteId,
    subscriptionType: "STANDARD",
    plan: "PRO",
    planVersion: 1,
    planVersionId: null,
    amount: 1999,
    currency: "INR",
    paymentRequired: true,
    durationDays: 30,
    status: "ACTIVE",
    startDate: new Date(now - 86400000),
    endDate: new Date(now + 86400000 * 30),
    features,
    limits: [],
    snapshotCapturedAt: new Date(now),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  createdSubscriptionIds.push(subId);
  return subId;
};

const makeUser = async (role, instituteId = null) => {
  const userId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: userId,
    instituteId,
    name: `Test ${role}`,
    email: `pe-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(userId);
  return userId;
};

const makePermission = async (permissionKey) => {
  // Reuse existing permission if present (test DB may have
  // leftovers from previous permission tests). Only create
  // when genuinely missing.
  const existing = await Permission.findOne({ permissionKey });
  if (existing) {
    return existing._id;
  }

  const permissionId = new mongoose.Types.ObjectId();
  await Permission.collection.insertOne({
    _id: permissionId,
    permissionKey,
    isActive: true,
    category: "INSTITUTE",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPermissionIds.push(permissionId);
  return permissionId;
};

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

const makeRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});


// ---------------------------------------------------------
// Part B — HTTP helpers
// ---------------------------------------------------------

const makeToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const request = async (baseUrl, requestPath, options = {}) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token
        ? { Cookie: `accessToken=${options.token}` }
        : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: response.status, data };
};


// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // Group A — Contract Tests (4 tests)
    //
    // Verify that permission and entitlement are
    // independent contracts. Passing one does NOT
    // silently grant the other.
    // =====================================================

    await test(
      "A1: permissionMiddleware does not import entitlementService",
      async () => {
        const source = fs.readFileSync(
          path.join(
            __dirname,
            "../../middleware/permissionMiddleware.js"
          ),
          "utf8"
        );

        const importPattern =
          /require\s*\(\s*["'][^"']*entitlementService["']\s*\)/;

        assert(
          !importPattern.test(source),
          "permissionMiddleware.js must NOT import entitlementService " +
            "(found require statement — contract violated)"
        );
      }
    );

    await test(
      "A2: entitlementService does not import permissionMiddleware",
      async () => {
        const source = fs.readFileSync(
          path.join(__dirname, "../../services/entitlementService.js"),
          "utf8"
        );

        const importPattern =
          /require\s*\(\s*["'][^"']*permissionMiddleware["']\s*\)/;

        assert(
          !importPattern.test(source),
          "entitlementService.js must NOT import permissionMiddleware " +
            "(found require statement — contract violated)"
        );
      }
    );

    await test(
      "A3: SUPER_ADMIN bypasses permission, but entitlement still evaluates",
      async () => {
        const instituteId = await makeInstitute();
        // Subscription without the STUDENT_MANAGEMENT feature
        await makeActiveSubscription(instituteId, []);

        const superAdminId = await makeUser("SUPER_ADMIN", null);

        // Part 1: SUPER_ADMIN bypasses permission middleware
        // (no Permission record needed — SUPER_ADMIN bypasses
        //  before the permission lookup).
        let permissionPassed = false;
        const permissionReq = {
          user: { _id: superAdminId, role: "SUPER_ADMIN" },
        };
        const permissionRes = makeRes();

        await requirePermission("STUDENT_CREATE")(
          permissionReq,
          permissionRes,
          () => {
            permissionPassed = true;
          }
        );

        assert(
          permissionPassed,
          "SUPER_ADMIN must bypass permission middleware"
        );

        // Part 2: entitlement still denies (feature not in snapshot)
        const ent = await checkFeatureAccess(
          String(instituteId),
          "STUDENT_MANAGEMENT"
        );

        assert(
          ent.allowed === false,
          "Entitlement must deny (feature OFF) even though " +
            "SUPER_ADMIN bypassed permission"
        );
        assert(
          ent.reason === "FEATURE_NOT_INCLUDED",
          `Expected FEATURE_NOT_INCLUDED, got ${ent.reason}`
        );
      }
    );

    await test(
      "A4: INSTITUTE_OWNER bypasses permission, but entitlement still evaluates",
      async () => {
        const instituteId = await makeInstitute();
        await makeActiveSubscription(instituteId, []);
        await makePermission("STUDENT_CREATE");

        const ownerId = await makeUser("INSTITUTE_OWNER", instituteId);

        // Part 1: INSTITUTE_OWNER bypasses permission middleware
        let permissionPassed = false;
        const permissionReq = {
          user: {
            _id: ownerId,
            role: "INSTITUTE_OWNER",
            instituteId,
            isActive: true,
            accountStatus: "ACTIVE",
            isDeleted: false,
          },
          tenantId: instituteId,
        };
        const permissionRes = makeRes();

        await requirePermission("STUDENT_CREATE")(
          permissionReq,
          permissionRes,
          () => {
            permissionPassed = true;
          }
        );

        assert(
          permissionPassed,
          "INSTITUTE_OWNER must bypass permission middleware"
        );

        // Part 2: entitlement still denies (feature not in snapshot)
        const ent = await checkFeatureAccess(
          String(instituteId),
          "STUDENT_MANAGEMENT"
        );

        assert(
          ent.allowed === false,
          "Entitlement must deny even though OWNER bypassed permission"
        );
        assert(
          ent.reason === "FEATURE_NOT_INCLUDED",
          `Expected FEATURE_NOT_INCLUDED, got ${ent.reason}`
        );
      }
    );

        // =====================================================
    // Part B — API Integration Tests (4 tests)
    //
    // Verifies that permission middleware and entitlement
    // check work together correctly in a real HTTP flow.
    //
    // Inline test app — isolated, no production routes touched.
    // =====================================================

    const testApp = express();
    testApp.use(express.json());
    testApp.use(cookieParser());

    testApp.post(
      "/api/test/combined",
      protect,
      tenantIsolation,
      requirePermission("STUDENT_CREATE"),
      async (req, res) => {
        try {
          const ent = await checkFeatureAccess(
            req.tenantId,
            "STUDENT_MANAGEMENT"
          );
          if (!ent.allowed) {
            return res.status(403).json({
              success: false,
              reason: ent.reason,
              message: "Feature not included in plan",
            });
          }
          return res.status(200).json({ success: true });
        } catch (err) {
          return res.status(500).json({
            success: false,
            message: "Internal error",
          });
        }
      }
    );

    let server = null;
    let baseUrl = null;

    try {
      server = await new Promise((resolve, reject) => {
        const instance = testApp.listen(0, "127.0.0.1", () =>
          resolve(instance)
        );
        instance.once("error", reject);
      });
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      console.log("Temporary API server started.");

      // B1: Permission ✓ + Entitlement ✓ → 200
      await test(
        "B1: permission allowed + entitlement allowed → 200",
        async () => {
          const instituteId = await makeInstitute();
          await makeActiveSubscription(instituteId, [
            { key: "STUDENT_MANAGEMENT", enabled: true },
          ]);

          const permissionId = await makePermission("STUDENT_CREATE");
          const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

          await UserPermission.collection.insertOne({
            _id: new mongoose.Types.ObjectId(),
            userId: adminId,
            instituteId,
            permissionId,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const token = makeToken(adminId);
          const res = await request(baseUrl, "/api/test/combined", {
            method: "POST",
            token,
          });

          assert(res.status === 200, `Expected 200, got ${res.status}`);
          assert(
            res.data.success === true,
            "Expected success: true"
          );
        }
      );

      // B2: Permission ✗ + Entitlement ✓ → 403 (permission denies first)
      await test(
        "B2: permission denied + entitlement allowed → 403 (no reason)",
        async () => {
          const instituteId = await makeInstitute();
          await makeActiveSubscription(instituteId, [
            { key: "STUDENT_MANAGEMENT", enabled: true },
          ]);
          await makePermission("STUDENT_CREATE");

          // Admin WITHOUT UserPermission assignment
          const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

          const token = makeToken(adminId);
          const res = await request(baseUrl, "/api/test/combined", {
            method: "POST",
            token,
          });

          assert(res.status === 403, `Expected 403, got ${res.status}`);
          assert(
            res.data.message ===
              "You do not have the required permission",
            `Wrong message: ${res.data.message}`
          );
          assert(
            res.data.reason === undefined,
            "reason field must be absent (permission denies before entitlement)"
          );
        }
      );

      // B3: Permission ✓ + Entitlement ✗ → 403 with reason
      await test(
        "B3: permission allowed + entitlement denied → 403 (has reason)",
        async () => {
          const instituteId = await makeInstitute();
          // Subscription with feature DISABLED
          await makeActiveSubscription(instituteId, [
            { key: "STUDENT_MANAGEMENT", enabled: false },
          ]);

          const permissionId = await makePermission("STUDENT_CREATE");
          const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

          await UserPermission.collection.insertOne({
            _id: new mongoose.Types.ObjectId(),
            userId: adminId,
            instituteId,
            permissionId,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const token = makeToken(adminId);
          const res = await request(baseUrl, "/api/test/combined", {
            method: "POST",
            token,
          });

          assert(res.status === 403, `Expected 403, got ${res.status}`);
          assert(
            res.data.reason === "FEATURE_NOT_INCLUDED",
            `Expected FEATURE_NOT_INCLUDED, got ${res.data.reason}`
          );
        }
      );

      // B4: Both ✗ → 403 (permission denies first)
      await test(
        "B4: permission denied + entitlement denied → 403 (permission first)",
        async () => {
          const instituteId = await makeInstitute();
          await makeActiveSubscription(instituteId, [
            { key: "STUDENT_MANAGEMENT", enabled: false },
          ]);
          await makePermission("STUDENT_CREATE");

          // Admin WITHOUT UserPermission
          const adminId = await makeUser("INSTITUTE_ADMIN", instituteId);

          const token = makeToken(adminId);
          const res = await request(baseUrl, "/api/test/combined", {
            method: "POST",
            token,
          });

          assert(res.status === 403, `Expected 403, got ${res.status}`);
          assert(
            res.data.message ===
              "You do not have the required permission",
            `Expected permission denial, got: ${res.data.message}`
          );
          assert(
            res.data.reason === undefined,
            "Entitlement reason should NOT appear (permission middleware ran first)"
          );
        }
      );
    } finally {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    }

    
    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdPermissionIds.length) {
      await Permission.collection.deleteMany({
        _id: { $in: createdPermissionIds },
      });
    }
    if (createdSubscriptionIds.length) {
      await Subscription.collection.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
      });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});