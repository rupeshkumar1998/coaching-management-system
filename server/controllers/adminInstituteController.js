// const Institute = require("../models/Institute");
// const User = require("../models/User");
// const Subscription = require("../models/Subscription");
// const Payment = require("../models/Payment");

// // ==========================================
// // Get Pending Institute Registrations
// // ==========================================

// const getPendingInstitutes = async (req, res) => {
//   try {
//     const institutes = await Institute.find({
//       approvalStatus: "PENDING",
//     })
//       .sort({ createdAt: -1 })
//       .lean();

//     const results = [];

//     for (const institute of institutes) {
//       const admin = await User.findOne({
//         instituteId: institute._id,
//         role: "INSTITUTE_ADMIN",
//       })
//         .select("name email phone accountStatus isActive")
//         .lean();

//       const subscription = await Subscription.findOne({
//         instituteId: institute._id,
//       })
//         .sort({ createdAt: -1 })
//         .lean();

//       const payment = await Payment.findOne({
//         instituteId: institute._id,
//         paymentType: "INSTITUTE_SUBSCRIPTION",
//       })
//         .sort({ createdAt: -1 })
//         .lean();

//       results.push({
//         institute,
//         admin,
//         subscription,
//         payment,
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       count: results.length,
//       data: results,
//     });
//   } catch (error) {
//     console.error(
//       "Get Pending Institutes Error:",
//       error
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch pending institutes",
//     });
//   }
// };

// // ==========================================
// // Approve Institute Registration
// // ==========================================

// const approveInstitute = async (req, res) => {
//   try {
//     const { instituteId } = req.params;

//     // --------------------------------
//     // 1. Find Institute
//     // --------------------------------

//     const institute = await Institute.findById(instituteId);

//     if (!institute) {
//       return res.status(404).json({
//         success: false,
//         message: "Institute not found",
//       });
//     }

//     // --------------------------------
//     // 2. Prevent duplicate approval
//     // --------------------------------

//     if (institute.approvalStatus === "APPROVED") {
//       return res.status(400).json({
//         success: false,
//         message: "Institute is already approved",
//       });
//     }

//     // --------------------------------
//     // 3. Find Admin
//     // --------------------------------

//     const admin = await User.findOne({
//       instituteId: institute._id,
//       role: "INSTITUTE_ADMIN",
//     });

//     if (!admin) {
//       return res.status(404).json({
//         success: false,
//         message: "Institute Admin not found",
//       });
//     }

//     // --------------------------------
//     // 4. Find Subscription
//     // --------------------------------

//     const subscription = await Subscription.findOne({
//       instituteId: institute._id,
//       status: "PENDING",
//     }).sort({ createdAt: -1 });

//     if (!subscription) {
//       return res.status(404).json({
//         success: false,
//         message: "Pending subscription not found",
//       });
//     }

//     // --------------------------------
//     // 5. Find Payment
//     // --------------------------------

//     const payment = await Payment.findOne({
//       instituteId: institute._id,
//       subscriptionId: subscription._id,
//       paymentType: "INSTITUTE_SUBSCRIPTION",
//       status: "PENDING",
//     }).sort({ createdAt: -1 });

//     if (!payment) {
//       return res.status(404).json({
//         success: false,
//         message: "Pending payment not found",
//       });
//     }

//     // --------------------------------
//     // 6. Verify Payment
//     // --------------------------------

//     payment.status = "VERIFIED";
//     payment.verifiedBy = req.user._id;
//     payment.verifiedAt = new Date();

//     await payment.save();

//     // --------------------------------
//     // 7. Activate Subscription
//     // --------------------------------

//     const startDate = new Date();

//     const endDate = new Date(startDate);

//     // Current subscription duration:
//     // 30 days
//     endDate.setDate(endDate.getDate() + 30);

//     subscription.status = "ACTIVE";
//     subscription.startDate = startDate;
//     subscription.endDate = endDate;

//     await subscription.save();

//     // --------------------------------
//     // 8. Approve Institute
//     // --------------------------------

//     institute.approvalStatus = "APPROVED";
//     institute.isActive = true;
//     institute.subscriptionStatus = "ACTIVE";

//     await institute.save();

//     // --------------------------------
//     // 9. Activate Institute Admin
//     // --------------------------------

