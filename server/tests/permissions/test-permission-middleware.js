// require("dotenv").config();

// const mongoose = require("mongoose");
// const connectTestDB = require("../helpers/connectTestDB");

// const User = require("../../models/User");
// const Permission = require("../../models/Permission");
// const UserPermission = require("../../models/UserPermission");

// const requirePermission = require("../../middleware/permissionMiddleware");

// const INSTITUTE_A_ID = "6a9efed53224626663b28f4d";
// const OWNER_A_ID = "6aaff4d26427fbe6c8697796";

// const ADMIN_A_EMAIL = "admin@testcoaching.com";

// const runMiddleware = async (req) => {
//   return new Promise((resolve, reject) => {
//     const res = {
//       statusCode: 200,
//       body: null,

//       status(code) {
//         this.statusCode = code;
//         return this;
//       },

//       json(data) {
//         this.body = data;
//         resolve({
//           nextCalled: false,
//           statusCode: this.statusCode,
//           body: this.body,
//         });
//       },
//     };

//     const next = () => {
//       resolve({
//         nextCalled: true,
//         statusCode: res.statusCode,
//         body: res.body,
//       });
//     };

//     requirePermission(req.permissionKey)(req, res, next);
//   });
// };

// const runTest = async () => {
//   let admin;
//   let adminReadPermission;
//   let domainVerifyPermission;

//   try {
//     console.log("========================================");
//     console.log("Permission Middleware Regression Test");
//     console.log("========================================");

//     await connectTestDB();

//     admin = await User.findOne({
//       email: ADMIN_A_EMAIL,
//       instituteId: INSTITUTE_A_ID,
//       role: "INSTITUTE_ADMIN",
//       isDeleted: false,
//     });

//     if (!admin) {
//       throw new Error("Institute A Admin not found");
//     }

//     adminReadPermission = await Permission.findOne({
//       permissionKey: "ADMIN_READ",
//       isActive: true,
//     });

//     domainVerifyPermission = await Permission.findOne({
//       permissionKey: "DOMAIN_VERIFY",
//       isActive: true,
//     });

//     if (!adminReadPermission) {
//       throw new Error("ADMIN_READ permission not found");
//     }

//     if (!domainVerifyPermission) {
//       throw new Error("DOMAIN_VERIFY permission not found");
//     }

//     /*
//      * Cleanup only test assignment.
//      */
//     await UserPermission.deleteOne({
//       userId: admin._id,
//       instituteId: INSTITUTE_A_ID,
//       permissionId: adminReadPermission._id,
//     });

//     /*
//      * --------------------------------------------------
//      * TEST 1
//      * Unauthenticated request
//      * --------------------------------------------------
//      */

//     console.log("\nTEST 1: Unauthenticated request");

//     let result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: null,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 401
//     ) {
//       throw new Error(
//         "Unauthenticated request was not rejected correctly"
//       );
//     }

//     console.log("Unauthenticated request rejected.");
//     console.log("TEST 1 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 2
//      * Admin without permission
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 2: Admin without assigned permission"
//     );

//     result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: admin,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 403
//     ) {
//       throw new Error(
//         "Admin without permission was incorrectly allowed"
//       );
//     }

//     console.log(
//       "Admin without permission correctly rejected."
//     );
//     console.log("TEST 2 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 3
//      * Admin with assigned permission
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 3: Admin with assigned permission"
//     );

//     await UserPermission.create({
//       userId: admin._id,
//       instituteId: INSTITUTE_A_ID,
//       permissionId: adminReadPermission._id,
//       grantedBy: OWNER_A_ID,
//       isActive: true,
//     });

//     result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: admin,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (!result.nextCalled) {
//       throw new Error(
//         "Admin with assigned permission was rejected"
//       );
//     }

//     if (
//       !result ||
//       result.nextCalled !== true
//     ) {
//       throw new Error(
//         "Permission middleware did not call next()"
//       );
//     }

