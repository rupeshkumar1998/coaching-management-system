require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("./config/db");

const User = require("./models/User");
const UserPermission = require("./models/UserPermission");

const {
  grantPermissionToAdmin,
  revokePermissionFromAdmin,
  getAdminPermissions,
} = require("./services/permissionService");

const INSTITUTE_ID = "6a9efed53224626663b28f4d";
const OWNER_ID = "6aaff4d26427fbe6c8697796";
const ADMIN_EMAIL = "admin@testcoaching.com";

const runTest = async () => {
  let admin;

  try {
    console.log("========================================");
    console.log("Permission Assignment Service Test");
    console.log("========================================");

    await connectDB();

    admin = await User.findOne({
      email: ADMIN_EMAIL,
      instituteId: INSTITUTE_ID,
      role: "INSTITUTE_ADMIN",
      isDeleted: false,
    });

    if (!admin) {
      throw new Error("Test Institute Admin not found");
    }

    console.log("\nTest Admin:");
    console.log(`Name  : ${admin.name}`);
    console.log(`Email : ${admin.email}`);
    console.log(`Role  : ${admin.role}`);

    /*
     * Cleanup only the specific test permission assignment.
     * This does NOT delete or modify the Admin account.
     */
    const permission = await mongoose
      .model("Permission")
      .findOne({
        permissionKey: "ADMIN_READ",
      });

    if (!permission) {
      throw new Error("ADMIN_READ permission not found");
    }

    await UserPermission.deleteOne({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
      permissionId: permission._id,
    });

    console.log("\nInitial cleanup completed.");

    /*
     * TEST 1: Grant delegatable permission
     */
    console.log("\nTEST 1: Grant ADMIN_READ");

    const grantResult = await grantPermissionToAdmin({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
      permissionKey: "ADMIN_READ",
      grantedBy: OWNER_ID,
    });

    console.log(`Result: ${grantResult.action}`);

    if (grantResult.action !== "GRANTED") {
      throw new Error("ADMIN_READ was not granted correctly");
    }

    console.log("TEST 1 PASSED.");

    /*
     * TEST 2: Verify active permission
     */
    console.log("\nTEST 2: Verify assigned permission");

    const assignedPermissions = await getAdminPermissions({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
    });

    const hasAdminRead = assignedPermissions.some(
      (item) =>
        item.permissionId &&
        item.permissionId.permissionKey === "ADMIN_READ"
    );

    if (!hasAdminRead) {
      throw new Error(
        "ADMIN_READ was not found in active permissions"
      );
    }

    console.log("ADMIN_READ found in active permissions.");
    console.log("TEST 2 PASSED.");

    /*
     * TEST 3: Duplicate assignment must fail
     */
    console.log("\nTEST 3: Duplicate assignment protection");

    try {
      await grantPermissionToAdmin({
        userId: admin._id,
        instituteId: INSTITUTE_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_ID,
      });

      throw new Error(
        "Duplicate permission assignment was incorrectly allowed"
      );
    } catch (error) {
      if (error.message !== "Permission is already assigned") {
        throw error;
      }

      console.log(
        "Duplicate assignment correctly rejected."
      );
    }

    console.log("TEST 3 PASSED.");

    /*
     * TEST 4: Revoke permission
     */
    console.log("\nTEST 4: Revoke ADMIN_READ");

    await revokePermissionFromAdmin({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
      permissionKey: "ADMIN_READ",
      revokedBy: OWNER_ID,
    });

    const afterRevoke = await getAdminPermissions({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
    });

    const stillActive = afterRevoke.some(
      (item) =>
        item.permissionId &&
        item.permissionId.permissionKey === "ADMIN_READ"
    );

    if (stillActive) {
      throw new Error(
        "ADMIN_READ is still active after revoke"
      );
    }

    console.log("ADMIN_READ successfully revoked.");
    console.log("TEST 4 PASSED.");

    /*
     * TEST 5: Non-delegatable permission must fail
     */
    console.log(
      "\nTEST 5: Non-delegatable permission protection"
    );

    try {
      await grantPermissionToAdmin({
        userId: admin._id,
        instituteId: INSTITUTE_ID,
        permissionKey: "ADMIN_CREATE",
        grantedBy: OWNER_ID,
      });

      throw new Error(
        "Non-delegatable ADMIN_CREATE was incorrectly allowed"
      );
    } catch (error) {
      if (error.message !== "This permission cannot be delegated") {
        throw error;
      }

      console.log(
        "ADMIN_CREATE correctly rejected."
      );
    }

    console.log("TEST 5 PASSED.");

    /*
     * Final cleanup
     */
    await UserPermission.deleteOne({
      userId: admin._id,
      instituteId: INSTITUTE_ID,
      permissionId: permission._id,
    });

    console.log("\nFinal cleanup completed.");

    console.log("\n========================================");
    console.log("ALL PERMISSION ASSIGNMENT TESTS PASSED");
    console.log("========================================");
  } catch (error) {
    console.error("\n========================================");
    console.error("PERMISSION ASSIGNMENT TEST FAILED");
    console.error("========================================");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();

    console.log("\nMongoDB connection closed.");
  }
};

runTest();