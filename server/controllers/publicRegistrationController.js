// const Institute = require("../models/Institute");
// const User = require("../models/User");
// const Subscription = require("../models/Subscription");
// const Payment = require("../models/Payment");
// const { hashPassword } = require("../services/authService");

// const {
//   getPublishedSubscriptionPlan,
// } = require("../services/publishedSubscriptionPlanService");

// const registerInstitute = async (req, res) => {
//   try {
//     const {
//       instituteName,
//       instituteCode,
//       instituteEmail,
//       institutePhone,
//       address,

//       adminName,
//       adminEmail,
//       adminPhone,
//       password,

//       plan,
//     } = req.body;

//     // --------------------------------
//     // 1. Required fields validation
//     // --------------------------------

//     if (
//       !instituteName ||
//       !instituteCode ||
//       !adminName ||
//       !adminEmail ||
//       !password ||
//       !plan
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Required fields are missing",
//       });
//     }

//     // --------------------------------
//     // 2. Normalize data
//     // --------------------------------

//     const normalizedInstituteCode = instituteCode
//       .trim()
//       .toUpperCase();

//     const normalizedAdminEmail = adminEmail
//       .trim()
//       .toLowerCase();

//     // --------------------------------
//     // 3. Validate subscription plan
//     // --------------------------------

//     // --------------------------------
//     // 3. Load the currently published plan version
//     // --------------------------------

//     let publishedPlan;
//     let planVersion;

//     try {
//       const result = await getPublishedSubscriptionPlan(plan);

//       publishedPlan = result.plan;
//       planVersion = result.version;
//     } catch (error) {
//       if (error.code) {
//         return res.status(error.status || 400).json({
//           success: false,
//           code: error.code,
//           message: error.message,
//         });
//       }

//       throw error;
//     }

//     const normalizedPlanCode = publishedPlan.code;
//     const amount = planVersion.amount;
//     const currency = planVersion.currency;

//     // --------------------------------
//     // 4. Check duplicate institute code
//     // --------------------------------

//     const existingInstitute = await Institute.findOne({
//       code: normalizedInstituteCode,
//     });

//     if (existingInstitute) {
//       return res.status(409).json({
//         success: false,
//         message: "Institute code already exists",
//       });
//     }

//     // --------------------------------
//     // 5. Check duplicate admin email
//     // --------------------------------

//     const existingUser = await User.findOne({
//       email: normalizedAdminEmail,
//     });

//     if (existingUser) {
//       return res.status(409).json({
//         success: false,
//         message: "Admin email already exists",
//       });
//     }

//     // --------------------------------
//     // 7. Create Institute
//     // --------------------------------

//     const institute = await Institute.create({
//       name: instituteName.trim(),
//       code: normalizedInstituteCode,
//       email: instituteEmail
//         ? instituteEmail.trim().toLowerCase()
//         : null,
//       phone: institutePhone
//         ? institutePhone.trim()
//         : null,
//       address: address
//         ? address.trim()
//         : null,

//       approvalStatus: "PENDING",
//       isActive: false,

//       subscriptionStatus: "PENDING",
//       subscriptionPlan: normalizedPlanCode,
//     });

//     // --------------------------------
//     // 8. Hash admin password
//     // --------------------------------

//     const hashedPassword = await hashPassword(password);

//     // --------------------------------
//     // 9. Create Institute Admin
//     // --------------------------------

//     let adminUser;

//     try {
//       adminUser = await User.create({
//         instituteId: institute._id,

//         name: adminName.trim(),
//         email: normalizedAdminEmail,

//         phone: adminPhone
//           ? adminPhone.trim()
//           : null,

//         password: hashedPassword,

//         role: "INSTITUTE_ADMIN",

//         accountStatus: "PENDING",
//         isActive: false,
//       });
//     } catch (error) {
//       // Rollback institute if admin creation fails
//       await Institute.findByIdAndDelete(institute._id);

//       throw error;
//     }

//     // --------------------------------
//     // 10. Create Subscription
//     // --------------------------------

//     let subscription;

//     try {
//       subscription = await Subscription.create({
//         instituteId: institute._id,
//         subscriptionType: "STANDARD",
//         plan: normalizedPlanCode,
//         planVersion: planVersion.version,
//         planVersionId: planVersion._id,
//         amount,
//         currency,
//         paymentRequired: planVersion.paymentRequired,
//         durationDays: planVersion.durationDays,

//         features: (planVersion.features || []).map(
//           ({ key, enabled }) => ({
//             key,
//             enabled,
//           })
//         ),