//     console.log(
//       "Admin with permission correctly allowed."
//     );
//     console.log("TEST 3 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 4
//      * Wrong tenant context
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 4: Wrong tenant context"
//     );

//     const WRONG_INSTITUTE_ID =
//       "6aa18d1075611cbb788644e9";

//     result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: admin,
//       tenantId: WRONG_INSTITUTE_ID,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 403
//     ) {
//       throw new Error(
//         "Wrong tenant context was incorrectly allowed"
//       );
//     }

//     console.log(
//       "Wrong tenant context correctly rejected."
//     );
//     console.log("TEST 4 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 5
//      * Inactive assignment
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 5: Inactive permission assignment"
//     );

//     await UserPermission.updateOne(
//       {
//         userId: admin._id,
//         instituteId: INSTITUTE_A_ID,
//         permissionId: adminReadPermission._id,
//       },
//       {
//         $set: {
//           isActive: false,
//         },
//       }
//     );

//     result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: admin,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 403
//     ) {
//       throw new Error(
//         "Inactive permission assignment was incorrectly allowed"
//       );
//     }

//     console.log(
//       "Inactive assignment correctly rejected."
//     );
//     console.log("TEST 5 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 6
//      * Platform permission must be blocked
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 6: Platform permission protection"
//     );

//     result = await runMiddleware({
//       permissionKey: "DOMAIN_VERIFY",
//       user: admin,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 403
//     ) {
//       throw new Error(
//         "Platform permission was incorrectly allowed"
//       );
//     }

//     console.log(
//       "Platform permission correctly rejected."
//     );
//     console.log("TEST 6 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 7
//      * Institute Owner operational access
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 7: Institute Owner operational access"
//     );

//     const owner = await User.findOne({
//       _id: OWNER_A_ID,
//       instituteId: INSTITUTE_A_ID,
//       role: "INSTITUTE_OWNER",
//       isDeleted: false,
//     });

//     if (!owner) {
//       throw new Error("Institute Owner not found");
//     }

//     result = await runMiddleware({
//       permissionKey: "ADMIN_READ",
//       user: owner,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (!result.nextCalled) {
//       throw new Error(
//         "Institute Owner operational access was rejected"
//       );
//     }

//     console.log(
//       "Institute Owner operational access allowed."
//     );
//     console.log("TEST 7 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 8
//      * Institute Owner cannot use platform permission
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 8: Institute Owner platform boundary"
//     );

//     result = await runMiddleware({
//       permissionKey: "DOMAIN_VERIFY",
//       user: owner,
//       tenantId: INSTITUTE_A_ID,
//     });

//     if (
//       result.nextCalled ||
//       result.statusCode !== 403
//     ) {
//       throw new Error(
//         "Institute Owner was incorrectly given platform access"
//       );
//     }

//     console.log(
//       "Institute Owner platform access correctly blocked."
//     );
//     console.log("TEST 8 PASSED.");

//     /*
//      * --------------------------------------------------
//      * TEST 9
//      * SUPER_ADMIN platform access
//      * --------------------------------------------------
//      */

//     console.log(
//       "\nTEST 9: Super Admin platform access"
//     );

//     const superAdmin = await User.findOne({
//       role: "SUPER_ADMIN",
//       isDeleted: false,
//     });

//     if (!superAdmin) {
//       throw new Error("Super Admin fixture not found");
//     }

//     result = await runMiddleware({
//       permissionKey: "DOMAIN_VERIFY",
//       user: superAdmin,
//     });

//     if (!result.nextCalled) {
//       throw new Error(
//         "Super Admin platform access was rejected"
//       );
//     }

//     console.log(
//       "Super Admin platform access allowed."
//     );
//     console.log("TEST 9 PASSED.");

//     /*
//      * --------------------------------------------------
//      * FINAL CLEANUP
//      * --------------------------------------------------
//      */

//     await UserPermission.deleteOne({
//       userId: admin._id,
//       instituteId: INSTITUTE_A_ID,
//       permissionId: adminReadPermission._id,
//     });

