const Institute = require("../models/Institute");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const Payment = require("../models/Payment");

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

      const payment = await Payment.findOne({
        instituteId: institute._id,
        paymentType: "INSTITUTE_SUBSCRIPTION",
      })
        .sort({ createdAt: -1 })
        .lean();

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
    console.error(
      "Get Pending Institutes Error:",
      error
    );

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
  try {
    const { instituteId } = req.params;

    // --------------------------------
    // 1. Find Institute
    // --------------------------------

    const institute = await Institute.findById(instituteId);

    if (!institute) {
      return res.status(404).json({
        success: false,
        message: "Institute not found",
      });
    }

    // --------------------------------
    // 2. Prevent duplicate approval
    // --------------------------------

    if (institute.approvalStatus === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Institute is already approved",
      });
    }

    // --------------------------------
    // 3. Find Admin
    // --------------------------------

    const admin = await User.findOne({
      instituteId: institute._id,
      role: "INSTITUTE_ADMIN",
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Institute Admin not found",
      });
    }

    // --------------------------------
    // 4. Find Subscription
    // --------------------------------

    const subscription = await Subscription.findOne({
      instituteId: institute._id,
      status: "PENDING",
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Pending subscription not found",
      });
    }

    // --------------------------------
    // 5. Find Payment
    // --------------------------------

    const payment = await Payment.findOne({
      instituteId: institute._id,
      subscriptionId: subscription._id,
      paymentType: "INSTITUTE_SUBSCRIPTION",
      status: "PENDING",
    }).sort({ createdAt: -1 });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Pending payment not found",
      });
    }

    // --------------------------------
    // 6. Verify Payment
    // --------------------------------

    payment.status = "VERIFIED";
    payment.verifiedBy = req.user._id;
    payment.verifiedAt = new Date();

    await payment.save();

    // --------------------------------
    // 7. Activate Subscription
    // --------------------------------

    const startDate = new Date();

    const endDate = new Date(startDate);

    // Current subscription duration:
    // 30 days
    endDate.setDate(endDate.getDate() + 30);

    subscription.status = "ACTIVE";
    subscription.startDate = startDate;
    subscription.endDate = endDate;

    await subscription.save();

    // --------------------------------
    // 8. Approve Institute
    // --------------------------------

    institute.approvalStatus = "APPROVED";
    institute.isActive = true;
    institute.subscriptionStatus = "ACTIVE";

    await institute.save();

    // --------------------------------
    // 9. Activate Institute Admin
    // --------------------------------

    admin.accountStatus = "ACTIVE";
    admin.isActive = true;

    await admin.save();

    // --------------------------------
    // 10. Success response
    // --------------------------------

    return res.status(200).json({
      success: true,
      message:
        "Institute approved and activated successfully",

      data: {
        institute: {
          id: institute._id,
          name: institute.name,
          code: institute.code,
          approvalStatus: institute.approvalStatus,
          isActive: institute.isActive,
          subscriptionStatus:
            institute.subscriptionStatus,
        },

        admin: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          accountStatus: admin.accountStatus,
          isActive: admin.isActive,
        },

        subscription: {
          id: subscription._id,
          plan: subscription.plan,
          amount: subscription.amount,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },

        payment: {
          id: payment._id,
          amount: payment.amount,
          method: payment.method,
          status: payment.status,
          verifiedBy: payment.verifiedBy,
          verifiedAt: payment.verifiedAt,
        },
      },
    });
  } catch (error) {
    console.error(
      "Approve Institute Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to approve institute",
    });
  }
};

module.exports = {
  getPendingInstitutes,
  approveInstitute,
};