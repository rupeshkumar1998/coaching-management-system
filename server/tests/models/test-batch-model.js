require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const Batch = require("../../models/Batch");
const connectTestDB = require("../helpers/connectTestDB");

const createdBatchIds = [];

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
  await Batch.init(); // ensure unique indexes built

  try {
    const instituteId = new mongoose.Types.ObjectId();
    const actorId = new mongoose.Types.ObjectId();
    const classId = new mongoose.Types.ObjectId();

    // ---------------------------------------------------
    // Basic creation
    // ---------------------------------------------------

    await test("Create a valid batch (minimal)", async () => {
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch A",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);

      assert(b._id, "should have _id");
      assert(b.name === "Batch A", "name");
      assert(b.status === "ACTIVE", "status default");
      assert(b.isDeleted === false, "isDeleted default");
      assert(Array.isArray(b.teachers), "teachers array");
      assert(b.teachers.length === 0, "teachers empty default");
      assert(b.schedule === null, "schedule null default");
    });

    await test("Reject missing name", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "name"
      );
    });

    await test("Reject short name", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "A",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "at least 2"
      );
    });

    await test("Reject missing classId", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            name: "Batch X",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "classId"
      );
    });

    await test("Reject missing instituteId", async () => {
      await expectReject(
        () =>
          Batch.create({
            classId,
            name: "Batch Y",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "instituteId"
      );
    });

    // ---------------------------------------------------
    // Unique name per class
    // ---------------------------------------------------

    await test("Reject duplicate name in same class", async () => {
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch B",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);

      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "Batch B",
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "E11000"
      );
    });

    await test("Allow same name in different class", async () => {
      const class2 = new mongoose.Types.ObjectId();
      const b = await Batch.create({
        instituteId,
        classId: class2,
        name: "Batch A",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);
      assert(b._id, "should be created");
    });

    // ---------------------------------------------------
    // Teachers
    // ---------------------------------------------------

    await test("Accept valid teachers array", async () => {
      const t1 = new mongoose.Types.ObjectId();
      const t2 = new mongoose.Types.ObjectId();
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch With Teachers",
        teachers: [
          { teacherId: t1, subject: "Math" },
          { teacherId: t2, subject: "Physics" },
        ],
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);

      assert(b.teachers.length === 2, "2 teachers");
      assert(b.teachers[0].subject === "MATH", "subject uppercased");
    });

    await test("Allow same teacher multiple subjects", async () => {
      const t = new mongoose.Types.ObjectId();
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch Multi-Subject",
        teachers: [
          { teacherId: t, subject: "Math" },
          { teacherId: t, subject: "Physics" },
        ],
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);
      assert(b.teachers.length === 2, "2 entries");
    });

    await test("Reject duplicate (teacher, subject)", async () => {
      const t = new mongoose.Types.ObjectId();
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "Batch Duplicate",
            teachers: [
              { teacherId: t, subject: "Math" },
              { teacherId: t, subject: "Math" },
            ],
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "Duplicate teacher-subject"
      );
    });

    // ---------------------------------------------------
    // Schedule
    // ---------------------------------------------------

    await test("Accept valid schedule", async () => {
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch Scheduled",
        schedule: {
          days: ["MON", "WED", "FRI"],
          startTime: "18:00",
          endTime: "19:30",
        },
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);

      assert(b.schedule !== null, "schedule exists");
      assert(b.schedule.days.length === 3, "3 days");
      assert(b.schedule.startTime === "18:00", "start");
    });

    await test("Reject invalid day", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "Batch Bad Day",
            schedule: {
              days: ["MONDAY"],
              startTime: "18:00",
              endTime: "19:30",
            },
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "MONDAY"
      );
    });

    await test("Reject invalid time format", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "Batch Bad Time",
            schedule: {
              days: ["MON"],
              startTime: "25:00",
              endTime: "26:00",
            },
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "startTime"
      );
    });

    await test("Reject startTime >= endTime", async () => {
      await expectReject(
        () =>
          Batch.create({
            instituteId,
            classId,
            name: "Batch Bad Range",
            schedule: {
              days: ["MON"],
              startTime: "20:00",
              endTime: "18:00",
            },
            createdBy: actorId,
            updatedBy: actorId,
          }),
        "startTime must be before"
      );
    });

    // ---------------------------------------------------
    // Delete protection
    // ---------------------------------------------------

    await test("deleteOne (query) is rejected", async () => {
      const b = await Batch.create({
        instituteId,
        classId,
        name: "Batch Delete Test",
        createdBy: actorId,
        updatedBy: actorId,
      });
      createdBatchIds.push(b._id);

      await expectReject(
        () => Batch.deleteOne({ _id: b._id }),
        "cannot be deleted"
      );
    });

    await test("deleteMany is rejected", async () => {
      await expectReject(
        () => Batch.deleteMany({}),
        "cannot be deleted"
      );
    });

    await test("findOneAndDelete is rejected", async () => {
      await expectReject(
        () => Batch.findOneAndDelete({ _id: new mongoose.Types.ObjectId() }),
        "cannot be deleted"
      );
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({
        _id: { $in: createdBatchIds },
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