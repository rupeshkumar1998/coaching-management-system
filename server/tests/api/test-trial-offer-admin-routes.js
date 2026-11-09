require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const PlatformTrialOffer = require("../../models/PlatformTrialOffer");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");

// =========================================================
// 32.16.15.15 — Trial Offer Admin Routes Tests
//
// Tests the 7 HTTP endpoints for trial offer management.
// Uses the real app.js (no inline express app).
//
// Coverage:
//   Section A — Auth (2 tests):
//     A1: All endpoints → 401 without auth
//     A2: All endpoints → 403 for non-SUPER_ADMIN roles
//
//   Section B — Validation (3 tests):
//     B1: Invalid offerId format → 400
//     B2: Create missing planId → 400
//     B3: Toggle missing enabled → 400
//
//   Section C — Lifecycle (3 tests):
//     C1: Create → update → publish
//     C2: Toggle ON → GET current → toggle OFF
//     C3: Retire → GET current null → history includes
//
//   Section D — Error cases (3 tests):
//     D1: Publish non-existent → 404
//     D2: Publish retired → 409
//     D3: Create with non-existent plan → 404
// =========================================================

const createdUserIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdOfferIds = [];

let server = null;
let baseUrl = null;
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
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

// ---------------------------------------------------------
// Helpers
// ---------------------------------------------------------

