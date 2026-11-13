require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Batch = require("../../models/Batch");
const Class = require("../../models/Class");
const Institute = require("../../models/Institute");
const StudentAttendance = require("../../models/StudentAttendance");

const connectTestDB = require("../helpers/connectTestDB");

const {
  markStudentAttendance,
  bulkMarkStudentAttendance,
  listStudentAttendance,
  getStudentAttendance,
  updateStudentAttendance,
  deleteStudentAttendance,
  getStudentAttendanceSummary,
  getBatchAttendanceSummary,
} = require("../../services/studentAttendanceService");

const createdUserIds = [];
const createdBatchIds = [];
const createdClassIds = [];
const createdInstituteIds = [];
const createdAttendanceIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectReject = async (fn, expectedCode) => {
  let threw = false;
  let code = null;
  try {
    await fn();
  } catch (e) {
    threw = true;
    code = e.code;
  }
  assert(threw, `expected rejection "${expectedCode}", succeeded`);
  if (expectedCode) {
    assert(code === expectedCode, `expected "${expectedCode}", got "${code}"`);
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

const getTodayInIndia = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const shiftDate = (base, days) => {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeInstitute = async () => {
  const id = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: id,
    code: `SA_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
    name: "Student Attendance Test Institute",
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
  await User.collection.insertOne({
    _id: id,
    instituteId,
    name: `SA ${role}`,
    email: `sa-${role.toLowerCase()}-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role,
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    ...extras,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(id);
  return id;
};

const makeClass = async (instituteId, actorId, name = "Class 10") => {
  const id = new mongoose.Types.ObjectId();
  await Class.collection.insertOne({
    _id: id,
    instituteId,
    name,
    description: "",
    isActive: true,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClassIds.push(id);
  return id;
};

const makeBatch = async (
  instituteId,
  classId,
  actorId,
  name = "Batch A",
  status = "ACTIVE"
) => {
  const id = new mongoose.Types.ObjectId();
  await Batch.collection.insertOne({
    _id: id,
    instituteId,
    classId,
    name,
    teachers: [],
    schedule: null,
    status,
    isDeleted: false,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdBatchIds.push(id);
  return id;
};

const setupContext = async () => {
  const instituteId = await makeInstitute();
  const actorId = await makeUser("INSTITUTE_OWNER", instituteId);
  const classId = await makeClass(instituteId, actorId);
  const batchId = await makeBatch(instituteId, classId, actorId);
  return { instituteId, actorId, classId, batchId };
};

const makeStudent = async (instituteId, batchId, extras = {}) => {
  return makeUser("STUDENT", instituteId, { batchId, ...extras });
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();
  await StudentAttendance.init();

  try {
    const today = getTodayInIndia();
    const yesterday = shiftDate(today, -1);
    const dayBefore = shiftDate(today, -2);

    // =====================================================
    // A ΓÇö Mark single (4)
    // =====================================================

    await test("A1: Mark single attendance success", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      assert(rec._id, "has _id");
      assert(rec.status === "PRESENT", "status stored");
      assert(
        String(rec.batchId) === String(ctx.batchId),
        "batchId snapshot"
      );
      assert(rec.markedVia === "MANUAL", "markedVia default");
      assert(
        rec.attendanceDate === today,
        `attendanceDate: ${rec.attendanceDate}`
      );
    });

    await test("A2: Duplicate attendance ΓåÆ 409", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      await expectReject(
        () =>
          markStudentAttendance({
            instituteId: ctx.instituteId,
            studentId,
            status: "ABSENT",
            attendanceDate: today,
            markedBy: ctx.actorId,
          }),
        "DUPLICATE_ATTENDANCE"
      );
    });

    await test("A3: STUDENT_NOT_FOUND", async () => {
      const ctx = await setupContext();
      await expectReject(
        () =>
          markStudentAttendance({
            instituteId: ctx.instituteId,
            studentId: new mongoose.Types.ObjectId(),
            status: "PRESENT",
            attendanceDate: today,
            markedBy: ctx.actorId,
          }),
        "STUDENT_NOT_FOUND"
      );
    });

    await test("A4: FUTURE_ATTENDANCE_DATE rejected", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);
      const future = shiftDate(today, 5);

      await expectReject(
        () =>
          markStudentAttendance({
            instituteId: ctx.instituteId,
            studentId,
            status: "PRESENT",
            attendanceDate: future,
            markedBy: ctx.actorId,
          }),
        "FUTURE_ATTENDANCE_DATE"
      );
    });

    // =====================================================
    // B ΓÇö Bulk mark (4)
    // =====================================================

    await test("B1: Bulk mark success (3 students)", async () => {
      const ctx = await setupContext();
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s2 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s3 = await makeStudent(ctx.instituteId, ctx.batchId);

      const records = await bulkMarkStudentAttendance({
        instituteId: ctx.instituteId,
        batchId: ctx.batchId,
        attendanceDate: today,
        entries: [
          { studentId: s1, status: "PRESENT" },
          { studentId: s2, status: "ABSENT" },
          { studentId: s3, status: "LATE", remarks: "10 min late" },
        ],
        markedBy: ctx.actorId,
      });

      records.forEach((r) => createdAttendanceIds.push(r._id));
      assert(records.length === 3, `got ${records.length}`);
      assert(records[2].remarks === "10 min late", "remarks stored");
    });

    await test("B2: Bulk duplicate in DB ΓåÆ 409 (all-or-nothing)", async () => {
      const ctx = await setupContext();
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s2 = await makeStudent(ctx.instituteId, ctx.batchId);

      // Pre-mark s1
      const first = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId: s1,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(first._id);

      await expectReject(
        () =>
          bulkMarkStudentAttendance({
            instituteId: ctx.instituteId,
            batchId: ctx.batchId,
            attendanceDate: today,
            entries: [
              { studentId: s1, status: "ABSENT" },
              { studentId: s2, status: "PRESENT" },
            ],
            markedBy: ctx.actorId,
          }),
        "DUPLICATE_ATTENDANCE"
      );

      // Verify s2 was NOT created (all-or-nothing)
      const s2Record = await StudentAttendance.findOne({
        studentId: s2,
        attendanceDate: today,
        isDeleted: false,
      }).lean();
      assert(s2Record === null, "s2 must not have attendance (rollback)");
    });

    await test("B3: Bulk student in wrong batch ΓåÆ 409", async () => {
      const ctx = await setupContext();
      const otherBatch = await makeBatch(
        ctx.instituteId,
        ctx.classId,
        ctx.actorId,
        "Batch Other"
      );
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s2 = await makeStudent(ctx.instituteId, otherBatch);

      await expectReject(
        () =>
          bulkMarkStudentAttendance({
            instituteId: ctx.instituteId,
            batchId: ctx.batchId,
            attendanceDate: today,
            entries: [
              { studentId: s1, status: "PRESENT" },
              { studentId: s2, status: "PRESENT" },
            ],
            markedBy: ctx.actorId,
          }),
        "BATCH_MISMATCH"
      );
    });

    await test("B4: Bulk inactive student ΓåÆ 409", async () => {
      const ctx = await setupContext();
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId, {
        isActive: false,
      });

      await expectReject(
        () =>
          bulkMarkStudentAttendance({
            instituteId: ctx.instituteId,
            batchId: ctx.batchId,
            attendanceDate: today,
            entries: [{ studentId: s1, status: "PRESENT" }],
            markedBy: ctx.actorId,
          }),
        "STUDENT_INACTIVE"
      );
    });

    // =====================================================
    // C ΓÇö List / Get (3)
    // =====================================================

    await test("C1: list by student + date range", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const r1 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: dayBefore,
        markedBy: ctx.actorId,
      });
      const r2 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "ABSENT",
        attendanceDate: yesterday,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(r1._id, r2._id);

      const result = await listStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        from: dayBefore,
        to: yesterday,
      });

      assert(result.items.length === 2, `got ${result.items.length}`);
      assert(result.total === 2, `total ${result.total}`);
    });

    await test("C2: list with status filter", async () => {
      const ctx = await setupContext();
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s2 = await makeStudent(ctx.instituteId, ctx.batchId);

      const r1 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId: s1,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      const r2 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId: s2,
        status: "ABSENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(r1._id, r2._id);

      const result = await listStudentAttendance({
        instituteId: ctx.instituteId,
        status: "ABSENT",
      });
      assert(result.items.length === 1, `got ${result.items.length}`);
      assert(result.items[0].status === "ABSENT", "status");
    });

    await test("C3: get single attendance (populated)", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      const fetched = await getStudentAttendance({
        instituteId: ctx.instituteId,
        attendanceId: rec._id,
      });

      assert(fetched._id, "id");
      assert(fetched.studentId?.name, "student populated");
      assert(fetched.markedBy?.role, "markedBy populated");
    });

    // =====================================================
    // D ΓÇö Update (3)
    // =====================================================

    await test("D1: update status", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      const updated = await updateStudentAttendance({
        instituteId: ctx.instituteId,
        attendanceId: rec._id,
        updates: { status: "LATE" },
      });
      assert(updated.status === "LATE", "status updated");
    });

    await test("D2: update remarks", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      const updated = await updateStudentAttendance({
        instituteId: ctx.instituteId,
        attendanceId: rec._id,
        updates: { remarks: "Correction applied" },
      });
      assert(updated.remarks === "Correction applied", "remarks updated");
    });

    await test("D3: immutable attendanceDate rejected", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      await expectReject(
        () =>
          updateStudentAttendance({
            instituteId: ctx.instituteId,
            attendanceId: rec._id,
            updates: { attendanceDate: yesterday },
          }),
        "IMMUTABLE_FIELD"
      );
    });

    // =====================================================
    // E ΓÇö Delete (2)
    // =====================================================

    await test("E1: soft delete sets isDeleted=true", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const rec = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(rec._id);

      const deleted = await deleteStudentAttendance({
        instituteId: ctx.instituteId,
        attendanceId: rec._id,
        reason: "Test correction",
        actorId: ctx.actorId,
      });
      assert(deleted.isDeleted === true, "isDeleted");
      assert(deleted.deleteReason === "Test correction", "reason");
      assert(deleted.deletedBy, "deletedBy");
    });

    await test("E2: soft-deleted record allows re-mark", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const first = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "ABSENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(first._id);

      await deleteStudentAttendance({
        instituteId: ctx.instituteId,
        attendanceId: first._id,
        reason: "Wrong entry",
        actorId: ctx.actorId,
      });

      const second = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(second._id);

      assert(second._id.equals(first._id) === false, "different record");
      assert(second.isDeleted === false, "second active");
    });

    // =====================================================
    // F ΓÇö Summary student (2)
    // =====================================================

    await test("F1: student summary counts by status", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const r1 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: dayBefore,
        markedBy: ctx.actorId,
      });
      const r2 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: yesterday,
        markedBy: ctx.actorId,
      });
      const r3 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "ABSENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(r1._id, r2._id, r3._id);

      const summary = await getStudentAttendanceSummary({
        instituteId: ctx.instituteId,
        studentId,
      });

      assert(summary.summary.totalAttendance === 3, "total 3");
      assert(summary.summary.present === 2, "present 2");
      assert(summary.summary.absent === 1, "absent 1");
    });

    await test("F2: student summary respects date range", async () => {
      const ctx = await setupContext();
      const studentId = await makeStudent(ctx.instituteId, ctx.batchId);

      const r1 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: dayBefore,
        markedBy: ctx.actorId,
      });
      const r2 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(r1._id, r2._id);

      const summary = await getStudentAttendanceSummary({
        instituteId: ctx.instituteId,
        studentId,
        from: today,
        to: today,
      });

      assert(summary.summary.totalAttendance === 1, "total 1");
    });

    // =====================================================
    // G ΓÇö Summary batch (2)
    // =====================================================

    await test("G1: batch summary marked/unmarked", async () => {
      const ctx = await setupContext();
      const s1 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s2 = await makeStudent(ctx.instituteId, ctx.batchId);
      const s3 = await makeStudent(ctx.instituteId, ctx.batchId);

      const r1 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId: s1,
        status: "PRESENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      const r2 = await markStudentAttendance({
        instituteId: ctx.instituteId,
        studentId: s2,
        status: "ABSENT",
        attendanceDate: today,
        markedBy: ctx.actorId,
      });
      createdAttendanceIds.push(r1._id, r2._id);

      const summary = await getBatchAttendanceSummary({
        instituteId: ctx.instituteId,
        batchId: ctx.batchId,
        attendanceDate: today,
      });

      assert(summary.totalStudents === 3, `total: ${summary.totalStudents}`);
      assert(summary.marked === 2, `marked: ${summary.marked}`);
      assert(summary.unmarked === 1, `unmarked: ${summary.unmarked}`);
      assert(summary.present === 1, "present 1");
      assert(summary.absent === 1, "absent 1");
    });

    await test("G2: batch summary all unmarked when none marked", async () => {
      const ctx = await setupContext();
      await makeStudent(ctx.instituteId, ctx.batchId);
      await makeStudent(ctx.instituteId, ctx.batchId);

      const summary = await getBatchAttendanceSummary({
        instituteId: ctx.instituteId,
        batchId: ctx.batchId,
        attendanceDate: today,
      });

      assert(summary.totalStudents === 2, "total 2");
      assert(summary.marked === 0, "marked 0");
      assert(summary.unmarked === 2, "unmarked 2");
    });

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    if (createdAttendanceIds.length) {
      await StudentAttendance.collection.deleteMany({
        _id: { $in: createdAttendanceIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({ _id: { $in: createdUserIds } });
    }
    if (createdBatchIds.length) {
      await Batch.collection.deleteMany({ _id: { $in: createdBatchIds } });
    }
    if (createdClassIds.length) {
      await Class.collection.deleteMany({ _id: { $in: createdClassIds } });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({ _id: { $in: createdInstituteIds } });
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