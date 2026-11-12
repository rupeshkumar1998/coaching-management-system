const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");
const ensurePermissionFixtures = require("../helpers/permissionFixtures");

const UserPermission = require("../../models/UserPermission");
const {
  seedPermissions,
  grantPermissionToTeacher,
  revokePermissionFromTeacher,
  getEffectivePermissions,
} = require("../../services/permissionService");

const runTest = async () => {
  let teacher;
  let adminA;
  let ownerA;
  let instituteAId;
  let passCount = 0;
  let failCount = 0;

  const assert = (condition, message) => {
    if (condition) { passCount++; console.log(`  PASS: ${message}`); }
    else { failCount++; console.log(`  FAIL: ${message}`); }
  };

  const expectThrow = async (fn, expectedSubstring, message) => {
    try {
      await fn();
      failCount++; console.log(`  FAIL: ${message} (expected throw, none thrown)`);
    } catch (err) {
      if (err.message.includes(expectedSubstring)) {
        passCount++; console.log(`  PASS: ${message}`);
      } else {
        failCount++; console.log(`  FAIL: ${message} (got: "${err.message}")`);
      }
    }
  };

  try {
    console.log("========================================");
    console.log("Permission Service — TEACHER Tests");
    console.log("========================================");

    await connectTestDB();
    await seedPermissions();
    const fixtures = await ensurePermissionFixtures();

    teacher = fixtures.teacherA;
    adminA = fixtures.adminA;
    ownerA = fixtures.ownerA;
    instituteAId = fixtures.instituteA._id;

    await UserPermission.deleteMany({ userId: teacher._id, instituteId: instituteAId });

    // TEST 1 — grant ATTENDANCE_MARK → GRANTED
    console.log("\nTEST 1: grant ATTENDANCE_MARK (owner)");
    let result = await grantPermissionToTeacher({
      userId: teacher._id, instituteId: instituteAId,
      permissionKey: "ATTENDANCE_MARK", grantedBy: ownerA._id,
    });
    assert(result.action === "GRANTED", "grant returns GRANTED");

    // TEST 2 — grant ATTENDANCE_UPDATE → GRANTED
    console.log("\nTEST 2: grant ATTENDANCE_UPDATE (owner)");
    result = await grantPermissionToTeacher({
      userId: teacher._id, instituteId: instituteAId,
      permissionKey: "ATTENDANCE_UPDATE", grantedBy: ownerA._id,
    });
    assert(result.action === "GRANTED", "second grant returns GRANTED");

    // TEST 3 — duplicate grant ATTENDANCE_MARK → throws
    console.log("\nTEST 3: duplicate grant ATTENDANCE_MARK");
    await expectThrow(
      () => grantPermissionToTeacher({
        userId: teacher._id, instituteId: instituteAId,
        permissionKey: "ATTENDANCE_MARK", grantedBy: ownerA._id,
      }),
      "already assigned",
      "duplicate grant throws"
    );

    // TEST 4 — grant STUDENT_READ → throws (ATTENDANCE-only)
    console.log("\nTEST 4: grant STUDENT_READ (non-attendance)");
    await expectThrow(
      () => grantPermissionToTeacher({
        userId: teacher._id, instituteId: instituteAId,
        permissionKey: "STUDENT_READ", grantedBy: ownerA._id,
      }),
      "attendance permissions",
      "non-attendance grant rejected"
    );

    // TEST 5 — non-owner grantor → throws
    console.log("\nTEST 5: admin grantor (not owner)");
    await expectThrow(
      () => grantPermissionToTeacher({
        userId: teacher._id, instituteId: instituteAId,
        permissionKey: "ATTENDANCE_READ", grantedBy: adminA._id,
      }),
      "Only the Institute Owner",
      "admin grantor rejected"
    );

    // TEST 6 — admin as target user → throws
    console.log("\nTEST 6: admin as target user");
    await expectThrow(
      () => grantPermissionToTeacher({
        userId: adminA._id, instituteId: instituteAId,
        permissionKey: "ATTENDANCE_READ", grantedBy: ownerA._id,
      }),
      "not a valid Teacher",
      "non-teacher target rejected"
    );

    // TEST 7 — revoke ATTENDANCE_MARK → succeeds
    console.log("\nTEST 7: revoke ATTENDANCE_MARK");
    const revoked = await revokePermissionFromTeacher({
      userId: teacher._id, instituteId: instituteAId,
      permissionKey: "ATTENDANCE_MARK", revokedBy: ownerA._id,
    });
    assert(revoked.isActive === false, "revoke sets isActive false");

    // TEST 8 — regrant ATTENDANCE_MARK → REACTIVATED
    console.log("\nTEST 8: regrant ATTENDANCE_MARK (reactivation)");
    result = await grantPermissionToTeacher({
      userId: teacher._id, instituteId: instituteAId,
      permissionKey: "ATTENDANCE_MARK", grantedBy: ownerA._id,
    });
    assert(result.action === "REACTIVATED", "regrant returns REACTIVATED");

    // TEST 9 — revoke STUDENT_READ (not assigned) → throws
    console.log("\nTEST 9: revoke STUDENT_READ (never assigned)");
    await expectThrow(
      () => revokePermissionFromTeacher({
        userId: teacher._id, instituteId: instituteAId,
        permissionKey: "STUDENT_READ", revokedBy: ownerA._id,
      }),
      "attendance permissions",
      "revoke non-attendance rejected"
    );

    // TEST 10 — getEffectivePermissions returns only ATTENDANCE
    console.log("\nTEST 10: getEffectivePermissions for teacher");
    const effective = await getEffectivePermissions({
      userId: teacher._id, instituteId: instituteAId,
    });
    const keys = effective.map((p) => p.permissionKey).sort();
    assert(
      keys.every((k) => k.startsWith("ATTENDANCE_")),
      `effective perms are ATTENDANCE-only (got: ${keys.join(",")})`
    );
    assert(keys.length === 2, `effective perms count === 2 (got: ${keys.length})`);

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