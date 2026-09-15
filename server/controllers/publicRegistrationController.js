const Institute = require("../models/Institute");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");

const { hashPassword } = require("../services/authService");

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

    const allowedPlans = [
      "FREE",
      "BASIC",
      "PRO",
      "ENTERPRISE",
    ];

    if (!allowedPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan",
      });
    }

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
    // 6. Determine subscription amount
    // --------------------------------
    // IMPORTANT:
    // Client amount is NEVER trusted.

    const planPrices = {
      FREE: 0,
      BASIC: 999,
      PRO: 1999,
      ENTERPRISE: 4999,
    };

    const amount = planPrices[plan];

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
      subscriptionPlan: plan,
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

        plan,

        amount,

        currency: "INR",

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

    let payment;

    try {
      payment = await Payment.create({
        instituteId: institute._id,

        subscriptionId: subscription._id,

        paymentType: "INSTITUTE_SUBSCRIPTION",

        amount,

        currency: "INR",

        // Initial system:
        // Manual payment
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

    // --------------------------------
    // 12. Success response
    // --------------------------------

    return res.status(201).json({
      success: true,

      message:
        "Institute registration submitted successfully. Awaiting payment verification and Super Admin approval.",

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

        payment: {
          id: payment._id,
          amount: payment.amount,
          currency: payment.currency,
          method: payment.method,
          status: payment.status,
        },
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