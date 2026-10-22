require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("./config/db");

const User = require("./models/User");
const Permission = require("./models/Permission");
const UserPermission = require("./models/UserPermission");

const {
  grantPermissionToAdmin,
  revokePermissionFromAdmin,
} = require("./services/permissionService");

const INSTITUTE_A_ID = "6a9efed53224626663b28f4d";
const INSTITUTE_B_ID = "6aa18d1075611cbb788644e9";

const OWNER_A_ID = "6aaff4d26427fbe6c8697796";

const ADMIN_A_EMAIL = "admin@testcoaching.com";
const ADMIN_B_EMAIL = "securityadminb@testcoaching.com";

const runTest = async () => {
  let adminA;
  let adminB;

  try {
    console.log("========================================");
    console.log("Permission Validation & Regression Test");
    console.log("========================================");

    await connectDB();

    /*
     * --------------------------------------------------
     * TEST FIXTURES
     * --------------------------------------------------
     */

    adminA = await User.findOne({
      email: ADMIN_A_EMAIL,
      instituteId: INSTITUTE_A_ID,
      role: "INSTITUTE_ADMIN",
      isDeleted: false,
    });

    adminB = await User.findOne({
      email: ADMIN_B_EMAIL,
      instituteId: INSTITUTE_B_ID,
      role: "INSTITUTE_ADMIN",
      isDeleted: false,
    });

    if (!adminA) {
      throw new Error("Institute A Admin not found");
    }

    if (!adminB) {
      throw new Error("Institute B Admin not found");
    }

    console.log("\nTest Fixtures:");
    console.log(`Institute A Admin: ${adminA.email}`);
    console.log(`Institute B Admin: ${adminB.email}`);

    /*
     * --------------------------------------------------
     * TEST 1
     * Same-institute Admin permission assignment
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 1: Same-institute permission assignment"
    );

    const adminReadPermission = await Permission.findOne({
      permissionKey: "ADMIN_READ",
      isActive: true,
    });

    if (!adminReadPermission) {
      throw new Error("ADMIN_READ permission not found");
    }

    await UserPermission.deleteOne({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionId: adminReadPermission._id,
    });

    const grantResult = await grantPermissionToAdmin({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionKey: "ADMIN_READ",
      grantedBy: OWNER_A_ID,
    });

    if (grantResult.action !== "GRANTED") {
      throw new Error(
        "Same-institute permission assignment failed"
      );
    }

    console.log("Same-institute assignment accepted.");
    console.log("TEST 1 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 2
     * Cross-institute Admin must be rejected
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 2: Cross-institute Admin protection"
    );

    try {
      await grantPermissionToAdmin({
        userId: adminB._id,
        instituteId: INSTITUTE_A_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_A_ID,
      });

      throw new Error(
        "Cross-institute permission assignment was incorrectly allowed"
      );
    } catch (error) {
      if (
        error.message !==
        "Target user is not a valid Institute Admin for this institute"
      ) {
        throw error;
      }

      console.log(
        "Cross-institute assignment correctly rejected."
      );
    }

    console.log("TEST 2 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 3
     * Non-Admin user must be rejected
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 3: Non-Admin target protection"
    );

    const nonAdminUser = await User.findOne({
      instituteId: INSTITUTE_A_ID,
      role: {
        $in: [
          "TEACHER",
          "STUDENT",
          "PARENT",
        ],
      },
      isDeleted: false,
    });

    if (!nonAdminUser) {
      throw new Error(
        "No Teacher/Student/Parent fixture found in Institute A"
      );
    }

    try {
      await grantPermissionToAdmin({
        userId: nonAdminUser._id,
        instituteId: INSTITUTE_A_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_A_ID,
      });

      throw new Error(
        "Non-Admin permission assignment was incorrectly allowed"
      );
    } catch (error) {
      if (
        error.message !==
        "Target user is not a valid Institute Admin for this institute"
      ) {
        throw error;
      }

      console.log(
        `Non-Admin target (${nonAdminUser.role}) correctly rejected.`
      );
    }

    console.log("TEST 3 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 4
     * Invalid ObjectId protection
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 4: Invalid ObjectId protection"
    );

    try {
      await grantPermissionToAdmin({
        userId: "invalid-user-id",
        instituteId: INSTITUTE_A_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_A_ID,
      });

      throw new Error(
        "Invalid user ObjectId was incorrectly accepted"
      );
    } catch (error) {
      if (
        error.message !==
        "Invalid user, institute, or grantor ID"
      ) {
        throw error;
      }

      console.log(
        "Invalid user ObjectId correctly rejected."
      );
    }

    console.log("TEST 4 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 5
     * Inactive Admin protection
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 5: Inactive Admin protection"
    );

    const originalIsActive = adminA.isActive;
    const originalAccountStatus = adminA.accountStatus;

    adminA.isActive = false;
    adminA.accountStatus = "SUSPENDED";

    await adminA.save();

    try {
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: INSTITUTE_A_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_A_ID,
      });

      throw new Error(
        "Inactive Admin permission assignment was incorrectly allowed"
      );
    } catch (error) {
      if (
        error.message !==
        "Target Institute Admin is not active"
      ) {
        throw error;
      }

      console.log(
        "Inactive Admin correctly rejected."
      );
    }

    /*
     * Restore original Admin state immediately.
     */
    adminA.isActive = originalIsActive;
    adminA.accountStatus = originalAccountStatus;

    await adminA.save();

    console.log("Admin state restored.");
    console.log("TEST 5 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 6
     * Inactive permission protection
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 6: Inactive permission protection"
    );

    const originalPermissionActive =
      adminReadPermission.isActive;

    adminReadPermission.isActive = false;
    await adminReadPermission.save();

    try {
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: INSTITUTE_A_ID,
        permissionKey: "ADMIN_READ",
        grantedBy: OWNER_A_ID,
      });

      throw new Error(
        "Inactive permission was incorrectly allowed"
      );
    } catch (error) {
      if (error.message !== "Permission is inactive") {
        throw error;
      }

      console.log(
        "Inactive permission correctly rejected."
      );
    }

    /*
     * Restore permission state immediately.
     */
    adminReadPermission.isActive =
      originalPermissionActive;

    await adminReadPermission.save();

    console.log("Permission state restored.");
    console.log("TEST 6 PASSED.");

    /*
     * --------------------------------------------------
     * TEST 7
     * Revoke + reactivation behavior
     * --------------------------------------------------
     */

    console.log(
      "\nTEST 7: Revoke and controlled reactivation"
    );

    /*
     * Ensure current assignment exists.
     */
    const existingAssignment = await UserPermission.findOne({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionId: adminReadPermission._id,
    });

    if (existingAssignment) {
      await UserPermission.deleteOne({
        _id: existingAssignment._id,
      });
    }

    const firstGrant = await grantPermissionToAdmin({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionKey: "ADMIN_READ",
      grantedBy: OWNER_A_ID,
    });

    if (firstGrant.action !== "GRANTED") {
      throw new Error(
        "Initial permission grant failed"
      );
    }

    // await revokePermissionFromAdmin({
    //   userId: adminA._id,
    //   instituteId: INSTITUTE_A_ID,
    //   permissionKey: "ADMIN_READ",
    // });
       await revokePermissionFromAdmin({
         userId: adminA._id,
         instituteId: INSTITUTE_A_ID,
         permissionKey: "ADMIN_READ",
         revokedBy: OWNER_A_ID,
        });

    const revokedAssignment =
      await UserPermission.findOne({
        userId: adminA._id,
        instituteId: INSTITUTE_A_ID,
        permissionId: adminReadPermission._id,
      });

    if (!revokedAssignment) {
      throw new Error(
        "Revoked assignment record was not found"
      );
    }

    if (revokedAssignment.isActive !== false) {
      throw new Error(
        "Permission revoke did not set isActive=false"
      );
    }

    const secondGrant = await grantPermissionToAdmin({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionKey: "ADMIN_READ",
      grantedBy: OWNER_A_ID,
    });

    if (secondGrant.action !== "REACTIVATED") {
      throw new Error(
        "Revoked permission was not correctly reactivated"
      );
    }

    console.log(
      "Revoked permission correctly reactivated."
    );

    console.log("TEST 7 PASSED.");

    /*
     * --------------------------------------------------
     * FINAL CLEANUP
     * --------------------------------------------------
     */

    await UserPermission.deleteOne({
      userId: adminA._id,
      instituteId: INSTITUTE_A_ID,
      permissionId: adminReadPermission._id,
    });

    /*
     * Ensure permission itself is active.
     */
    adminReadPermission.isActive = true;
    await adminReadPermission.save();

    /*
     * Ensure Admin A is active.
     */
    adminA.isActive = true;
    adminA.accountStatus = "ACTIVE";
    await adminA.save();

    console.log("\nFinal cleanup completed.");

    console.log("\n========================================");
    console.log(
      "ALL PERMISSION VALIDATION TESTS PASSED"
    );
    console.log("========================================");
  } catch (error) {
    console.error("\n========================================");
    console.error(
      "PERMISSION VALIDATION TEST FAILED"
    );
    console.error("========================================");
    console.error(error.message);

    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();

    console.log("\nMongoDB connection closed.");
  }
};

runTest();