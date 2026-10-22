require("dotenv").config();

const mongoose = require("mongoose");

const connectDB = require("./config/db");

const User = require("./models/User");
const Permission = require("./models/Permission");
const UserPermission = require("./models/UserPermission");

const {
  grantPermissionToAdmin,
  revokePermissionFromAdmin,
  getEffectivePermissions,
} = require("./services/permissionService");

const {
  canOwnerDelegatePermission,
} = require("./constants/permissionRolePolicy");

const run = async () => {
  try {
    console.log("========================================");
    console.log("32.16.13 Owner/Admin Permission Model");
    console.log("Regression Test");
    console.log("========================================");

    await connectDB();

    const instituteA = new mongoose.Types.ObjectId(
      "6a9efed53224626663b28f4d"
    );

    const instituteB = new mongoose.Types.ObjectId(
      "6aa18d1075611cbb788644e9"
    );

    const ownerA = await User.findOne({
      email: "owner@test001.com",
      role: "INSTITUTE_OWNER",
      instituteId: instituteA,
      isDeleted: false,
    });

    const adminA = await User.findOne({
      email: "admin@testcoaching.com",
      role: "INSTITUTE_ADMIN",
      instituteId: instituteA,
      isDeleted: false,
    });

    const adminB = await User.findOne({
      email: "securityadminb@testcoaching.com",
      role: "INSTITUTE_ADMIN",
      instituteId: instituteB,
      isDeleted: false,
    });

    if (!ownerA || !adminA || !adminB) {
      throw new Error(
        "Required Owner/Admin fixtures not found"
      );
    }

    const adminRead = await Permission.findOne({
      permissionKey: "ADMIN_READ",
      isActive: true,
    });

    const instituteUpdate = await Permission.findOne({
      permissionKey: "INSTITUTE_UPDATE",
      isActive: true,
    });

    const domainVerify = await Permission.findOne({
      permissionKey: "DOMAIN_VERIFY",
      isActive: true,
    });

    if (
      !adminRead ||
      !instituteUpdate ||
      !domainVerify
    ) {
      throw new Error(
        "Required permissions not found"
      );
    }

    await UserPermission.deleteMany({
      userId: adminA._id,
      instituteId: instituteA,
      permissionId: {
        $in: [
          adminRead._id,
          instituteUpdate._id,
          domainVerify._id,
        ],
      },
    });

    console.log(
      "\nTEST 1: Owner can delegate delegatable permission"
    );

    const grantResult =
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: instituteA,
        permissionKey: "ADMIN_READ",
        grantedBy: ownerA._id,
      });

    if (grantResult.action !== "GRANTED") {
      throw new Error(
        "Expected permission to be granted"
      );
    }

    console.log(
      "Owner successfully delegated ADMIN_READ."
    );

    console.log("TEST 1 PASSED.");

    console.log(
      "\nTEST 2: Admin cannot grant permission"
    );

    let adminGrantBlocked = false;

    try {
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: instituteA,
        permissionKey: "ADMIN_READ",
        grantedBy: adminA._id,
      });
    } catch (error) {
      adminGrantBlocked = true;
      console.log(
        "Admin grant correctly blocked."
      );
    }

    if (!adminGrantBlocked) {
      throw new Error(
        "Admin was incorrectly allowed to grant permission"
      );
    }

    console.log("TEST 2 PASSED.");

    console.log(
      "\nTEST 3: Non-delegatable permission blocked"
    );

    let nonDelegatableBlocked = false;

    try {
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: instituteA,
        permissionKey: "INSTITUTE_UPDATE",
        grantedBy: ownerA._id,
      });
    } catch (error) {
      nonDelegatableBlocked = true;
      console.log(
        "Non-delegatable permission correctly blocked."
      );
    }

    if (!nonDelegatableBlocked) {
      throw new Error(
        "Non-delegatable permission was incorrectly granted"
      );
    }

    console.log("TEST 3 PASSED.");

    console.log(
      "\nTEST 4: Platform permission blocked"
    );

    let platformBlocked = false;

    try {
      await grantPermissionToAdmin({
        userId: adminA._id,
        instituteId: instituteA,
        permissionKey: "DOMAIN_VERIFY",
        grantedBy: ownerA._id,
      });
    } catch (error) {
      platformBlocked = true;
      console.log(
        "Platform permission correctly blocked."
      );
    }

    if (!platformBlocked) {
      throw new Error(
        "Platform permission was incorrectly granted"
      );
    }

    console.log("TEST 4 PASSED.");

    console.log(
      "\nTEST 5: Cross-institute target blocked"
    );

    let crossInstituteBlocked = false;

    try {
      await grantPermissionToAdmin({
        userId: adminB._id,
        instituteId: instituteA,
        permissionKey: "ADMIN_READ",
        grantedBy: ownerA._id,
      });
    } catch (error) {
      crossInstituteBlocked = true;
      console.log(
        "Cross-institute permission assignment correctly blocked."
      );
    }

    if (!crossInstituteBlocked) {
      throw new Error(
        "Cross-institute permission assignment was allowed"
      );
    }

    console.log("TEST 5 PASSED.");

    console.log(
      "\nTEST 6: Owner receives all non-platform permissions"
    );

    const ownerPermissions =
      await getEffectivePermissions({
        userId: ownerA._id,
        instituteId: instituteA,
      });

    const ownerHasAdminRead =
      ownerPermissions.some(
        (permission) =>
          permission.permissionKey === "ADMIN_READ"
      );

    const ownerHasPlatform =
      ownerPermissions.some(
        (permission) =>
          permission.category === "PLATFORM"
      );

    if (!ownerHasAdminRead) {
      throw new Error(
        "Owner should have ADMIN_READ effective permission"
      );
    }

    if (ownerHasPlatform) {
      throw new Error(
        "Owner must not receive PLATFORM permissions"
      );
    }

    console.log(
      "Owner effective permissions correctly limited to non-platform permissions."
    );

    console.log("TEST 6 PASSED.");

    console.log(
      "\nTEST 7: Admin receives only assigned permissions"
    );

    const adminPermissions =
      await getEffectivePermissions({
        userId: adminA._id,
        instituteId: instituteA,
      });

    const adminHasAdminRead =
      adminPermissions.some(
        (permission) =>
          permission.permissionKey === "ADMIN_READ"
      );

    const adminHasInstituteUpdate =
      adminPermissions.some(
        (permission) =>
          permission.permissionKey ===
          "INSTITUTE_UPDATE"
      );

    if (!adminHasAdminRead) {
      throw new Error(
        "Admin should have assigned ADMIN_READ"
      );
    }

    if (adminHasInstituteUpdate) {
      throw new Error(
        "Admin incorrectly received unassigned INSTITUTE_UPDATE"
      );
    }

    console.log(
      "Admin effective permissions correctly limited to assigned permissions."
    );

    console.log("TEST 7 PASSED.");

    console.log(
      "\nTEST 8: Owner can revoke Admin permission"
    );

    await revokePermissionFromAdmin({
      userId: adminA._id,
      instituteId: instituteA,
      permissionKey: "ADMIN_READ",
      revokedBy: ownerA._id,
    });

    const remainingAssignment =
      await UserPermission.findOne({
        userId: adminA._id,
        instituteId: instituteA,
        permissionId: adminRead._id,
        isActive: true,
      });

    if (remainingAssignment) {
      throw new Error(
        "Permission was not revoked"
      );
    }

    console.log(
      "Owner successfully revoked Admin permission."
    );

    console.log("TEST 8 PASSED.");

    console.log(
      "\nTEST 9: Admin cannot revoke permission"
    );

    // const assignment =
    //   await UserPermission.create({
    //     userId: adminA._id,
    //     instituteId: instituteA,
    //     permissionId: adminRead._id,
    //     grantedBy: ownerA._id,
    //     isActive: true,
    //   });
    const assignment =
  await UserPermission.findOneAndUpdate(
    {
      userId: adminA._id,
      instituteId: instituteA,
      permissionId: adminRead._id,
    },
    {
      $set: {
        isActive: true,
        grantedBy: ownerA._id,
      },
    },
    {
      returnDocument: "after",
      upsert: true,
    }
  );

    let adminRevokeBlocked = false;

    try {
      await revokePermissionFromAdmin({
        userId: adminA._id,
        instituteId: instituteA,
        permissionKey: "ADMIN_READ",
        revokedBy: adminA._id,
      });
    } catch (error) {
      adminRevokeBlocked = true;
      console.log(
        "Admin revoke correctly blocked."
      );
    }

    if (!adminRevokeBlocked) {
      throw new Error(
        "Admin was incorrectly allowed to revoke permission"
      );
    }

    await UserPermission.deleteOne({
      _id: assignment._id,
    });

    console.log("TEST 9 PASSED.");

    await UserPermission.deleteMany({
      userId: adminA._id,
      instituteId: instituteA,
      permissionId: {
        $in: [
          adminRead._id,
          instituteUpdate._id,
          domainVerify._id,
        ],
      },
    });

    console.log("\nFinal cleanup completed.");

    console.log("\n========================================");
    console.log(
      "ALL 32.16.13 PERMISSION MODEL TESTS PASSED"
    );
    console.log("========================================");
  } catch (error) {
    console.error("\n========================================");
    console.error("32.16.13 TEST FAILED");
    console.error("========================================");
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log("\nMongoDB connection closed.");
  }
};

run();