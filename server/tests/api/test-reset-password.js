require("dotenv").config();

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");

const connectTestDB = require("../helpers/connectTestDB");
const app = require("../../app");
const { hashPassword } = require("../../services/authService");

const createdInstituteIds = [];
const createdUserIds = [];

let passed = 0;
let failed = 0;
let server = null;
let baseUrl = null;

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

const makeToken = (userId) =>
  jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

const request = async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Cookie: `accessToken=${options.token}` } : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
};

const loginRaw = async (email, password) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.status;
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `RP_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Reset Password Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(id);
  return id;
};

const makeUser = async (role, instituteId, extras = {}) => {
  const id = new mongoose.Types.ObjectId();
  const email = `rp-${role.toLowerCase()}-${randomUUID()}@example.com`;
  const hashed = await hashPassword("TempPass1234");
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: `RP ${role}`,
    email,
    password: hashed,
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    ...extras,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return { id, email };
};

const setupOwner = async () => {
  const instituteId = await makeInstitute();
  const owner = await makeUser("INSTITUTE_OWNER", instituteId);
  await Institute.collection.updateOne(
    { _id: instituteId },
    { $set: { ownerId: owner.id } }
  );
  return {
    instituteId,
    ownerId: owner.id,
    ownerToken: makeToken(owner.id),
  };
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
      instance.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    console.log("Temporary API server started.\n");

    // R1: Owner resets admin password → 200; new password works for login
    await test(
      "R1: Owner resets admin password → 200 + new password works",
      async () => {
        const ctx = await setupOwner();
        // Two admins so last-admin guard does not trip
        const admin1 = await makeUser("INSTITUTE_ADMIN", ctx.instituteId);
        await makeUser("INSTITUTE_ADMIN", ctx.instituteId);

        const newPass = "NewAdminPass9876";
        const res = await request(
          `/api/owner/admins/${admin1.id}/reset-password`,
          {
            method: "PATCH",
            token: ctx.ownerToken,
            body: { newPassword: newPass },
          }
        );
        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);

        // Old password no longer works
        const oldStatus = await loginRaw(admin1.email, "TempPass1234");
        assert(oldStatus === 401, `old password should fail, got ${oldStatus}`);

        // New password works
        const newStatus = await loginRaw(admin1.email, newPass);
        assert(newStatus === 200, `new password should work, got ${newStatus}`);
      }
    );

    // R2: Owner reset on inactive admin → 403
    await test(
      "R2: Reset password for inactive admin → 403",
      async () => {
        const ctx = await setupOwner();
        const admin = await makeUser("INSTITUTE_ADMIN", ctx.instituteId, {
          isActive: false,
          accountStatus: "SUSPENDED",
        });

        const res = await request(
          `/api/owner/admins/${admin.id}/reset-password`,
          {
            method: "PATCH",
            token: ctx.ownerToken,
            body: { newPassword: "NewPassword1234" },
          }
        );
        assert(res.status === 403, `expected 403, got ${res.status}`);
      }
    );

    // R3: Owner resets student password → 200 + mustChangePassword=true
    await test(
      "R3: Owner resets student password → 200 + mustChangePassword=true",
      async () => {
        const ctx = await setupOwner();
        const student = await makeUser("STUDENT", ctx.instituteId);

        const newPass = "StuPass9876Xy";
        const res = await request(
          `/api/owner/students/${student.id}/reset-password`,
          {
            method: "PATCH",
            token: ctx.ownerToken,
            body: { newPassword: newPass },
          }
        );
        assert(res.status === 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);

        // Login with new password + mustChangePassword=true in response
        const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: student.email,
            password: newPass,
          }),
        });
        const loginBody = await loginRes.json();
        assert(loginRes.status === 200, `login status ${loginRes.status}`);
        assert(
          loginBody.data?.mustChangePassword === true,
          "mustChangePassword flag set"
        );
      }
    );

    // R4: Invalid password (< 8 chars) → 400
    await test(
      "R4: Invalid new password (< 8 chars) → 400",
      async () => {
        const ctx = await setupOwner();
        const student = await makeUser("STUDENT", ctx.instituteId);

        const res = await request(
          `/api/owner/students/${student.id}/reset-password`,
          {
            method: "PATCH",
            token: ctx.ownerToken,
            body: { newPassword: "short" },
          }
        );
        assert(res.status === 400, `expected 400, got ${res.status}`);
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (server) await new Promise((r) => server.close(r));

    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
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
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  process.exitCode = 1;
});