const makeToken = (userId) => {
  return jwt.sign(
    { userId: userId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const request = async (requestPath, options = {}) => {
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

const makeUser = async (role) => {
  const userId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: userId,
    instituteId: null,
    name: `Trial Route Test ${role}`,
    email: `tr-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(userId);
  return { user: { _id: userId, role }, token: makeToken(userId) };
};

const makePlanAndVersion = async () => {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: `TR_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Trial Route Test Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: 1,
    status: "PUBLISHED",
    amount: 0,
    currency: "INR",
    durationDays: 14,
    paymentRequired: false,
    features: [],
    limits: [],
    publishedAt: new Date(),
    publishedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdVersionIds.push(versionId);

  return { planId, versionId };
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    // Start the actual Express app
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () =>
        resolve(instance)
      );
      instance.once("error", reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
    console.log("Temporary API server started.\n");

    // -------- Fixtures --------
    const superAdmin = await makeUser("SUPER_ADMIN");
    const owner = await makeUser("INSTITUTE_OWNER");
    const admin = await makeUser("INSTITUTE_ADMIN");
    const teacher = await makeUser("TEACHER");
    const student = await makeUser("STUDENT");
    const parent = await makeUser("PARENT");

    const nonAdmins = [
      { name: "INSTITUTE_OWNER", token: owner.token },
      { name: "INSTITUTE_ADMIN", token: admin.token },
      { name: "TEACHER", token: teacher.token },
      { name: "STUDENT", token: student.token },
      { name: "PARENT", token: parent.token },
    ];

    const { planId, versionId } = await makePlanAndVersion();

    // All 7 endpoints (using a dummy MongoId for path params)
    const dummyId = new mongoose.Types.ObjectId();
    const allEndpoints = [
      { method: "GET", path: "/api/admin/trial-offer" },
      { method: "GET", path: "/api/admin/trial-offer/history" },
      { method: "POST", path: "/api/admin/trial-offer", body: {} },
      {
        method: "PATCH",
        path: `/api/admin/trial-offer/${dummyId}`,
        body: {},
      },
      {
        method: "POST",
        path: `/api/admin/trial-offer/${dummyId}/publish`,
        body: {},
      },
      {
        method: "PATCH",
        path: `/api/admin/trial-offer/${dummyId}/toggle`,
        body: {},
      },
      {
        method: "POST",
        path: `/api/admin/trial-offer/${dummyId}/retire`,
        body: {},
      },
    ];

    // =====================================================
    // Section A — Authentication
    // =====================================================

    await test(
      "A1: all endpoints → 401 without auth",
      async () => {
        for (const endpoint of allEndpoints) {
          const res = await request(endpoint.path, {
            method: endpoint.method,
            body: endpoint.body,
          });
          assert(
            res.status === 401,
            `${endpoint.method} ${endpoint.path} expected 401, got ${res.status}`
          );
        }
      }
    );

    await test(
      "A2: all endpoints → 403 for non-SUPER_ADMIN roles",
      async () => {
        for (const role of nonAdmins) {
          for (const endpoint of allEndpoints) {
            const res = await request(endpoint.path, {
              method: endpoint.method,
              token: role.token,
              body: endpoint.body,
            });
            assert(
              res.status === 403,
              `${role.name} on ${endpoint.method} ${endpoint.path} expected 403, got ${res.status}`
            );
          }
        }
      }
    );

    // =====================================================
    // Section B — Validation
    // =====================================================

    await test("B1: invalid offerId → 400", async () => {
      const res = await request(
        "/api/admin/trial-offer/not-an-id/toggle",
        {
          method: "PATCH",
          token: superAdmin.token,
          body: { enabled: true },
        }
      );
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test("B2: create missing planId → 400", async () => {
      const res = await request("/api/admin/trial-offer", {
        method: "POST",
        token: superAdmin.token,
        body: { durationDays: 14 },
      });
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    await test("B3: toggle missing enabled → 400", async () => {
      const res = await request(
        `/api/admin/trial-offer/${new mongoose.Types.ObjectId()}/toggle`,
        {
          method: "PATCH",
          token: superAdmin.token,
          body: {},
        }
      );
      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // =====================================================
    // Section C — Lifecycle
    // =====================================================

    let createdOfferId = null;

    await test("C1: create → update → publish", async () => {
      // Create
      const createRes = await request("/api/admin/trial-offer", {
        method: "POST",
        token: superAdmin.token,
        body: {
          planId,
          planVersionId: versionId,
          durationDays: 14,
        },
      });
      assert(
        createRes.status === 201,
        `Create: expected 201, got ${createRes.status}: ${JSON.stringify(createRes.data)}`
      );
      assert(
        createRes.data.data.offer.status === "DRAFT",
        "should be DRAFT"
      );
      assert(
        createRes.data.data.offer.enabled === false,
        "should be disabled"
      );
      createdOfferId = createRes.data.data.offer.id;
      createdOfferIds.push(
        new mongoose.Types.ObjectId(createdOfferId)
      );

      // Update
      const updateRes = await request(
        `/api/admin/trial-offer/${createdOfferId}`,
        {
          method: "PATCH",
          token: superAdmin.token,
          body: { durationDays: 30 },
        }
      );
      assert(
        updateRes.status === 200,
        `Update: expected 200, got ${updateRes.status}`
      );
      assert(
        updateRes.data.data.offer.durationDays === 30,
        "durationDays should be 30"
      );

      // Publish
      const publishRes = await request(
        `/api/admin/trial-offer/${createdOfferId}/publish`,
        {
          method: "POST",
          token: superAdmin.token,
          body: {},
        }
      );
      assert(
        publishRes.status === 200,
        `Publish: expected 200, got ${publishRes.status}: ${JSON.stringify(publishRes.data)}`
      );
      assert(
        publishRes.data.data.offer.status === "PUBLISHED",
        "should be PUBLISHED"
      );
      assert(
        publishRes.data.data.offer.enabled === false,
        "should still be disabled after publish"
      );
    });

    await test(
      "C2: toggle ON → GET current → toggle OFF",
      async () => {
        assert(createdOfferId, "C1 must run first");

        // Toggle ON
        const onRes = await request(
          `/api/admin/trial-offer/${createdOfferId}/toggle`,
          {
            method: "PATCH",
            token: superAdmin.token,
            body: { enabled: true },
          }
        );
        assert(
          onRes.status === 200,
          `Toggle ON: expected 200, got ${onRes.status}`
        );
        assert(
          onRes.data.data.offer.enabled === true,
          "should be enabled"
        );

        // GET current
        const currentRes = await request("/api/admin/trial-offer", {
          token: superAdmin.token,
        });
        assert(
          currentRes.status === 200,
          `GET current: expected 200, got ${currentRes.status}`
        );
        assert(
          currentRes.data.data.offer !== null,
          "should return offer"
        );
        assert(
          currentRes.data.data.offer.id === createdOfferId,
          "should match"
        );

        // Toggle OFF
        const offRes = await request(
          `/api/admin/trial-offer/${createdOfferId}/toggle`,
          {
            method: "PATCH",
            token: superAdmin.token,
            body: { enabled: false },
          }
        );
        assert(
          offRes.status === 200,
          `Toggle OFF: expected 200, got ${offRes.status}`
        );
        assert(
          offRes.data.data.offer.enabled === false,
          "should be disabled"
        );
      }
    );

    await test(
      "C3: retire → GET current null → history includes",
      async () => {
        assert(createdOfferId, "C1 must run first");

        // Retire
        const retireRes = await request(
          `/api/admin/trial-offer/${createdOfferId}/retire`,
          {
            method: "POST",
            token: superAdmin.token,
            body: {},
          }
        );
        assert(
          retireRes.status === 200,
          `Retire: expected 200, got ${retireRes.status}`
        );
        assert(
          retireRes.data.data.offer.status === "RETIRED",
          "should be RETIRED"
        );

        // GET current → null
        const currentRes = await request(
          "/api/admin/trial-offer",
          {
            token: superAdmin.token,
          }
        );
        assert(
          currentRes.status === 200,
          `GET current: expected 200, got ${currentRes.status}`
        );
        assert(
          currentRes.data.data.offer === null,
          "should be null (no published offer)"
        );

        // GET history → includes
        const historyRes = await request(
          "/api/admin/trial-offer/history",
          {
            token: superAdmin.token,
          }
        );
        assert(
          historyRes.status === 200,
          `GET history: expected 200, got ${historyRes.status}`
        );
        assert(
          Array.isArray(historyRes.data.data.offers),
          "should be array"
        );
        assert(
          historyRes.data.data.offers.some(
            (o) => o.id === createdOfferId
          ),
          "should include our retired offer"
        );
      }
    );

    // =====================================================
    // Section D — Error cases
    // =====================================================

    await test(
      "D1: publish non-existent offer → 404",
      async () => {
        const fakeId = new mongoose.Types.ObjectId();
        const res = await request(
          `/api/admin/trial-offer/${fakeId}/publish`,
          {
            method: "POST",
            token: superAdmin.token,
            body: {},
          }
        );
        assert(res.status === 404, `Expected 404, got ${res.status}`);
      }
    );

    await test(
      "D2: publish already-retired offer → 409",
      async () => {
        assert(createdOfferId, "C1 must run first");
        const res = await request(
          `/api/admin/trial-offer/${createdOfferId}/publish`,
          {
            method: "POST",
            token: superAdmin.token,
            body: {},
          }
        );
        assert(res.status === 409, `Expected 409, got ${res.status}`);
      }
    );

    await test(
      "D3: create with non-existent plan → 404",
      async () => {
        const fakePlanId = new mongoose.Types.ObjectId();
        const fakeVersionId = new mongoose.Types.ObjectId();
        const res = await request("/api/admin/trial-offer", {
          method: "POST",
          token: superAdmin.token,
          body: {
            planId: fakePlanId,
            planVersionId: fakeVersionId,
            durationDays: 14,
          },
        });
        assert(res.status === 404, `Expected 404, got ${res.status}`);
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (createdOfferIds.length) {
      await PlatformTrialOffer.collection.deleteMany({
        _id: { $in: createdOfferIds },
      });
    }
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }
    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
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