//         limits: (planVersion.limits || []).map(
//           ({ key, value }) => ({
//             key,
//             value,
//           })
//         ),

//         status: "PENDING",
//         autoRenew: false,
//       });
//     } catch (error) {
//       await User.findByIdAndDelete(adminUser._id);
//       await Institute.findByIdAndDelete(institute._id);

//       throw error;
//     }

//     // --------------------------------
//     // 11. Create Payment Request
//     // --------------------------------

//     // --------------------------------
//     // 11. Create Payment Request (paid plans only)
//     // --------------------------------

//     let payment = null;

//     if (planVersion.paymentRequired === true) {
//       try {
//         payment = await Payment.create({
//           instituteId: institute._id,
//           subscriptionId: subscription._id,
//           paymentType: "INSTITUTE_SUBSCRIPTION",
//           amount,
//           currency,
//           method: "MANUAL_UPI",
//           gateway: "NONE",
//           status: "PENDING",
//         });
//       } catch (error) {
//         await Subscription.findByIdAndDelete(subscription._id);
//         await User.findByIdAndDelete(adminUser._id);
//         await Institute.findByIdAndDelete(institute._id);

//         throw error;
//       }
//     }

//     // --------------------------------
//     // 12. Success response
//     // --------------------------------

//     return res.status(201).json({
//       success: true,

//       message: planVersion.paymentRequired
//         ? "Institute registration submitted successfully. Awaiting payment verification and Super Admin approval."
//         : "Institute registration submitted successfully. Awaiting Super Admin approval.",

//       data: {
//         institute: {
//           id: institute._id,
//           name: institute.name,
//           code: institute.code,
//           approvalStatus: institute.approvalStatus,
//         },

//         admin: {
//           id: adminUser._id,
//           name: adminUser.name,
//           email: adminUser.email,
//           role: adminUser.role,
//           accountStatus: adminUser.accountStatus,
//         },

//         subscription: {
//           id: subscription._id,
//           plan: subscription.plan,
//           amount: subscription.amount,
//           currency: subscription.currency,
//           status: subscription.status,
//         },

//         payment: payment
//           ? {
//               id: payment._id,
//               amount: payment.amount,
//               currency: payment.currency,
//               method: payment.method,
//               status: payment.status,
//             }
//           : null,
//       },
//     });
//   } catch (error) {
//     console.error(
//       "Institute Registration Error:",
//       error
//     );

//     return res.status(500).json({
//       success: false,
//       message: "Institute registration failed",
//     });
//   }
// };

// module.exports = {
//   registerInstitute,
// };


const mongoose = require("mongoose");

const Institute = require("../models/Institute");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");
const { hashPassword } = require("../services/authService");

const {
  getPublishedSubscriptionPlan,
} = require("../services/publishedSubscriptionPlanService");

const trialEligibilityService = require(
  "../services/trialEligibilityService"
);

const TRIAL_CONFLICT_CODES = new Set([
  "TRIAL_ALREADY_USED",
  "ACTIVE_SUBSCRIPTION_EXISTS",
  "PENDING_SUBSCRIPTION_EXISTS",
  "SUBSCRIPTION_HISTORY_EXISTS",
]);

const platformTrialSubscriptionService = require(
  "../services/platformTrialSubscriptionService"
);

// 32.16.15.12 — Snapshot builder (unifies STANDARD + TRIAL shape)
const {
  buildSubscriptionSnapshot,
} = require("../services/subscriptionSnapshotBuilder");

function getRegistrationErrorStatus(error) {
  if (TRIAL_CONFLICT_CODES.has(error.code)) {
    return 409;
  }

  if (
    error.code === "INSTITUTE_NOT_FOUND" ||
    error.code === "INVALID_INSTITUTE_ID"
  ) {
    return 400;
  }

  if (error.code === "TRIAL_OFFER_UNAVAILABLE") {
    return 409;
  }

  if (error.code) {
    return error.status || 400;
  }

  return 500;
}

