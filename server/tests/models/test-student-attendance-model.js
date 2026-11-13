require("dotenv").config();

const mongoose = require("mongoose");

const StudentAttendance = require("../../models/StudentAttendance");
const connectTestDB = require("../helpers/connectTestDB");

const createdIds = [];

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

const buildValid = (overrides = {}) => {
  return {
    studentId: new mongoose.Types.ObjectId(),
    instituteId: new mongoose.Types.ObjectId(),
    batchId: new mongoose.Types.ObjectId(),
    attendanceDate: "2026-11-12",
    date: new Date("2026-11-12T00:00:00.000Z"),
    status: "PRESENT",
    markedBy: new mongoose.Types.ObjectId(),
    ...overrides,
  };
};

const run = async () => {
  await connectTestDB();
  await StudentAttendance.init(); // build unique + listing indexes

  try {
    // ---------------------------------------------------
    // Basic creation + defaults
    // ---------------------------------------------------

    await test("Create valid student attendance (defaults verified)", async () => {
      const data = buildValid();
      const a = await StudentAttendance.create(data);
      createdIds.push(a._id);

      assert(a._id, "should have _id");
      assert(a.status === "PRESENT", "status stored");
      assert(a.markedVia === "MANUAL", "markedVia default");
      assert(a.isDeleted === false, "isDeleted default");
      assert(a.remarks === null, "remarks default null");
      assert(a.attendanceDate === "2026-11-12", "attendanceDate stored");
    });

    // ---------------------------------------------------
    // Required field validation
    // ---------------------------------------------------

    await test("Reject missing studentId", async () => {
      const data = buildValid({ studentId: undefined });
      await expectReject(() => StudentAttendance.create(data), "studentId");
    });

    await test("Reject missing instituteId", async () => {
      const data = buildValid({ instituteId: undefined });
      await expectReject(() => StudentAttendance.create(data), "instituteId");
    });

    await test("Reject missing batchId", async () => {
      const data = buildValid({ batchId: undefined });
      await expectReject(() => StudentAttendance.create(data), "batchId");
    });

    await test("Reject invalid attendanceDate format", async () => {
      const data = buildValid({ attendanceDate: "12-11-2026" });
      await expectReject(
        () => StudentAttendance.create(data),
        "attendanceDate"
      );
    });

    await test("Reject invalid status (enum)", async () => {
      const data = buildValid({ status: "UNKNOWN" });
      await expectReject(() => StudentAttendance.create(data), "status");
    });

    await test("Reject missing markedBy", async () => {
      const data = buildValid({ markedBy: undefined });
      await expectReject(() => StudentAttendance.create(data), "markedBy");
    });

    // ---------------------------------------------------
    // Unique index (partial, isDeleted: false)
    // ---------------------------------------------------

    await test("Reject duplicate (institute, student, attendanceDate)", async () => {
      const base = buildValid();
      const first = await StudentAttendance.create(base);
      createdIds.push(first._id);

      await expectReject(
        () =>
          StudentAttendance.create({
            ...buildValid(),
            studentId: base.studentId,
            instituteId: base.instituteId,
            attendanceDate: base.attendanceDate,
            batchId: base.batchId,
            markedBy: base.markedBy,
          }),
        "E11000"
      );
    });

    await test("Allow same student on different dates", async () => {
      const studentId = new mongoose.Types.ObjectId();
      const instituteId = new mongoose.Types.ObjectId();
      const batchId = new mongoose.Types.ObjectId();
      const markedBy = new mongoose.Types.ObjectId();

      const day1 = await StudentAttendance.create(
        buildValid({
          studentId,
          instituteId,
          batchId,
          markedBy,
          attendanceDate: "2026-11-10",
          date: new Date("2026-11-10T00:00:00.000Z"),
        })
      );
      createdIds.push(day1._id);

      const day2 = await StudentAttendance.create(
        buildValid({
          studentId,
          instituteId,
          batchId,
          markedBy,
          attendanceDate: "2026-11-11",
          date: new Date("2026-11-11T00:00:00.000Z"),
        })
      );
      createdIds.push(day2._id);

      assert(day1._id.equals(day2._id) === false, "different records");
    });

    // ---------------------------------------------------
    // Partial unique index: soft-deleted row allows re-mark
    // ---------------------------------------------------

    await test("Soft-deleted row allows new record for same key", async () => {
      const base = buildValid();
      const first = await StudentAttendance.create(base);
      createdIds.push(first._id);

      // Soft-delete the first record
      first.isDeleted = true;
      first.deletedBy = base.markedBy;
      first.deletedAt = new Date();
      first.deleteReason = "test cleanup";
      await first.save();

      // New record with same (institute, student, attendanceDate) must succeed
      const second = await StudentAttendance.create({
        ...buildValid(),
        studentId: base.studentId,
        instituteId: base.instituteId,
        attendanceDate: base.attendanceDate,
        batchId: base.batchId,
        markedBy: base.markedBy,
      });
      createdIds.push(second._id);

      assert(second._id, "second record created");
      assert(second.isDeleted === false, "second is active");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdIds.length) {
      // Hard cleanup via collection (bypasses any document hooks)
      await StudentAttendance.collection.deleteMany({
        _id: { $in: createdIds },
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