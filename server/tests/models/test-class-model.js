require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Class = require("../../models/Class");
const connectTestDB = require("../helpers/connectTestDB");

const createdClassIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectReject = async (fn, expectedSubstring) => {
  let threw = false;
  let received = "";
  try {
    await fn();
  } catch (e) {
    threw = true;
    received = e.message || "";
  }
  assert(threw, "expected rejection, but succeeded");
  if (expectedSubstring) {
    assert(
      received.toLowerCase().includes(expectedSubstring.toLowerCase()),
      `expected "${expectedSubstring}", got: ${received}`
    );
  }
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

  // Wait for indexes to be built before testing unique
  // constraints. MongoDB builds indexes asynchronously;
  // without this, early duplicate tests can slip through.
  await Class.init();

  try {
    const instituteId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();

    // =====================================================
    // Creation & validation
    // =====================================================

    await test("Create a valid class", async () => {
      const cls = await Class.create({
        instituteId,
        name: "Class 10",
        description: "Class 10 students",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      assert(cls._id, "should have _id");
      assert(cls.name === "Class 10", "name");
      assert(cls.isActive === true, "isActive default");
      assert(cls.isDeleted === false, "isDeleted default");
      assert(cls.sortOrder === 0, "sortOrder default");
      assert(cls.capacity === null, "capacity default");
    });

    await test("Reject missing name", async () => {
      await expectReject(
        () =>
          Class.create({
            instituteId,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "name"
      );
    });

    await test("Reject short name", async () => {
      await expectReject(
        () =>
          Class.create({
            instituteId,
            name: "A",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "at least 2 characters"
      );
    });

    await test("Reject long name (>100)", async () => {
      await expectReject(
        () =>
          Class.create({
            instituteId,
            name: "A".repeat(101),
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "cannot exceed 100"
      );
    });

    await test("Reject missing instituteId", async () => {
      await expectReject(
        () =>
          Class.create({
            name: "Class X",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "instituteId"
      );
    });

    // =====================================================
    // Unique name per institute
    // =====================================================

    await test("Reject duplicate name in same institute", async () => {
      const cls = await Class.create({
        instituteId,
        name: "Class 11",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      await expectReject(
        () =>
          Class.create({
            instituteId,
            name: "Class 11",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "E11000"
      );
    });

    await test("Allow same name in different institute", async () => {
      const instituteB = new mongoose.Types.ObjectId();
      const cls = await Class.create({
        instituteId: instituteB,
        name: "Class 10", // same as first test
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);
      assert(cls._id, "should be created");
    });

    await test("Allow reuse of name after soft delete", async () => {
      const instituteC = new mongoose.Types.ObjectId();
      const cls = await Class.create({
        instituteId: instituteC,
        name: "Class 12",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      // Soft delete
      cls.isDeleted = true;
      await cls.save();

      // Now create again with same name
      const cls2 = await Class.create({
        instituteId: instituteC,
        name: "Class 12",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls2._id);
      assert(cls2._id, "should be created after soft delete");
    });

    // =====================================================
    // Delete protection
    // =====================================================

    await test("deleteOne (query) is rejected", async () => {
      const cls = await Class.create({
        instituteId,
        name: "Delete Test Class",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      await expectReject(
        () => Class.deleteOne({ _id: cls._id }),
        "cannot be deleted"
      );
    });

    await test("deleteMany is rejected", async () => {
      await expectReject(
        () => Class.deleteMany({}),
        "cannot be deleted"
      );
    });

    await test("findOneAndDelete is rejected", async () => {
      const cls = await Class.create({
        instituteId,
        name: "Delete Test 2",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      await expectReject(
        () => Class.findOneAndDelete({ _id: cls._id }),
        "cannot be deleted"
      );
    });

    // =====================================================
    // Additional field tests
    // =====================================================

    await test("Accept capacity + sortOrder + classTeacherId", async () => {
      const teacherId = new mongoose.Types.ObjectId();
      const cls = await Class.create({
        instituteId,
        name: "Class 9",
        capacity: 50,
        sortOrder: 9,
        classTeacherId: teacherId,
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdClassIds.push(cls._id);

      assert(cls.capacity === 50, "capacity");
      assert(cls.sortOrder === 9, "sortOrder");
      assert(
        String(cls.classTeacherId) === String(teacherId),
        "classTeacherId"
      );
    });

    await test("Reject non-integer capacity", async () => {
      await expectReject(
        () =>
          Class.create({
            instituteId,
            name: "Bad Capacity Class",
            capacity: 1.5,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "Capacity"
      );
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdClassIds.length) {
      await Class.collection.deleteMany({
        _id: { $in: createdClassIds },
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