const registerInstitute = async (req, res) => {
  let institute = null;
  let adminUser = null;
  let subscription = null;
  let payment = null;

  try {
    const {
      instituteName,
      instituteCode,
      instituteEmail,
      institutePhone,
      address,
      adminName,
      adminEmail,
      adminPhone,
      password,
      plan,
    } = req.body;

    const subscriptionType = String(
      req.body.subscriptionType || "STANDARD"
    )
      .trim()
      .toUpperCase();

    // 1. Validate required fields.
    if (
      !instituteName ||
      !instituteCode ||
      !adminName ||
      !adminEmail ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    if (!["STANDARD", "TRIAL"].includes(subscriptionType)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SUBSCRIPTION_TYPE",
        message: "Subscription type must be STANDARD or TRIAL",
      });
    }

    if (subscriptionType === "STANDARD" && !plan) {
      return res.status(400).json({
        success: false,
        message: "A subscription plan is required",
      });
    }

    // 2. Normalize data.
    const normalizedInstituteCode = instituteCode
      .trim()
      .toUpperCase();

    const normalizedAdminEmail = adminEmail
      .trim()
      .toLowerCase();

    // 3. Resolve the plan from a trusted server-side source.
    let publishedPlan = null;
    let planVersion = null;
    let trialConfiguration = null;

    if (subscriptionType === "TRIAL") {
      // The client cannot select the trial plan.
      trialConfiguration =
      await trialEligibilityService.getAvailableTrialConfiguration();

      // These are verified snapshots from the published offer.
      publishedPlan = {
        _id: trialConfiguration.plan.planId,
        code: trialConfiguration.plan.code,
      };

      planVersion = {
        _id: trialConfiguration.planVersion.planVersionId,
        version: trialConfiguration.planVersion.version,
        amount: trialConfiguration.planVersion.amount,
        currency: trialConfiguration.planVersion.currency,
        paymentRequired:
          trialConfiguration.planVersion.paymentRequired,
        durationDays: trialConfiguration.offer.durationDays,
        features: trialConfiguration.planVersion.features,
        limits: trialConfiguration.planVersion.limits,
      };
    } else {
      const result = await getPublishedSubscriptionPlan(plan);

      publishedPlan = result.plan;
      planVersion = result.version;
    }

    const normalizedPlanCode = publishedPlan.code;
    const amount = planVersion.amount;
    const currency = planVersion.currency;

    // 4. Check duplicate Institute code.
    const existingInstitute = await Institute.findOne({
      code: normalizedInstituteCode,
    });

    if (existingInstitute) {
      return res.status(409).json({
        success: false,
        code: "INSTITUTE_CODE_ALREADY_EXISTS",
        message: "Institute code already exists",
      });
    }

    // 5. Check duplicate admin email.
    const existingUser = await User.findOne({
      email: normalizedAdminEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        code: "ADMIN_EMAIL_ALREADY_EXISTS",
        message: "Admin email already exists",
      });
    }

    // Hash before creating database records to avoid leaving
    // an Institute behind if password hashing fails.
    const hashedPassword = await hashPassword(password);

    // ---------------------------------------------------------
    // 32.16.15.12 — Atomic record creation
    //
    // STANDARD:
    //   Institute + Admin + Subscription + Payment are created
    //   inside a single MongoDB transaction. Any failure rolls
    //   back atomically. A process crash mid-flow cannot leave
    //   orphan records behind.
    //
    // TRIAL:
    //   Unchanged. platformTrialSubscriptionService manages its
    //   own transaction for subscription + lifetime claim.
    //   Institute + Admin still use compensating deletes
    //   (TRIAL transaction isolation improvement is deferred).
    //
    // Duplicate checks above (existingInstitute, existingUser)
    // remain as UX fast-paths; the DB unique indexes enforce
    // race safety inside the transaction.
    // ---------------------------------------------------------

    if (subscriptionType === "TRIAL") {
      // ========== TRIAL branch — unchanged flow ==========

      try {
        institute = await Institute.create({
          name: instituteName.trim(),
          code: normalizedInstituteCode,
          email: instituteEmail
            ? instituteEmail.trim().toLowerCase()
            : null,
          phone: institutePhone ? institutePhone.trim() : null,
          address: address ? address.trim() : null,
          approvalStatus: "PENDING",
          isActive: false,
          subscriptionStatus: "PENDING",
          subscriptionPlan: normalizedPlanCode,
        });
      } catch (error) {
        throw error;
      }

      try {
        adminUser = await User.create({
          instituteId: institute._id,
          name: adminName.trim(),
          email: normalizedAdminEmail,
          phone: adminPhone ? adminPhone.trim() : null,
          password: hashedPassword,
          role: "INSTITUTE_ADMIN",
          accountStatus: "PENDING",
          isActive: false,
        });
      } catch (error) {
        await Institute.findByIdAndDelete(institute._id);
        institute = null;
        throw error;
      }

      try {
        subscription = (
          await platformTrialSubscriptionService.createPlatformTrialSubscription(
            {
              instituteId: institute._id,
            }
          )
        ).subscription;
      } catch (error) {
        await User.findByIdAndDelete(adminUser._id);
        adminUser = null;
        await Institute.findByIdAndDelete(institute._id);
        institute = null;
        throw error;
      }

      payment = null;
    } else {
      // ========== STANDARD branch — atomic transaction ==========

      const session = await mongoose.startSession();

      let createdInstitute = null;
      let createdAdmin = null;
      let createdSubscription = null;
      let createdPayment = null;

      try {
        await session.withTransaction(async () => {
          [createdInstitute] = await Institute.create(
            [
              {
                name: instituteName.trim(),
                code: normalizedInstituteCode,
                email: instituteEmail
                  ? instituteEmail.trim().toLowerCase()
                  : null,
                phone: institutePhone ? institutePhone.trim() : null,
                address: address ? address.trim() : null,
                approvalStatus: "PENDING",
                isActive: false,
                subscriptionStatus: "PENDING",
                subscriptionPlan: normalizedPlanCode,
              },
            ],
            { session }
          );

          [createdAdmin] = await User.create(
            [
              {
                instituteId: createdInstitute._id,
                name: adminName.trim(),
                email: normalizedAdminEmail,
                phone: adminPhone ? adminPhone.trim() : null,
                password: hashedPassword,
                role: "INSTITUTE_ADMIN",
                accountStatus: "PENDING",
                isActive: false,
              },
            ],
            { session }
          );

          const snapshot = buildSubscriptionSnapshot(
            planVersion,
            normalizedPlanCode
          );

          [createdSubscription] = await Subscription.create(
            [
              {
                ...snapshot,
                instituteId: createdInstitute._id,
                subscriptionType: "STANDARD",
                status: "PENDING",
                autoRenew: false,
              },
            ],
            { session }
          );

          createdPayment = null;

          if (planVersion.paymentRequired === true) {
            [createdPayment] = await Payment.create(
              [
                {
                  instituteId: createdInstitute._id,
                  subscriptionId: createdSubscription._id,
                  paymentType: "INSTITUTE_SUBSCRIPTION",
                  amount,
                  currency,
                  method: "MANUAL_UPI",
                  gateway: "NONE",
                  status: "PENDING",
                },
              ],
              { session }
            );
          }
        });

        // Transaction committed. Expose refs to the response.
        institute = createdInstitute;
        adminUser = createdAdmin;
        subscription = createdSubscription;
        payment = createdPayment;
      } catch (error) {
        // Transaction rolled back automatically by MongoDB.
        // Reset refs so the outer catch handler never sees
        // half-created state.
        institute = null;
        adminUser = null;
        subscription = null;
        payment = null;
        throw error;
      } finally {
        await session.endSession();
      }
    }

    // 10. Success response.
    let message;

    if (subscriptionType === "TRIAL") {
      message =
        "Institute registration submitted successfully. The trial is pending Super Admin approval.";
    } else if (planVersion.paymentRequired === true) {
      message =
        "Institute registration submitted successfully. Awaiting payment verification and Super Admin approval.";
    } else {
      message =
        "Institute registration submitted successfully. Awaiting Super Admin approval.";
    }

    return res.status(201).json({
      success: true,
      message,

      data: {
        institute: {
          id: institute._id,
          name: institute.name,
          code: institute.code,
          approvalStatus: institute.approvalStatus,
        },

        admin: {
          id: adminUser._id,
          name: adminUser.name,
          email: adminUser.email,
          role: adminUser.role,
          accountStatus: adminUser.accountStatus,
        },

        subscription: {
          id: subscription._id,
          subscriptionType: subscription.subscriptionType,
          plan: subscription.plan,
          planVersion: subscription.planVersion,
          amount: subscription.amount,
          currency: subscription.currency,
          paymentRequired: subscription.paymentRequired,
          durationDays: subscription.durationDays,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,

          ...(subscriptionType === "TRIAL"
            ? {
                trialSource: subscription.trialSource,
                platformTrialOfferId:
                  subscription.platformTrialOfferId,
                platformTrialOfferVersion:
                  subscription.platformTrialOfferVersion,
              }
            : {}),
        },

        payment: payment
          ? {
              id: payment._id,
              amount: payment.amount,
              currency: payment.currency,
              method: payment.method,
              status: payment.status,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Institute Registration Error:", error);

    const status = getRegistrationErrorStatus(error);

    return res.status(status).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      message:
        status === 500
          ? "Institute registration failed"
          : error.message,
    });
  }
};

module.exports = {
  registerInstitute,
};
