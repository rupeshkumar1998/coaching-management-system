const connectTestDB = require("./connectTestDB");
const ensurePermissionFixtures = require("./permissionFixtures");

const runTest = async () => {
  try {
    await connectTestDB();

    const fixtures = await ensurePermissionFixtures();

    console.log("\nPermission fixtures created/reused successfully:");
    console.log("Institute A:", fixtures.instituteA._id.toString());
    console.log("Institute B:", fixtures.instituteB._id.toString());
    console.log("Owner A:", fixtures.ownerA.email);
    console.log("Admin A:", fixtures.adminA.email);
    console.log("Admin B:", fixtures.adminB.email);
    console.log("Teacher A:", fixtures.teacherA.email);
    console.log("Super Admin:", fixtures.superAdmin.email);

    if (!fixtures.instituteA.ownerId.equals(fixtures.ownerA._id)) {
      throw new Error("Institute A owner mapping is incorrect.");
    }

    if (
      fixtures.ownerA.role !== "INSTITUTE_OWNER" ||
      fixtures.adminA.role !== "INSTITUTE_ADMIN" ||
      fixtures.adminB.role !== "INSTITUTE_ADMIN" ||
      fixtures.teacherA.role !== "TEACHER" ||
      fixtures.superAdmin.role !== "SUPER_ADMIN"
    ) {
      throw new Error("One or more fixture roles are incorrect.");
    }

    console.log("\nPermission fixture smoke test PASSED.");
  } catch (error) {
    console.error("\nPermission fixture smoke test FAILED:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    const mongoose = require("mongoose");

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("MongoDB connection closed.");
    }
  }
};

runTest();