//     admin.accountStatus = "ACTIVE";
//     admin.isActive = true;

//     await admin.save();

//     // --------------------------------
//     // 10. Success response
//     // --------------------------------

//     return res.status(200).json({
//       success: true,
//       message:
//         "Institute approved and activated successfully",

//       data: {
//         institute: {
//           id: institute._id,
//           name: institute.name,
//           code: institute.code,
//           approvalStatus: institute.approvalStatus,
//           isActive: institute.isActive,
//           subscriptionStatus:
//             institute.subscriptionStatus,
//         },

//         admin: {
//           id: admin._id,
//           name: admin.name,
//           email: admin.email,
//           role: admin.role,
//           accountStatus: admin.accountStatus,
//           isActive: admin.isActive,
//         },

//         subscription: {
//           id: subscription._id,
//           plan: subscription.plan,
//           amount: subscription.amount,
//           status: subscription.status,
//           startDate: subscription.startDate,
//           endDate: subscription.endDate,
//         },

//         payment: {
//           id: payment._id,
//           amount: payment.amount,
//           method: payment.method,
//           status: payment.status,
//           verifiedBy: payment.verifiedBy,
//           verifiedAt: payment.verifiedAt,
//         },
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Approve Institute Error:",
//       error
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Failed to approve institute",
//     });
//   }
// };

// module.exports = {
//   getPendingInstitutes,
//   approveInstitute,
// };


const mongoose = require("mongoose");

const Institute = require("../models/Institute");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");

const {
  activateSubscription,
} = require("../services/subscriptionService");

// ==========================================
// Get Pending Institute Registrations
// ==========================================

const getPendingInstitutes = async (req, res) => {
  try {
    const institutes = await Institute.find({
      approvalStatus: "PENDING",
    })
      .sort({ createdAt: -1 })
      .lean();

    const results = [];

    for (const institute of institutes) {
      const admin = await User.findOne({
        instituteId: institute._id,
        role: "INSTITUTE_ADMIN",
      })
        .select("name email phone accountStatus isActive")
        .lean();

      const subscription = await Subscription.findOne({
        instituteId: institute._id,
      })
        .sort({ createdAt: -1 })
        .lean();

      const payment = subscription
        ? await Payment.findOne({
            instituteId: institute._id,
            subscriptionId: subscription._id,
            paymentType: "INSTITUTE_SUBSCRIPTION",
          })
            .sort({ createdAt: -1 })
            .lean()
        : null;

      results.push({
        institute,
        admin,
        subscription,
        payment,
      });
    }

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("Get Pending Institutes Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending institutes",
    });
  }
};

// ==========================================
// Approve Institute Registration
// ==========================================

