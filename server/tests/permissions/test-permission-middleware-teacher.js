const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");
const ensurePermissionFixtures = require("../helpers/permissionFixtures");

const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");
const requirePermission = require("../../middleware/permissionMiddleware");
const { seedPermissions } = require("../../services/permissionService");

const runMiddleware = async (req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(data) {
        this.body = data;
        resolve({ nextCalled: false, statusCode: this.statusCode, body: this.body });
      },
    };
    const next = () => resolve({ nextCalled: true, statusCode: res.statusCode, body: res.body });
    try {
      Promise.resolve(requirePermission(req.permissionKey)(req, res, next)).catch(reject);
    } catch (error) { reject(error); }
  });
};

const runTest = async () => {
  let teacher;
  let instituteAId;
  let passCount = 0;
  let failCount = 0;

  const assert = (condition, message) => {
    if (condition) { passCount++; console.log(`  PASS: ${message}`); }
    else { failCount++; console.log(`  FAIL: ${message}`); }
  };

  try {
    console.log("========================================");
    console.log("Permission Middleware — TEACHER Tests");
    console.log("========================================");

    await connectTestDB();
    await seedPermissions();
    const fixtures = await ensurePermissionFixtures();

    teacher = fixtures.teacherA;
    instituteAId = fixtures.instituteA._id;

    const attMark = await Permission.findOne({ permissionKey: "ATTENDANCE_MARK", isActive: true });
    const attUpdate = await Permission.findOne({ permissionKey: "ATTENDANCE_UPDATE", isActive: true });
    const adminRead = await Permission.findOne({ permissionKey: "ADMIN_READ", isActive: true });
    const studentRead = await Permission.findOne({ permissionKey: "STUDENT_READ", isActive: true });

    if (!attMark || !attUpdate || !adminRead || !studentRead) {
      throw new Error("Required permission fixtures missing");
    }

    // Clean teacher assignments
    await UserPermission.deleteMany({ userId: teacher._id, instituteId: instituteAId });

    const baseReq = {
      user: teacher,
      tenantId: instituteAId,
    };

    // TEST 1 — TEACHER + ATTENDANCE_MARK assigned → allow
    console.log("\nTEST 1: TEACHER + ATTENDANCE_MARK assigned");
    await UserPermission.create({
      userId: teacher._id, instituteId: instituteAId,
      permissionId: attMark._id, grantedBy: fixtures.ownerA._id, isActive: true,
    });
    let r = await runMiddleware({ ...baseReq, permissionKey: "ATTENDANCE_MARK" });
    assert(r.nextCalled === true, "TEACHER allowed with ATTENDANCE_MARK");

    // TEST 2 — TEACHER + ATTENDANCE_UPDATE assigned → allow
    console.log("\nTEST 2: TEACHER + ATTENDANCE_UPDATE assigned");
    await UserPermission.create({
      userId: teacher._id, instituteId: instituteAId,
      permissionId: attUpdate._id, grantedBy: fixtures.ownerA._id, isActive: true,
    });
    r = await runMiddleware({ ...baseReq, permissionKey: "ATTENDANCE_UPDATE" });
    assert(r.nextCalled === true, "TEACHER allowed with ATTENDANCE_UPDATE");

    // TEST 3 — TEACHER + ADMIN_READ assigned → 403 (domain guard)
    console.log("\nTEST 3: TEACHER + ADMIN_READ assigned (domain guard)");
    await UserPermission.create({
      userId: teacher._id, instituteId: instituteAId,
      permissionId: adminRead._id, grantedBy: fixtures.ownerA._id, isActive: true,
    });
    r = await runMiddleware({ ...baseReq, permissionKey: "ADMIN_READ" });
    assert(r.nextCalled === false && r.statusCode === 403, "TEACHER blocked from ADMIN_READ (domain)");

    // TEST 4 — TEACHER + STUDENT_READ assigned → 403 (domain guard)
    console.log("\nTEST 4: TEACHER + STUDENT_READ assigned (domain guard)");
    await UserPermission.create({
      userId: teacher._id, instituteId: instituteAId,
      permissionId: studentRead._id, grantedBy: fixtures.ownerA._id, isActive: true,
    });
    r = await runMiddleware({ ...baseReq, permissionKey: "STUDENT_READ" });
    assert(r.nextCalled === false && r.statusCode === 403, "TEACHER blocked from STUDENT_READ (domain)");

    // TEST 5 — TEACHER without ATTENDANCE_MARK assignment → 403 (no assignment)
    console.log("\nTEST 5: TEACHER without ATTENDANCE_MARK assignment");
    await UserPermission.deleteOne({
      userId: teacher._id, instituteId: instituteAId, permissionId: attMark._id,
    });
    r = await runMiddleware({ ...baseReq, permissionKey: "ATTENDANCE_MARK" });
    assert(r.nextCalled === false && r.statusCode === 403, "TEACHER blocked without assignment");

    // TEST 6 — TEACHER with inactive ATTENDANCE_MARK → 403 (inactive)
    console.log("\nTEST 6: TEACHER with inactive ATTENDANCE_MARK");
    await UserPermission.create({
      userId: teacher._id, instituteId: instituteAId,
      permissionId: attMark._id, grantedBy: fixtures.ownerA._id, isActive: false,
    });
    r = await runMiddleware({ ...baseReq, permissionKey: "ATTENDANCE_MARK" });
    assert(r.nextCalled === false && r.statusCode === 403, "TEACHER blocked with inactive assignment");

    console.log("\n========================================");
    console.log(`RESULT: Passed: ${passCount}  Failed: ${failCount}`);
    console.log("========================================");
    if (failCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error("TEST ERROR:", error);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState === 1 && teacher) {
      await UserPermission.deleteMany({
        userId: teacher._id,
        instituteId: teacher.instituteId,
      });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

runTest();