// const mongoose = require("mongoose");

// const instituteSchema = new mongoose.Schema(
//   {
//     name: {
//       type: String,
//       required: [true, "Institute name is required"],
//       trim: true,
//       minlength: [2, "Institute name must be at least 2 characters"],
//       maxlength: [150, "Institute name cannot exceed 150 characters"],
//     },

//     code: {
//       type: String,
//       required: [true, "Institute code is required"],
//       unique: true,
//       uppercase: true,
//       trim: true,
//       minlength: [3, "Institute code must be at least 3 characters"],
//       maxlength: [30, "Institute code cannot exceed 30 characters"],
//     },

//     email: {
//       type: String,
//       trim: true,
//       lowercase: true,
//       default: null,
//     },

//     phone: {
//       type: String,
//       trim: true,
//       default: null,
//     },

//     address: {
//       type: String,
//       trim: true,
//       maxlength: [500, "Address cannot exceed 500 characters"],
//       default: null,
//     },

//     logo: {
//       type: String,
//       default: null,
//     },

//     customDomain: {
//       type: String,
//       trim: true,
//       lowercase: true,
//       default: null,
//     },

//     isActive: {
//       type: Boolean,
//       default: true,
//     },

//     subscriptionStatus: {
//       type: String,
//       enum: [
//         "TRIAL",
//         "ACTIVE",
//         "SUSPENDED",
//         "EXPIRED",
//         "CANCELLED",
//       ],
//       default: "TRIAL",
//     },

//     subscriptionPlan: {
//       type: String,
//       enum: [
//         "FREE",
//         "BASIC",
//         "PRO",
//         "ENTERPRISE",
//       ],
//       default: "FREE",
//     },

//     trialEndsAt: {
//       type: Date,
//       default: null,
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// const Institute = mongoose.model("Institute", instituteSchema);

// module.exports = Institute;



const mongoose = require("mongoose");

const instituteSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Institute name is required"],
      trim: true,
      minlength: [2, "Institute name must be at least 2 characters"],
      maxlength: [150, "Institute name cannot exceed 150 characters"],
    },

    code: {
      type: String,
      required: [true, "Institute code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [3, "Institute code must be at least 3 characters"],
      maxlength: [30, "Institute code cannot exceed 30 characters"],
    },

    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
 //     index: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },

    phone: {
      type: String,
      trim: true,
      default: null,
    },

    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
      default: null,
    },

    logo: {
      type: String,
      default: null,
    },

    customDomain: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },

    // Institute registration approval
    approvalStatus: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "SUSPENDED",
      ],
      default: "PENDING",
    },

    isActive: {
      type: Boolean,
      default: false,
    },

    // Subscription status
    subscriptionStatus: {
      type: String,
      enum: [
        "PENDING",
        "TRIAL",
        "ACTIVE",
        "SUSPENDED",
        "EXPIRED",
        "CANCELLED",
      ],
      default: "PENDING",
    },

    subscriptionPlan: {
      type: String,
      enum: [
        "FREE",
        "BASIC",
        "PRO",
        "ENTERPRISE",
      ],
      default: "FREE",
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);


instituteSchema.index(
  { ownerId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      ownerId: { $type: "objectId" },
    },
  }
);


const Institute = mongoose.model("Institute", instituteSchema);

module.exports = Institute;