//     console.log("\nFinal cleanup completed.");

//     console.log("\n========================================");
//     console.log(
//       "ALL PERMISSION MIDDLEWARE TESTS PASSED"
//     );
//     console.log("========================================");
//   } catch (error) {
//     console.error("\n========================================");
//     console.error(
//       "PERMISSION MIDDLEWARE TEST FAILED"
//     );
//     console.error("========================================");
//     console.error(error.message);

//     process.exitCode = 1;
//   } finally {
//     await mongoose.connection.close();

//     console.log("\nMongoDB connection closed.");
//   }
// };

// runTest();

const mongoose = require("mongoose");

const connectTestDB = require("../helpers/connectTestDB");
const ensurePermissionFixtures = require("../helpers/permissionFixtures");

const Permission = require("../../models/Permission");
const UserPermission = require("../../models/UserPermission");

const requirePermission = require("../../middleware/permissionMiddleware");

const runMiddleware = async (req) => {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      body: null,

      status(code) {
        this.statusCode = code;
        return this;
      },

      json(data) {
        this.body = data;

        resolve({
          nextCalled: false,
          statusCode: this.statusCode,
          body: this.body,
        });
      },
    };

    const next = () => {
      resolve({
        nextCalled: true,
        statusCode: res.statusCode,
        body: res.body,
      });
    };

    try {
      Promise.resolve(
        requirePermission(req.permissionKey)(req, res, next)
      ).catch(reject);
    } catch (error) {
      reject(error);
    }
  });
};