const approveInstitute = async (req, res) => {
  const { instituteId } = req.params;

  if (!mongoose.isValidObjectId(instituteId)) {
    return res.status(400).json({
      success: false,
      message: "Invalid institute ID",
    });
  }

  if (!req.user?._id) {
    return res.status(401).json({
      success: false,
      message: "Authenticated Super Admin is required",
    });
  }

  const session = await mongoose.startSession();

  let approvedInstitute;
  let activatedAdmin;
  let activatedSubscription;
  let verifiedPayment = null;

  try {
    await session.withTransaction(async () => {
      // --------------------------------
      // 1. Load Institute inside transaction
      // --------------------------------

      const institute = await Institute.findById(
        instituteId
      ).session(session);

      if (!institute) {
        const error = new Error("Institute not found");
        error.statusCode = 404;
        throw error;
      }

      if (institute.approvalStatus === "APPROVED") {
        const error = new Error(
          "Institute is already approved"
        );
        error.statusCode = 409;
        throw error;
      }

      if (institute.approvalStatus !== "PENDING") {
        const error = new Error(
          "Institute is not pending approval"
        );
        error.statusCode = 409;
        throw error;
      }

      // --------------------------------
      // 2. Find Institute Admin
      // --------------------------------

      const admin = await User.findOne({
        instituteId: institute._id,
        role: "INSTITUTE_ADMIN",
      }).session(session);

      if (!admin) {
        const error = new Error(
          "Institute Admin not found"
        );
        error.statusCode = 404;
        throw error;
      }

      // --------------------------------
      // 3. Find pending subscription
      // --------------------------------

      const subscription = await Subscription.findOne({
        instituteId: institute._id,
        status: "PENDING",
      })
        .sort({ createdAt: -1 })
        .session(session);

      if (!subscription) {
        const error = new Error(
          "Pending subscription not found"
        );
        error.statusCode = 404;
        throw error;
      }

      // --------------------------------
      // 4. Validate payment requirement
      // --------------------------------

      if (
        subscription.subscriptionType === "TRIAL" &&
        subscription.paymentRequired === true
      ) {
        const error = new Error(
          "Trial subscription must not require payment"
        );
        error.statusCode = 409;
        throw error;
      }

      if (subscription.paymentRequired === true) {
        // Only an exact payment match can be verified.
        const payment = await Payment.findOne({
          instituteId: institute._id,
          subscriptionId: subscription._id,
          paymentType: "INSTITUTE_SUBSCRIPTION",
          status: "PENDING",
          amount: subscription.amount,
          currency: subscription.currency,
        })
          .sort({ createdAt: -1 })
          .session(session);

        if (!payment) {
          const error = new Error(
            "Matching pending payment not found. Verify the subscription amount and currency."
          );
          error.statusCode = 409;
          throw error;
        }

        payment.status = "VERIFIED";
        payment.verifiedBy = req.user._id;
        payment.verifiedAt = new Date();

        await payment.save({ session });

        verifiedPayment = payment;
      } else {
        // A subscription that does not require payment must
        // not have a positive amount.
        if (subscription.amount !== 0) {
          const error = new Error(
            "Subscription amount must be zero when payment is not required"
          );
          error.statusCode = 409;
          throw error;
        }
      }

      // --------------------------------
      // 5. Approve and activate Institute
      //
      // activateSubscription() requires an approved,
      // active Institute. This save is still inside the
      // same transaction.
      // --------------------------------

      institute.approvalStatus = "APPROVED";
      institute.isActive = true;

      await institute.save({ session });

      // --------------------------------
      // 6. Activate through subscription service
      //
      // This applies saved durationDays, validates the plan
      // snapshot and verified payment, and syncs the
      // Institute subscription summary.
      // --------------------------------

      activatedSubscription = await activateSubscription({
        subscriptionId: subscription._id,
        activatedBy: req.user._id,
        session,
      });

      // --------------------------------
      // 7. Activate Institute Admin
      // --------------------------------

      admin.accountStatus = "ACTIVE";
      admin.isActive = true;

      await admin.save({ session });

      approvedInstitute = institute;
      activatedAdmin = admin;
    });

    // --------------------------------
    // 8. Success response after commit
    // --------------------------------

    return res.status(200).json({
      success: true,
      message:
        "Institute approved and subscription activated successfully",
      data: {
        institute: {
          id: approvedInstitute._id,
          name: approvedInstitute.name,
          code: approvedInstitute.code,
          approvalStatus:
            approvedInstitute.approvalStatus,
          isActive: approvedInstitute.isActive,
          subscriptionStatus:
            approvedInstitute.subscriptionStatus,
        },

        admin: {
          id: activatedAdmin._id,
          name: activatedAdmin.name,
          email: activatedAdmin.email,
          role: activatedAdmin.role,
          accountStatus:
            activatedAdmin.accountStatus,
          isActive: activatedAdmin.isActive,
        },

        subscription: {
          id: activatedSubscription._id,
          plan: activatedSubscription.plan,
          subscriptionType:
            activatedSubscription.subscriptionType,
          amount: activatedSubscription.amount,
          currency: activatedSubscription.currency,
          durationDays:
            activatedSubscription.durationDays,
          status: activatedSubscription.status,
          startDate: activatedSubscription.startDate,
          endDate: activatedSubscription.endDate,
        },

        payment: verifiedPayment
          ? {
              id: verifiedPayment._id,
              amount: verifiedPayment.amount,
              currency: verifiedPayment.currency,
              method: verifiedPayment.method,
              status: verifiedPayment.status,
              verifiedBy: verifiedPayment.verifiedBy,
              verifiedAt: verifiedPayment.verifiedAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Approve Institute Error:", error);

    const statusCode =
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 500
          ? "Failed to approve institute"
          : error.message,
      ...(error.code
        ? { code: error.code }
        : {}),
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  getPendingInstitutes,
  approveInstitute,
};
