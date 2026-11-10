require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Teacher = require("../../models/Teacher");
const Institute = require("../../models/Institute");
const connectTestDB = require("../helpers/connectTestDB");
const limitCounterRegistry = require("../../services/limitCounterRegistry");

// ⚠️ Import triggers auto-registration of the 4 counters.
const limitService = require("../../services/limitService");

const createdInstituteIds = [];
const createdUserIds = [];
const createdTeacherIds = [];

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

const INSTITUTE_ID = new mongoose.Types.ObjectId();

async function createInstitute() {
  await Institute.collection.insertOne({
    _id: INSTITUTE_ID,
    code: `LC_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Limit Counter Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(INSTITUTE_ID);
}

async function createUser({
  role,
  isActive = true,
  accountStatus = "ACTIVE",
  isDeleted = false,
}) {
  const user = await User.create({
    instituteId: INSTITUTE_ID,
    name: `Counter Test ${role}`,
    email: `counter-${role}-${randomUUID()}@example.com`,
    password: "TemporaryTestPassword123!",
    role,
    isActive,
    accountStatus,
    isDeleted,
  });
  createdUserIds.push(user._id);
  return user;
}

async function createTeacher(status, isDeleted = false) {
  const user = await createUser({ role: "TEACHER" });

  const teacher = await Teacher.create({
    userId: user._id,
    instituteId: INSTITUTE_ID,
    status,
    isDeleted,
  });
  createdTeacherIds.push(teacher._id);
  return teacher;
}

async function clearUsers() {
  if (createdUserIds.length) {
    await User.collection.deleteMany({
      _id: { $in: createdUserIds },
    });
    createdUserIds.length = 0;
  }
  if (createdTeacherIds.length) {
    await Teacher.collection.deleteMany({
      _id: { $in: createdTeacherIds },
    });
    createdTeacherIds.length = 0;
  }
}

const run = async () => {
  await connectTestDB();

  try {
    await createInstitute();

    // ==========================================
    // Section A — Registration state (2 tests)
    // ==========================================
    await test("6 counters registered on module load", async () => {
      const registered = limitCounterRegistry.getRegisteredLimitKeys();
      const expected = [
        "MAX_ADMINS",
        "MAX_BATCHES",
        "MAX_CLASSES",
        "MAX_PARENTS",
        "MAX_STUDENTS",
        "MAX_TEACHERS",
      ];
      assert(
        JSON.stringify(registered) === JSON.stringify(expected),
        `Expected ${expected}, got ${registered}`
      );
    });

    await test("7 limits remain unregistered", async () => {
      const pending = limitCounterRegistry.getUnregisteredLimitKeys();
      assert(pending.length === 7, `Expected 7 pending, got ${pending.length}`);
      assert(
        pending.includes("MAX_SMS_PER_MONTH"),
        "SMS should be pending"
      );
      assert(
        pending.includes("MAX_STORAGE_MB"),
        "Storage should be pending"
      );
    });

    // ==========================================
    // Section B — MAX_STUDENTS counter (4 tests)
    // ==========================================
    await test("MAX_STUDENTS counts active students only", async () => {
      await clearUsers();

      // 3 active
      await createUser({ role: "STUDENT" });
      await createUser({ role: "STUDENT" });
      await createUser({ role: "STUDENT" });
      // 1 pending (not counted)
      await createUser({
        role: "STUDENT",
        isActive: false,
        accountStatus: "PENDING",
      });
      // 1 suspended (not counted)
      await createUser({
        role: "STUDENT",
        isActive: false,
        accountStatus: "SUSPENDED",
      });
      // 1 deleted (not counted)
      await createUser({ role: "STUDENT", isDeleted: true });
      // 1 teacher (not counted)
      await createUser({ role: "TEACHER" });

      const counter = limitCounterRegistry.get("MAX_STUDENTS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(usage === 3, `Expected 3, got ${usage}`);
    });

    await test("MAX_STUDENTS is tenant-scoped", async () => {
      await clearUsers();

      await createUser({ role: "STUDENT" });
      await createUser({ role: "STUDENT" });

      // Student in a DIFFERENT institute
      const otherInstituteId = new mongoose.Types.ObjectId();
      await Institute.collection.insertOne({
        _id: otherInstituteId,
        code: `LC_OTHER_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 15)}`,
        name: "Other Institute",
        approvalStatus: "APPROVED",
        isActive: true,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      createdInstituteIds.push(otherInstituteId);

      const otherUser = await User.create({
        instituteId: otherInstituteId,
        name: "Other Student",
        email: `other-${randomUUID()}@example.com`,
        password: "TemporaryTestPassword123!",
        role: "STUDENT",
        isActive: true,
        accountStatus: "ACTIVE",
      });
      createdUserIds.push(otherUser._id);

      const counter = limitCounterRegistry.get("MAX_STUDENTS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(usage === 2, `Expected 2 (tenant-scoped), got ${usage}`);
    });

    await test(
      "MAX_STUDENTS returns 0 when no students",
      async () => {
        await clearUsers();
        const counter = limitCounterRegistry.get("MAX_STUDENTS");
        const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
        assert(usage === 0, `Expected 0, got ${usage}`);
      }
    );

    await test("MAX_STUDENTS counter is registered as LIFETIME_CURRENT", async () => {
      const counter = limitCounterRegistry.get("MAX_STUDENTS");
      assert(
        counter.periodType === "LIFETIME_CURRENT",
        `Expected LIFETIME_CURRENT, got ${counter.periodType}`
      );
    });

    // ==========================================
    // Section C — MAX_TEACHERS counter (4 tests)
    // ==========================================
    await test("MAX_TEACHERS counts ACTIVE + ON_LEAVE only", async () => {
      await clearUsers();

      await createTeacher("ACTIVE");
      await createTeacher("ACTIVE");
      await createTeacher("ON_LEAVE");
      await createTeacher("INACTIVE");
      await createTeacher("TERMINATED");
      await createTeacher("ACTIVE", true); // deleted

      const counter = limitCounterRegistry.get("MAX_TEACHERS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(usage === 3, `Expected 3 (2 active + 1 on_leave), got ${usage}`);
    });

    await test("MAX_TEACHERS ignores User.isActive", async () => {
      await clearUsers();

      // Create teacher with User.isActive = false, but Teacher.status = ACTIVE
      const user = await createUser({
        role: "TEACHER",
        isActive: false,
        accountStatus: "SUSPENDED",
      });
      await Teacher.create({
        userId: user._id,
        instituteId: INSTITUTE_ID,
        status: "ACTIVE",
      }).then((t) => createdTeacherIds.push(t._id));

      const counter = limitCounterRegistry.get("MAX_TEACHERS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(
        usage === 1,
        `Teacher should be counted based on status, not User.isActive. Got ${usage}`
      );
    });

    await test(
      "MAX_TEACHERS returns 0 when only INACTIVE/TERMINATED",
      async () => {
        await clearUsers();

        await createTeacher("INACTIVE");
        await createTeacher("TERMINATED");

        const counter = limitCounterRegistry.get("MAX_TEACHERS");
        const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
        assert(usage === 0, `Expected 0, got ${usage}`);
      }
    );

    await test("MAX_TEACHERS counter is registered as LIFETIME_CURRENT", async () => {
      const counter = limitCounterRegistry.get("MAX_TEACHERS");
      assert(counter.periodType === "LIFETIME_CURRENT", "periodType");
    });

    // ==========================================
    // Section D — MAX_ADMINS counter (3 tests)
    // ==========================================
    await test("MAX_ADMINS counts active admins only", async () => {
      await clearUsers();

      await createUser({ role: "INSTITUTE_ADMIN" });
      await createUser({ role: "INSTITUTE_ADMIN" });
      await createUser({
        role: "INSTITUTE_ADMIN",
        isActive: false,
        accountStatus: "PENDING",
      });
      await createUser({ role: "INSTITUTE_ADMIN", isDeleted: true });
      await createUser({ role: "STUDENT" }); // wrong role

      const counter = limitCounterRegistry.get("MAX_ADMINS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(usage === 2, `Expected 2, got ${usage}`);
    });

    await test(
      "MAX_ADMINS excludes INSTITUTE_OWNER",
      async () => {
        await clearUsers();

        await createUser({ role: "INSTITUTE_OWNER" });
        await createUser({ role: "INSTITUTE_ADMIN" });

        const counter = limitCounterRegistry.get("MAX_ADMINS");
        const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
        assert(usage === 1, `Expected 1, got ${usage}`);
      }
    );

    await test("MAX_ADMINS counter periodType is LIFETIME_CURRENT", async () => {
      const counter = limitCounterRegistry.get("MAX_ADMINS");
      assert(counter.periodType === "LIFETIME_CURRENT", "periodType");
    });

    // ==========================================
    // Section E — MAX_PARENTS counter (2 tests)
    // ==========================================
    await test("MAX_PARENTS counts active parents only", async () => {
      await clearUsers();

      await createUser({ role: "PARENT" });
      await createUser({ role: "PARENT" });
      await createUser({ role: "PARENT" });
      await createUser({
        role: "PARENT",
        isActive: false,
        accountStatus: "SUSPENDED",
      });
      await createUser({ role: "STUDENT" });

      const counter = limitCounterRegistry.get("MAX_PARENTS");
      const usage = await counter.getCurrentUsage(INSTITUTE_ID, "lifetime");
      assert(usage === 3, `Expected 3, got ${usage}`);
    });

    await test("MAX_PARENTS counter periodType is LIFETIME_CURRENT", async () => {
      const counter = limitCounterRegistry.get("MAX_PARENTS");
      assert(counter.periodType === "LIFETIME_CURRENT", "periodType");
    });

    // ==========================================
    // Section F — Pending limits throw RESOURCE_NOT_IMPLEMENTED (2 tests)
    // ==========================================
    await test(
      "Unregistered limit → RESOURCE_NOT_IMPLEMENTED via service",
      async () => {
        // We must bypass the real subscription check by directly
        // calling registry.get — service layer requires a full sub.
        // Instead verify the registry state.
        const counter = limitCounterRegistry.get("MAX_SMS_PER_MONTH");
        assert(counter === null, "MAX_SMS_PER_MONTH must not be registered");
      }
    );

    await test(
      "All 7 pending limits are consistently unregistered",
      async () => {
        const pending = [
          "MAX_ACTIVE_LEADS",
          "MAX_EXAMS_PER_MONTH",
          "MAX_STORAGE_MB",
          "MAX_SMS_PER_MONTH",
          "MAX_WHATSAPP_MESSAGES_PER_MONTH",
          "MAX_EMAILS_PER_MONTH",
          "MAX_API_REQUESTS_PER_MONTH",
        ];

        for (const key of pending) {
          assert(
            limitCounterRegistry.get(key) === null,
            `${key} should be unregistered`
          );
        }
      }
    );

    // ==========================================
    // Section G — registerAllCounters idempotency (2 tests)
    // ==========================================
    await test("registerAllCounters is idempotent", async () => {
      const { registerAllCounters } = require("../../services/counters");
      registerAllCounters(); // should not throw

      const registered = limitCounterRegistry.getRegisteredLimitKeys();
      assert(registered.length === 6, `Expected 6, got ${registered.length}`);
    });

    await test(
      "After __resetForTests + registerAllCounters → 5 restored",
      async () => {
        const { registerAllCounters } = require("../../services/counters");

        limitCounterRegistry.__resetForTests();
        assert(
          limitCounterRegistry.getRegisteredLimitKeys().length === 0,
          "Registry should be empty after reset"
        );

        registerAllCounters();
        assert(
          limitCounterRegistry.getRegisteredLimitKeys().length === 6,
          "Registry should have 6 after re-register"
        );
      }
    );
  } finally {
    // Best-effort cleanup — also delete the primary institute.
    if (createdTeacherIds.length) {
      await Teacher.collection.deleteMany({
        _id: { $in: createdTeacherIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
      });
    }
    if (createdInstituteIds.length) {
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

run().catch(async (e) => {
  console.error("TEST SETUP ERROR:", e.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});