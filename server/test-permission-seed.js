require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("./config/db");
const Permission = require("./models/Permission");
const {
  seedPermissions,
} = require("./services/permissionService");

const runTest = async () => {
  try {
    console.log("========================================");
    console.log("Permission Seed Test Started");
    console.log("========================================");

    // Connect to existing project database
    await connectDB();

    console.log("\nRunning permission seed...\n");

    const result = await seedPermissions();

    console.log("Seed Result:");
    console.log(`Created   : ${result.created}`);
    console.log(`Updated   : ${result.updated}`);
    console.log(`Unchanged : ${result.unchanged}`);

    const totalPermissions = await Permission.countDocuments();

    console.log("\nDatabase Verification:");
    console.log(`Total Permissions: ${totalPermissions}`);

    if (totalPermissions === 0) {
      throw new Error("Permission seed failed: no permissions found");
    }

    console.log("\nPermission seed test PASSED.");
  } catch (error) {
    console.error("\nPermission seed test FAILED.");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();

    console.log("\nMongoDB connection closed.");
    console.log("========================================");
    console.log("Permission Seed Test Finished");
    console.log("========================================");
  }
};

runTest();