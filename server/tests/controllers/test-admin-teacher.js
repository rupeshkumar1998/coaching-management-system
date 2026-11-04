
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Teacher = require("../../models/Teacher");

const {
    createTeacher,
    getTeachers,
    getTeacherById,
    updateTeacher,
    toggleTeacherStatus,
    deleteTeacher,
    resetTeacherPassword,
} = require("../../controllers/adminTeacherController");

const {
    comparePassword,
    hashPassword,
} = require("../../services/authService");

// Unique marker: this test only cleans up its own records.
const marker = `teacher-test-${Date.now()}`;
const testEmail = (label) => `${marker}-${label}@example.test`;

const createdInstituteIds = [];

let passed = 0;
let failed = 0;

const runTest = async (name, testFunction) => {
    try {
        await testFunction();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (error) {
        failed++;
        console.error(`FAIL: ${name}`);
        console.error(error.message);
    }
};

const createResponse = () => {
    const res = {
        statusCode: 200,
        body: null,

        status(code) {
            this.statusCode = code;
            return this;
        },

        json(data) {
            this.body = data;
            return this;
        },
    };

    return res;
};

const callController = async (
    handler,
    {
        tenantId,
        body = {},
        params = {},
    } = {}
) => {
    const req = {
        tenantId,
        body,
        params,
    };

    const res = createResponse();

    await handler(req, res);

    return res;
};

const createInstitute = async (label) => {
    const institute = await Institute.create({
        name: `Teacher Test Institute ${label}`,
        code: `${marker}-${label}`.toUpperCase().slice(0, 30),
        approvalStatus: "APPROVED",
        isActive: true,
        subscriptionStatus: "ACTIVE",
    });

    createdInstituteIds.push(institute._id);

    return institute;
};

const createTeacherFixture = async (
    instituteId,
    label,
    employeeId = null,
    isActive = true
) => {
    const user = await User.create({
        instituteId,
        name: `Test Teacher ${label}`,
        email: testEmail(label),
        password: await hashPassword("OriginalPass123"),
        role: "TEACHER",
        accountStatus: isActive ? "ACTIVE" : "SUSPENDED",
        isActive,
    });

    const teacher = await Teacher.create({
        userId: user._id,
        instituteId,
        employeeId,
        status: isActive ? "ACTIVE" : "INACTIVE",
    });

    return { user, teacher };
};

const testCreateTeacher = async (institute) => {
    const res = await callController(createTeacher, {
        tenantId: institute._id,
        body: {
            name: "New Test Teacher",
            email: testEmail("created"),
            password: "TeacherPass123",
            employeeId: "emp100",
            qualification: "MCA",
            experienceYears: 3,
            subjects: ["Java", "SQL"],
        },
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.role, "TEACHER");
    assert.equal(res.body.data.teacher.employeeId, "EMP100");

    const savedUser = await User.findById(
        res.body.data.user.id
    ).select("+password");

    assert.ok(savedUser);
    assert.notEqual(savedUser.password, "TeacherPass123");

    assert.equal(
        await comparePassword("TeacherPass123", savedUser.password),
        true
    );

    const savedTeacher = await Teacher.findById(
        res.body.data.teacher.id
    );

    assert.ok(savedTeacher);
    assert.equal(
        savedTeacher.instituteId.toString(),
        institute._id.toString()
    );
};

const testInvalidEmployeeId = async (institute) => {
    const res = await callController(createTeacher, {
        tenantId: institute._id,
        body: {
            name: "Invalid Employee ID",
            email: testEmail("invalid-employee"),
            password: "TeacherPass123",
            employeeId: 12345,
        },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(
        res.body.message,
        "Employee ID must be a string"
    );

    assert.equal(
        await User.findOne({ email: testEmail("invalid-employee") }),
        null
    );
};


const testWhitespaceEmployeeId = async (institute) => {
    const res = await callController(createTeacher, {
        tenantId: institute._id,
        body: {
            name: "Whitespace Employee Teacher",
            email: testEmail("whitespace-employee"),
            password: "TeacherPass123",
            employeeId: "   ",
        },
    });

    assert.equal(res.statusCode, 201);

    const savedTeacher = await Teacher.findById(
        res.body.data.teacher.id
    );

    assert.equal(savedTeacher.employeeId, null);
};


const testMissingTenant = async () => {
    const res = await callController(createTeacher, {
        body: {
            name: "Missing Tenant Teacher",
            email: testEmail("missing-tenant"),
            password: "TeacherPass123",
        },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(
        res.body.message,
        "Institute association is missing"
    );
};

const testDuplicateEmail = async (institute) => {
    await User.create({
        instituteId: institute._id,
        name: "Existing Teacher",
        email: testEmail("duplicate-email"),
        password: await hashPassword("OriginalPass123"),
        role: "TEACHER",
        accountStatus: "ACTIVE",
        isActive: true,
    });

    const res = await callController(createTeacher, {
        tenantId: institute._id,
        body: {
            name: "Duplicate Email Teacher",
            email: testEmail("duplicate-email"),
            password: "TeacherPass123",
        },
    });

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.message, "Email already exists");
};

const testDuplicateEmployeeId = async (institute) => {
    await createTeacherFixture(
        institute._id,
        "duplicate-employee-existing",
        "EMP200"
    );

    const res = await callController(createTeacher, {
        tenantId: institute._id,
        body: {
            name: "Duplicate Employee Teacher",
            email: testEmail("duplicate-employee-new"),
            password: "TeacherPass123",
            employeeId: "emp200",
        },
    });

    assert.equal(res.statusCode, 409);
    assert.equal(
        res.body.message,
        "Employee ID already exists in this institute"
    );
};

const testGetTeachersTenantIsolation = async (
    institute,
    otherInstitute
) => {
    await createTeacherFixture(
        institute._id,
        "list-current-institute"
    );

    await createTeacherFixture(
        otherInstitute._id,
        "list-other-institute"
    );

    const res = await callController(getTeachers, {
        tenantId: institute._id,
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    for (const teacher of res.body.data) {
        assert.equal(
            teacher.instituteId.toString(),
            institute._id.toString()
        );
    }
};

const testGetTeacherByIdTenantIsolation = async (
    institute,
    otherInstitute
) => {
    const { teacher } = await createTeacherFixture(
        otherInstitute._id,
        "cross-institute-lookup"
    );

    const res = await callController(getTeacherById, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
    });

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.message, "Teacher not found");
};

const testUpdateEmployeeId = async (institute) => {
    const { teacher } = await createTeacherFixture(
        institute._id,
        "update-employee",
        "EMP300"
    );

    const res = await callController(updateTeacher, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
        body: {
            employeeId: " emp301 ",
            qualification: "MCA",
        },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.teacher.employeeId, "EMP301");

    const savedTeacher = await Teacher.findById(teacher._id);
    assert.equal(savedTeacher.employeeId, "EMP301");
};

const testInvalidEmployeeIdUpdate = async (institute) => {
    const { teacher } = await createTeacherFixture(
        institute._id,
        "invalid-employee-update",
        "EMP400"
    );

    const res = await callController(updateTeacher, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
        body: {
            employeeId: 12345,
        },
    });

    assert.equal(res.statusCode, 400);

    const savedTeacher = await Teacher.findById(teacher._id);
    assert.equal(savedTeacher.employeeId, "EMP400");
};

const testToggleTeacherStatus = async (institute) => {
    const { user, teacher } = await createTeacherFixture(
        institute._id,
        "toggle-status"
    );

    const res = await callController(toggleTeacherStatus, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.isActive, false);
    assert.equal(res.body.data.accountStatus, "SUSPENDED");
    assert.equal(res.body.data.status, "INACTIVE");

    const savedUser = await User.findById(user._id);
    const savedTeacher = await Teacher.findById(teacher._id);

    assert.equal(savedUser.isActive, false);
    assert.equal(savedUser.accountStatus, "SUSPENDED");
    assert.equal(savedTeacher.status, "INACTIVE");
};

const testSoftDeleteTeacher = async (institute) => {
    const { user, teacher } = await createTeacherFixture(
        institute._id,
        "soft-delete"
    );

    const res = await callController(deleteTeacher, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.isDeleted, true);

    const savedUser = await User.findById(user._id);
    const savedTeacher = await Teacher.findById(teacher._id);

    assert.equal(savedUser.isDeleted, true);
    assert.equal(savedUser.isActive, false);
    assert.equal(savedTeacher.isDeleted, true);
    assert.equal(savedTeacher.status, "TERMINATED");
};

const testResetTeacherPassword = async (institute) => {
    const { user, teacher } = await createTeacherFixture(
        institute._id,
        "reset-password"
    );

    const res = await callController(resetTeacherPassword, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
        body: {
            newPassword: "NewTeacherPass123",
        },
    });

    assert.equal(res.statusCode, 200);

    const savedUser = await User.findById(user._id).select("+password");

    assert.notEqual(savedUser.password, "NewTeacherPass123");

    assert.equal(
        await comparePassword(
            "NewTeacherPass123",
            savedUser.password
        ),
        true
    );

    assert.equal(
        await comparePassword(
            "OriginalPass123",
            savedUser.password
        ),
        false
    );
};

const testInactiveTeacherPasswordReset = async (institute) => {
    const { teacher } = await createTeacherFixture(
        institute._id,
        "inactive-reset",
        null,
        false
    );

    const res = await callController(resetTeacherPassword, {
        tenantId: institute._id,
        params: {
            teacherId: teacher._id.toString(),
        },
        body: {
            newPassword: "NewTeacherPass123",
        },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(
        res.body.message,
        "Cannot reset password for an inactive teacher"
    );
};

const run = async () => {
    try {
        await connectTestDB();

        // Initialize indexes only on the isolated test database.
        await Promise.all([
            User.init(),
            Institute.init(),
            Teacher.init(),
        ]);

        const institute = await createInstitute("MAIN");
        const otherInstitute = await createInstitute("OTHER");

        await runTest(
            "Create teacher and hash password",
            () => testCreateTeacher(institute)
        );

        await runTest(
            "Reject non-string employee ID",
            () => testInvalidEmployeeId(institute)
        );

        await runTest(
            "Normalize whitespace employee ID to null",
            () => testWhitespaceEmployeeId(institute)
        );

        await runTest(
            "Reject missing tenant",
            testMissingTenant
        );

        await runTest(
            "Reject duplicate email",
            () => testDuplicateEmail(institute)
        );

        await runTest(
            "Reject duplicate employee ID within institute",
            () => testDuplicateEmployeeId(institute)
        );

        await runTest(
            "Get teachers with tenant isolation",
            () => testGetTeachersTenantIsolation(
                institute,
                otherInstitute
            )
        );

        await runTest(
            "Prevent cross-institute teacher lookup",
            () => testGetTeacherByIdTenantIsolation(
                institute,
                otherInstitute
            )
        );

        await runTest(
            "Update and normalize employee ID",
            () => testUpdateEmployeeId(institute)
        );

        await runTest(
            "Reject invalid employee ID during update",
            () => testInvalidEmployeeIdUpdate(institute)
        );

        await runTest(
            "Toggle teacher status and synchronize User",
            () => testToggleTeacherStatus(institute)
        );

        await runTest(
            "Soft delete teacher and linked User",
            () => testSoftDeleteTeacher(institute)
        );

        await runTest(
            "Reset teacher password securely",
            () => testResetTeacherPassword(institute)
        );

        await runTest(
            "Reject password reset for inactive teacher",
            () => testInactiveTeacherPasswordReset(institute)
        );

        await runTest(
            "Reject invalid teacher ID during fetch",
            () => testInvalidTeacherIdGet(institute)
        );

        await runTest(
            "Reject invalid teacher ID during update",
            () => testInvalidTeacherIdUpdate(institute)
        );

        await runTest(
            "Reject invalid teacher ID during status change",
            () => testInvalidTeacherIdToggle(institute)
        );

        await runTest(
            "Reject invalid teacher ID during deletion",
            () => testInvalidTeacherIdDelete(institute)
        );

        await runTest(
            "Reject invalid teacher ID during password reset",
            () => testInvalidTeacherIdPasswordReset(institute)
        );

    } catch (error) {
        failed++;
        console.error("TEST SETUP ERROR:", error);
    } finally {
        try {
            // Cleanup only records created by this test run.
            if (mongoose.connection.readyState === 1) {
                if (createdInstituteIds.length > 0) {
                    await Teacher.deleteMany({
                        instituteId: { $in: createdInstituteIds },
                    });

                    await User.deleteMany({
                        email: {
                            $regex: `^${marker}-`,
                        },
                    });

                    await Institute.deleteMany({
                        _id: { $in: createdInstituteIds },
                    });
                }

                await mongoose.disconnect();
            }
        } catch (cleanupError) {
            failed++;
            console.error(
                "TEST CLEANUP ERROR:",
                cleanupError.message
            );
        }

        console.log("\n================================");
        console.log(`Teacher Controller Tests: ${passed} passed, ${failed} failed`);
        console.log("================================");

        if (failed > 0) {
            process.exitCode = 1;
        }
    }
};


const testInvalidTeacherIdGet = async (institute) => {
    const res = await callController(getTeacherById, {
        tenantId: institute._id,
        params: { teacherId: "invalid-id" },
    });

    assert.equal(res.statusCode, 400);
};

const testInvalidTeacherIdUpdate = async (institute) => {
    const res = await callController(updateTeacher, {
        tenantId: institute._id,
        params: { teacherId: "invalid-id" },
        body: {},
    });

    assert.equal(res.statusCode, 400);
};

const testInvalidTeacherIdToggle = async (institute) => {
    const res = await callController(toggleTeacherStatus, {
        tenantId: institute._id,
        params: { teacherId: "invalid-id" },
    });

    assert.equal(res.statusCode, 400);
};

const testInvalidTeacherIdDelete = async (institute) => {
    const res = await callController(deleteTeacher, {
        tenantId: institute._id,
        params: { teacherId: "invalid-id" },
    });

    assert.equal(res.statusCode, 400);
};

const testInvalidTeacherIdPasswordReset = async (institute) => {
    const res = await callController(resetTeacherPassword, {
        tenantId: institute._id,
        params: { teacherId: "invalid-id" },
        body: { newPassword: "NewTeacherPass123" },
    });

    assert.equal(res.statusCode, 400);
};

run();