const runTest = async () => {
  let admin;
  let instituteAId;
  let adminReadPermission;

  try {
    console.log("========================================");
    console.log("Permission Middleware Regression Test");
    console.log("========================================");

    await connectTestDB();

    const fixtures = await ensurePermissionFixtures();

    admin = fixtures.adminA;
    instituteAId = fixtures.instituteA._id;

    const instituteBId = fixtures.instituteB._id;
    const owner = fixtures.ownerA;
    const superAdmin = fixtures.superAdmin;

    adminReadPermission = await Permission.findOne({
      permissionKey: "ADMIN_READ",
      isActive: true,
    });

    const domainVerifyPermission = await Permission.findOne({
      permissionKey: "DOMAIN_VERIFY",
      isActive: true,
    });

    if (!adminReadPermission) {
      throw new Error("ADMIN_READ permission not found");
    }

    if (!domainVerifyPermission) {
      throw new Error("DOMAIN_VERIFY permission not found");
    }

    // Remove only this test's assignment before starting.
    await UserPermission.deleteOne({
      userId: admin._id,
      instituteId: instituteAId,
      permissionId: adminReadPermission._id,
    });

    /*
     * TEST 1
     * Unauthenticated request
     */
    console.log("\nTEST 1: Unauthenticated request");

    let result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: null,
    });

    if (result.nextCalled || result.statusCode !== 401) {
      throw new Error(
        "Unauthenticated request was not rejected correctly"
      );
    }

    console.log("Unauthenticated request rejected.");
    console.log("TEST 1 PASSED.");

    /*
     * TEST 2
     * Admin without permission
     */
    console.log("\nTEST 2: Admin without assigned permission");

    result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: admin,
      tenantId: instituteAId,
    });

    if (result.nextCalled || result.statusCode !== 403) {
      throw new Error(
        "Admin without permission was incorrectly allowed"
      );
    }

    console.log("Admin without permission correctly rejected.");
    console.log("TEST 2 PASSED.");

    /*
     * TEST 3
     * Admin with assigned permission
     */
    console.log("\nTEST 3: Admin with assigned permission");

    await UserPermission.create({
      userId: admin._id,
      instituteId: instituteAId,
      permissionId: adminReadPermission._id,
      grantedBy: owner._id,
      isActive: true,
    });

    result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: admin,
      tenantId: instituteAId,
    });

    if (!result.nextCalled) {
      throw new Error(
        "Admin with assigned permission was rejected"
      );
    }

    console.log("Admin with permission correctly allowed.");
    console.log("TEST 3 PASSED.");

    /*
     * TEST 4
     * Wrong tenant context
     */
    console.log("\nTEST 4: Wrong tenant context");

    result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: admin,
      tenantId: instituteBId,
    });

    if (result.nextCalled || result.statusCode !== 403) {
      throw new Error(
        "Wrong tenant context was incorrectly allowed"
      );
    }

    console.log("Wrong tenant context correctly rejected.");
    console.log("TEST 4 PASSED.");

    /*
     * TEST 5
     * Inactive assignment
     */
    console.log("\nTEST 5: Inactive permission assignment");

    await UserPermission.updateOne(
      {
        userId: admin._id,
        instituteId: instituteAId,
        permissionId: adminReadPermission._id,
      },
      {
        $set: {
          isActive: false,
        },
      }
    );

    result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: admin,
      tenantId: instituteAId,
    });

    if (result.nextCalled || result.statusCode !== 403) {
      throw new Error(
        "Inactive permission assignment was incorrectly allowed"
      );
    }

    console.log("Inactive assignment correctly rejected.");
    console.log("TEST 5 PASSED.");

    /*
     * TEST 6
     * Platform permission must be blocked
     */
    console.log("\nTEST 6: Platform permission protection");

    result = await runMiddleware({
      permissionKey: "DOMAIN_VERIFY",
      user: admin,
      tenantId: instituteAId,
    });

    if (result.nextCalled || result.statusCode !== 403) {
      throw new Error(
        "Platform permission was incorrectly allowed"
      );
    }

    console.log("Platform permission correctly rejected.");
    console.log("TEST 6 PASSED.");

    /*
     * TEST 7
     * Institute Owner operational access
     */
    console.log("\nTEST 7: Institute Owner operational access");

    result = await runMiddleware({
      permissionKey: "ADMIN_READ",
      user: owner,
      tenantId: instituteAId,
    });

    if (!result.nextCalled) {
      throw new Error(
        "Institute Owner operational access was rejected"
      );
    }

    console.log("Institute Owner operational access allowed.");
    console.log("TEST 7 PASSED.");

    /*
     * TEST 8
     * Institute Owner cannot use platform permission
     */
    console.log("\nTEST 8: Institute Owner platform boundary");

    result = await runMiddleware({
      permissionKey: "DOMAIN_VERIFY",
      user: owner,
      tenantId: instituteAId,
    });

    if (result.nextCalled || result.statusCode !== 403) {
      throw new Error(
        "Institute Owner was incorrectly given platform access"
      );
    }

    console.log("Institute Owner platform access correctly blocked.");
    console.log("TEST 8 PASSED.");

    /*
     * TEST 9
     * Super Admin platform access
     */
    console.log("\nTEST 9: Super Admin platform access");

    result = await runMiddleware({
      permissionKey: "DOMAIN_VERIFY",
      user: superAdmin,
    });

    if (!result.nextCalled) {
      throw new Error(
        "Super Admin platform access was rejected"
      );
    }

    console.log("Super Admin platform access allowed.");
    console.log("TEST 9 PASSED.");

    console.log("\n========================================");
    console.log("ALL PERMISSION MIDDLEWARE TESTS PASSED");
    console.log("========================================");
  } catch (error) {
    console.error("\n========================================");
    console.error("PERMISSION MIDDLEWARE TEST FAILED");
    console.error("========================================");
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Remove only this test's permission assignment.
    if (
      mongoose.connection.readyState === 1 &&
      admin &&
      instituteAId &&
      adminReadPermission
    ) {
      await UserPermission.deleteOne({
        userId: admin._id,
        instituteId: instituteAId,
        permissionId: adminReadPermission._id,
      });
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log("\nMongoDB connection closed.");
    }
  }
};

runTest();