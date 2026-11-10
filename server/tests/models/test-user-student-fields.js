require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const connectTestDB = require("../helpers/connectTestDB");

const createdUserIds = [];

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

const run = async () => {
  await connectTestDB();

  try {
    const instituteId = new mongoose.Types.ObjectId();

    const makeUser = async (overrides = {}) => {
      const user = await User.create({
        instituteId,
        name: `Test User ${randomUUID().slice(0, 8)}`,
        email: `user-${randomUUID()}@example.com`,
        password: "HashedPassword123",
        role: "STUDENT",
        isActive: true,
        accountStatus: "ACTIVE",
        ...overrides,
      });
      createdUserIds.push(user._id);
      return user;
    };

    await test("batchId defaults to null", async () => {
      const user = await makeUser();
      assert(user.batchId === null, `expected null, got ${user.batchId}`);
    });

    await test("mustChangePassword defaults to false", async () => {
      const user = await makeUser();
      assert(
        user.mustChangePassword === false,
        `expected false, got ${user.mustChangePassword}`
      );
    });

    await test("batchId can be set to ObjectId", async () => {
      const batchId = new mongoose.Types.ObjectId();
      const user = await makeUser({ batchId });
      assert(
        String(user.batchId) === String(batchId),
        "batchId mismatch"
      );
    });

    await test("batchId can be set back to null", async () => {
      const batchId = new mongoose.Types.ObjectId();
      const user = await makeUser({ batchId });

      user.batchId = null;
      await user.save();

      const reloaded = await User.findById(user._id);
      assert(reloaded.batchId === null, "batchId should be null");
    });

    await test("mustChangePassword can be set to true", async () => {
      const user = await makeUser({ mustChangePassword: true });
      assert(user.mustChangePassword === true, "flag");
    });

    await test("Non-student roles can still have batchId null", async () => {
      const teacher = await makeUser({ role: "TEACHER" });
      const admin = await makeUser({ role: "INSTITUTE_ADMIN" });
      assert(teacher.batchId === null, "teacher null");
      assert(admin.batchId === null, "admin null");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
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