const Institute = require("../models/Institute");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");
const { hashPassword } = require("../services/authService");

const {
  getPublishedSubscriptionPlan,
} = require("../services/publishedSubscriptionPlanService");

const registerInstitute = async (req, res) => {
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

    // --------------------------------
    // 1. Required fields validation
    // --------------------------------

    if (
      !instituteName ||
      !instituteCode ||
      !adminName ||
      !adminEmail ||
      !password ||
      !plan
    ) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
      });
    }

    // --------------------------------
    // 2. Normalize data
    // --------------------------------

    const normalizedInstituteCode = instituteCode
      .trim()
      .toUpperCase();

    const normalizedAdminEmail = adminEmail
      .trim()
      .toLowerCase();

    // --------------------------------
    // 3. Validate subscription plan
    // --------------------------------

    // --------------------------------
    // 3. Load the currently published plan version
    // --------------------------------

    let publishedPlan;
    let planVersion;

    try {
      const result = await getPublishedSubscriptionPlan(plan);

      publishedPlan = result.plan;
      planVersion = result.version;
    } catch (error) {
      if (error.code) {
        return res.status(error.status || 400).json({
          success: false,
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }

    const normalizedPlanCode = publishedPlan.code;
    const amount = planVersion.amount;
    const currency = planVersion.currency;

    // --------------------------------
    // 4. Check duplicate institute code
    // --------------------------------

    const existingInstitute = await Institute.findOne({
      code: normalizedInstituteCode,
    });

    if (existingInstitute) {
      return res.status(409).json({
        success: false,
        message: "Institute code already exists",
      });
    }

    // --------------------------------
    // 5. Check duplicate admin email
    // --------------------------------

    const existingUser = await User.findOne({
      email: normalizedAdminEmail,
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Admin email already exists",
      });
    }

    // --------------------------------
    // 7. Create Institute
    // --------------------------------

    const institute = await Institute.create({
      name: instituteName.trim(),
      code: normalizedInstituteCode,
      email: instituteEmail
        ? instituteEmail.trim().toLowerCase()
        : null,
      phone: institutePhone
        ? institutePhone.trim()
        : null,
      address: address
        ? address.trim()
        : null,

      approvalStatus: "PENDING",
      isActive: false,

      subscriptionStatus: "PENDING",
      subscriptionPlan: normalizedPlanCode,
    });

    // --------------------------------
    // 8. Hash admin password
    // --------------------------------

    const hashedPassword = await hashPassword(password);

    // --------------------------------
    // 9. Create Institute Admin
    // --------------------------------

    let adminUser;

    try {
      adminUser = await User.create({
        instituteId: institute._id,

        name: adminName.trim(),
        email: normalizedAdminEmail,

        phone: adminPhone
          ? adminPhone.trim()
          : null,

        password: hashedPassword,

        role: "INSTITUTE_ADMIN",

        accountStatus: "PENDING",
        isActive: false,
      });
    } catch (error) {
      // Rollback institute if admin creation fails
      await Institute.findByIdAndDelete(institute._id);

      throw error;
    }

    // --------------------------------
    // 10. Create Subscription
    // --------------------------------

    let subscription;

    try {
      subscription = await Subscription.create({
        instituteId: institute._id,
        subscriptionType: "STANDARD",
        plan: normalizedPlanCode,
        planVersion: planVersion.version,
        planVersionId: planVersion._id,
        amount,
        currency,
        paymentRequired: planVersion.paymentRequired,
        durationDays: planVersion.durationDays,

        features: (planVersion.features || []).map(
          ({ key, enabled }) => ({
            key,
            enabled,
          })
        ),

        limits: (planVersion.limits || []).map(
          ({ key, value }) => ({
            key,
            value,
          })
        ),

        status: "PENDING",
        autoRenew: false,
      });
    } catch (error) {
      await User.findByIdAndDelete(adminUser._id);
      await Institute.findByIdAndDelete(institute._id);

      throw error;
    }

    // --------------------------------
    // 11. Create Payment Request
    // --------------------------------

    // --------------------------------
    // 11. Create Payment Request (paid plans only)
    // --------------------------------

    let payment = null;

    if (planVersion.paymentRequired === true) {
      try {
        payment = await Payment.create({
          instituteId: institute._id,
          subscriptionId: subscription._id,
          paymentType: "INSTITUTE_SUBSCRIPTION",
          amount,
          currency,
          method: "MANUAL_UPI",
          gateway: "NONE",
          status: "PENDING",
        });
      } catch (error) {
        await Subscription.findByIdAndDelete(subscription._id);
        await User.findByIdAndDelete(adminUser._id);
        await Institute.findByIdAndDelete(institute._id);

        throw error;
      }
    }

    // --------------------------------
    // 12. Success response
    // --------------------------------

    return res.status(201).json({
      success: true,

      message: planVersion.paymentRequired
        ? "Institute registration submitted successfully. Awaiting payment verification and Super Admin approval."
        : "Institute registration submitted successfully. Awaiting Super Admin approval.",

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
          plan: subscription.plan,
          amount: subscription.amount,
          currency: subscription.currency,
          status: subscription.status,
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
    console.error(
      "Institute Registration Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Institute registration failed",
    });
  }
};

module.exports = {
  registerInstitute,
};