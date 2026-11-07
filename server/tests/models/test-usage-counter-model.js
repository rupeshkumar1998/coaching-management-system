require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const UsageCounter = require("../../models/UsageCounter");
const Institute = require("../../models/Institute");
const connectTestDB = require("../helpers/connectTestDB");

const createdInstituteIds = [];
const createdCounterIds = [];

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const expectReject = async (fn, expectedSubstring) => {
  let rejected = false;
  let received = "";

  try {
    await fn();
  } catch (error) {
    rejected = true;
    received = error.message || "";
  }

  assert(rejected, "Expected operation to reject, but it succeeded");

  if (expectedSubstring && !received.includes(expectedSubstring)) {
    throw new Error(
      `Expected error containing "${expectedSubstring}", received "${received}"`
    );
  }
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

async function createInstitute() {
  const instituteId = new mongoose.Types.ObjectId();

  await Institute.collection.insertOne({
    _id: instituteId,
    code: `UC_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Usage Counter Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  createdInstituteIds.push(instituteId);
  return instituteId;
}

const run = async () => {
  await connectTestDB();

  try {
    // =====================================================
    // Section A — Creation & validation (7 tests)
    // =====================================================

    await test("Create a valid counter", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });

      createdCounterIds.push(counter._id);

      assert(counter._id, "Counter must have an _id");
      assert(
        counter.limitKey === "MAX_STUDENTS",
        "limitKey mismatch"
      );
      assert(counter.used === 0, "used should default to 0");
      assert(counter.version === 0, "version should default to 0");
      assert(
        counter.lastReconciledAt === null,
        "lastReconciledAt should be null"
      );
    });

    await test("limitKey is uppercased and trimmed", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "  max_sms_per_month  ",
        period: "2026-11",
        used: 100,
      });

      createdCounterIds.push(counter._id);

      assert(
        counter.limitKey === "MAX_SMS_PER_MONTH",
        `limitKey was not normalized: ${counter.limitKey}`
      );
    });

    await test("Reject missing instituteId", async () => {
      await expectReject(
        () =>
          UsageCounter.create({
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
            used: 0,
          }),
        "instituteId"
      );
    });

    await test("Reject invalid limitKey format", async () => {
      const instituteId = await createInstitute();

      await expectReject(
        () =>
          UsageCounter.create({
            instituteId,
            limitKey: "123_invalid",
            period: "lifetime",
            used: 0,
          }),
        "Invalid limit key format"
      );
    });

    await test("Reject invalid period format", async () => {
      const instituteId = await createInstitute();

      await expectReject(
        () =>
          UsageCounter.create({
            instituteId,
            limitKey: "MAX_STUDENTS",
            period: "2026-13",
            used: 0,
          }),
        'period must be "lifetime" or "YYYY-MM"'
      );
    });

    await test("Reject negative used", async () => {
      const instituteId = await createInstitute();

      await expectReject(
        () =>
          UsageCounter.create({
            instituteId,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
            used: -1,
          }),
        "non-negative safe integer"
      );
    });

    await test("Reject non-integer used", async () => {
      const instituteId = await createInstitute();

      await expectReject(
        () =>
          UsageCounter.create({
            instituteId,
            limitKey: "MAX_STUDENTS",
            period: "lifetime",
            used: 1.5,
          }),
        "non-negative safe integer"
      );
    });

    // =====================================================
    // Section B — Unique scope (3 tests)
    // =====================================================

    await test("Duplicate scope is rejected", async () => {
      const instituteId = await createInstitute();

      const first = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_TEACHERS",
        period: "lifetime",
        used: 5,
      });
      createdCounterIds.push(first._id);

      await expectReject(
        () =>
          UsageCounter.create({
            instituteId,
            limitKey: "MAX_TEACHERS",
            period: "lifetime",
            used: 10,
          }),
        "E11000"
      );
    });

    await test("Different limitKey in same period is allowed", async () => {
      const instituteId = await createInstitute();

      const a = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      const b = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_TEACHERS",
        period: "lifetime",
        used: 0,
      });

      createdCounterIds.push(a._id, b._id);

      assert(a._id.toString() !== b._id.toString(), "Must be different docs");
    });

    await test("Same limitKey different period is allowed", async () => {
      const instituteId = await createInstitute();

      const a = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_SMS_PER_MONTH",
        period: "2026-10",
        used: 100,
      });
      const b = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_SMS_PER_MONTH",
        period: "2026-11",
        used: 50,
      });

      createdCounterIds.push(a._id, b._id);

      assert(a._id.toString() !== b._id.toString(), "Must be different docs");
    });

    // =====================================================
    // Section C — $inc on `used` works (3 tests)
    // =====================================================

    await test("$inc on used increments the value", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      const updated = await UsageCounter.findOneAndUpdate(
        { _id: counter._id },
        { $inc: { used: 25 } },
        { new: true }
      );

      assert(updated.used === 125, `Expected 125, got ${updated.used}`);
    });

    await test("$inc on used decrements the value", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      const updated = await UsageCounter.findOneAndUpdate(
        { _id: counter._id },
        { $inc: { used: -40 } },
        { new: true }
      );

      assert(updated.used === 60, `Expected 60, got ${updated.used}`);
    });

    await test("$inc used with $set metadata is allowed", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      const now = new Date();
      const updated = await UsageCounter.findOneAndUpdate(
        { _id: counter._id },
        {
          $inc: { used: 5 },
          $set: { lastReconciledAt: now, actualUsageAtLastReconcile: 105 },
        },
        { new: true }
      );

      assert(updated.used === 105, "used should be 105");
      assert(updated.lastReconciledAt, "lastReconciledAt should be set");
      assert(
        updated.actualUsageAtLastReconcile === 105,
        "actualUsageAtLastReconcile should be 105"
      );
    });

    // =====================================================
    // Section D — Query guards (6 tests)
    // =====================================================

    await test("$set on used is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $set: { used: 999 } }
          ),
        'must be modified via $inc'
      );
    });

    await test("$unset on used is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $unset: { used: "" } }
          ),
        'must be modified via $inc'
      );
    });

    await test("$set on instituteId is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $set: { instituteId: new mongoose.Types.ObjectId() } }
          ),
        "immutable after creation"
      );
    });

    await test("$set on limitKey is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $set: { limitKey: "MAX_TEACHERS" } }
          ),
        "immutable after creation"
      );
    });

    await test("$set on period is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_SMS_PER_MONTH",
        period: "2026-11",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $set: { period: "2026-12" } }
          ),
        "immutable after creation"
      );
    });

    await test("$rename to used is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.updateOne(
            { _id: counter._id },
            { $rename: { version: "used" } }
          ),
        "must be modified via $inc"
      );
    });

    // =====================================================
    // Section E — Document save guards (2 tests)
    // =====================================================

    await test("save() with modified used is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      const reloaded = await UsageCounter.findById(counter._id);
      reloaded.used = 999;

      await expectReject(
        () => reloaded.save(),
        'only be modified via $inc'
      );
    });

    await test("save() with modified limitKey is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 100,
      });
      createdCounterIds.push(counter._id);

      const reloaded = await UsageCounter.findById(counter._id);
      reloaded.limitKey = "MAX_TEACHERS";

      await expectReject(
        () => reloaded.save(),
        "immutable"
      );
    });

    // =====================================================
    // Section F — Delete protection (4 tests)
    // =====================================================

    await test("deleteOne (query) is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () => UsageCounter.deleteOne({ _id: counter._id }),
        "cannot be deleted"
      );
    });

    await test("deleteMany is rejected", async () => {
      await expectReject(
        () => UsageCounter.deleteMany({}),
        "cannot be deleted"
      );
    });

    await test("findOneAndDelete is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.findOneAndDelete({ _id: counter._id }),
        "cannot be deleted"
      );
    });

    await test("document.deleteOne is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      createdCounterIds.push(counter._id);

      const reloaded = await UsageCounter.findById(counter._id);

      await expectReject(
        () => reloaded.deleteOne(),
        "cannot be deleted"
      );
    });

    // =====================================================
    // Section G — Replacement + bulk guards (4 tests)
    // =====================================================

    await test("replaceOne is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.replaceOne(
            { _id: counter._id },
            {
              instituteId,
              limitKey: "MAX_TEACHERS",
              period: "lifetime",
              used: 0,
            }
          ),
        "replacement is not allowed"
      );
    });

    await test("findOneAndReplace is rejected", async () => {
      const instituteId = await createInstitute();

      const counter = await UsageCounter.create({
        instituteId,
        limitKey: "MAX_STUDENTS",
        period: "lifetime",
        used: 0,
      });
      createdCounterIds.push(counter._id);

      await expectReject(
        () =>
          UsageCounter.findOneAndReplace(
            { _id: counter._id },
            {
              instituteId,
              limitKey: "MAX_TEACHERS",
              period: "lifetime",
              used: 0,
            }
          ),
        "replacement is not allowed"
      );
    });

    await test("bulkWrite is rejected", async () => {
      await expectReject(
        () =>
          UsageCounter.bulkWrite([
            {
              insertOne: {
                document: {
                  instituteId: new mongoose.Types.ObjectId(),
                  limitKey: "MAX_STUDENTS",
                  period: "lifetime",
                  used: 0,
                },
              },
            },
          ]),
        "bulkWrite is disabled"
      );
    });

    await test("insertMany is rejected", async () => {
      const instituteId = await createInstitute();

      await expectReject(
        () =>
          UsageCounter.insertMany([
            {
              instituteId,
              limitKey: "MAX_STUDENTS",
              period: "lifetime",
              used: 0,
            },
          ]),
        "insertMany is disabled"
      );
    });

    console.log("\nAll UsageCounter model tests executed.");
  } finally {
    console.log("\nCleaning up...");

    if (createdCounterIds.length > 0) {
      await UsageCounter.collection.deleteMany({
        _id: { $in: createdCounterIds },
      });
    }

    if (createdInstituteIds.length > 0) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }

    await mongoose.disconnect();
  }

  console.log("\n------------------------------");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log("------------------------------");

  if (failed > 0) process.exitCode = 1;
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  process.exitCode = 1;
});