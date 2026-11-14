require("dotenv").config();

const mongoose = require("mongoose");

const Fee = require("../../models/Fee");
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

const buildValid = (overrides = {}) => ({
  instituteId: new mongoose.Types.ObjectId(),
  studentId: new mongoose.Types.ObjectId(),
  batchId: new mongoose.Types.ObjectId(),
  classId: new mongoose.Types.ObjectId(),
  cycle: "OCT-2026",
  description: "Monthly tuition fee",
  amount: 5000,
  dueDate: new Date("2026-10-31"),
  createdBy: new mongoose.Types.ObjectId(),
  ...overrides,
});

const run = async () => {
  await connectTestDB();
  await Fee.init();

  try {
    // ---------------------------------------------------
    // Basic creation + defaults
    // ---------------------------------------------------

    await test("Create valid fee (defaults verified)", async () => {
      const f = await Fee.create(buildValid());
      createdIds.push(f._id);

      assert(f._id, "has _id");
      assert(f.amount === 5000, "amount");
      assert(f.paidAmount === 0, "paidAmount default 0");
      assert(f.status === "PENDING", "status default");
      assert(f.currency === "INR", "currency default");
      assert(f.isDeleted === false, "isDeleted default");
    });

    // ---------------------------------------------------
    // Required field validation
    // ---------------------------------------------------

    await test("Reject missing studentId", async () => {
      await expectReject(
        () => Fee.create(buildValid({ studentId: undefined })),
        "studentId"
      );
    });

    await test("Reject missing batchId", async () => {
      await expectReject(
        () => Fee.create(buildValid({ batchId: undefined })),
        "batchId"
      );
    });

    await test("Reject missing classId", async () => {
      await expectReject(
        () => Fee.create(buildValid({ classId: undefined })),
        "classId"
      );
    });

    await test("Reject negative amount", async () => {
      await expectReject(
        () => Fee.create(buildValid({ amount: -1 })),
        "cannot be negative"
      );
    });

    // ---------------------------------------------------
    // paidAmount <= amount guard
    // ---------------------------------------------------

    await test("Reject paidAmount > amount", async () => {
      await expectReject(
        () =>
          Fee.create(
            buildValid({ amount: 5000, paidAmount: 6000 })
          ),
        "cannot exceed"
      );
    });

    // ---------------------------------------------------
    // Cancel guard
    // ---------------------------------------------------

    await test("Reject CANCELLED when paidAmount > 0", async () => {
      await expectReject(
        () =>
          Fee.create(
            buildValid({
              amount: 5000,
              paidAmount: 2000,
              status: "CANCELLED",
            })
          ),
        "Cannot cancel"
      );
    });

    // ---------------------------------------------------
    // Immutability on update
    // ---------------------------------------------------

    await test("Reject amount change on existing fee", async () => {
      const f = await Fee.create(buildValid());
      createdIds.push(f._id);

      await expectReject(async () => {
        f.amount = 6000;
        await f.save();
      }, "Immutable");
    });

    // ---------------------------------------------------
    // Duplicate prevention
    // ---------------------------------------------------

    await test("Reject duplicate (student+cycle+description)", async () => {
      const base = buildValid();
      const first = await Fee.create(base);
      createdIds.push(first._id);

      await expectReject(
        () =>
          Fee.create(
            buildValid({
              instituteId: base.instituteId,
              studentId: base.studentId,
              cycle: base.cycle,
              description: base.description,
            })
          ),
        "E11000"
      );
    });

    await test("Allow soft-deleted duplicate (re-invoice after delete)", async () => {
      const base = buildValid();
      const first = await Fee.create(base);
      createdIds.push(first._id);

      first.isDeleted = true;
      first.deletedBy = base.createdBy;
      first.deletedAt = new Date();
      first.deleteReason = "test";
      await first.save();

      const second = await Fee.create(
        buildValid({
          instituteId: base.instituteId,
          studentId: base.studentId,
          cycle: base.cycle,
          description: base.description,
        })
      );
      createdIds.push(second._id);

      assert(second._id, "second created");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdIds.length) {
      await Fee.collection.deleteMany({
        _id: { $in: createdIds },
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