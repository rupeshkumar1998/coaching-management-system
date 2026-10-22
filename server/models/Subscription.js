const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    // ---------------------------------------------------------
    // Institute / Tenant
    // ---------------------------------------------------------
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },

    // ---------------------------------------------------------
    // Subscription Type
    // STANDARD = normal paid/free subscription
    // TRIAL    = Super Admin granted temporary trial
    // ---------------------------------------------------------
    subscriptionType: {
      type: String,
      enum: ["STANDARD", "TRIAL"],
      default: "STANDARD",
      required: true,
      index: true,
    },

    // ---------------------------------------------------------
    // Plan
    // ---------------------------------------------------------
    plan: {
      type: String,
      enum: [
        "FREE",
        "BASIC",
        "PRO",
        "ENTERPRISE",
      ],
      required: true,
      index: true,
    },

    // Snapshot of plan configuration version at subscription creation.
    // Existing subscription history must not change when plan pricing
    // or configuration changes later.
    planVersion: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },


        // Exact database configuration version selected for this subscription.
    // Optional for backward compatibility with existing subscriptions.
    planVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlanVersion",
      default: null,
      immutable: true,
    },



    // ---------------------------------------------------------
    // Financial Snapshot
    // ---------------------------------------------------------
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: "INR",
      minlength: 3,
      maxlength: 3,
    },

    // Whether this particular subscription requires payment.
    //
    // Important:
    // FREE  -> false
    // TRIAL -> false
    // BASIC/PRO/ENTERPRISE STANDARD -> true
    //
    // This is stored as a snapshot so future plan configuration
    // changes do not alter historical subscriptions.
    paymentRequired: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Duration snapshot.
    //
    // FREE permanent subscription -> null
    // Trial/paid subscription -> number of days
    durationDays: {
      type: Number,
      min: 1,
      default: null,
    },



        // Entitlement snapshot captured from the selected plan version.
    // Optional for backward compatibility with historical records.
    features: {
      type: [
        {
          _id: false,
          key: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
          },
          enabled: {
            type: Boolean,
            required: true,
          },
        },
      ],
      default: undefined,
    },

    limits: {
      type: [
        {
          _id: false,
          key: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
          },
          value: {
            type: mongoose.Schema.Types.Mixed,
            validate: {
              validator: function (value) {
                return (
                  value === null ||
                  (
                    typeof value === "number" &&
                    Number.isSafeInteger(value) &&
                    value >= 0
                  )
                );
              },
              message:
                "Limit value must be a non-negative safe integer or null",
            },
          },
        },
      ],
      default: undefined,
    },




    // ---------------------------------------------------------
    // Lifecycle Status
    // ---------------------------------------------------------
    status: {
      type: String,
      enum: [
        "PENDING",
        "ACTIVE",
        "SUSPENDED",
        "EXPIRED",
        "CANCELLED",
      ],
      default: "PENDING",
      required: true,
      index: true,
    },

    // ---------------------------------------------------------
    // Subscription Period
    // ---------------------------------------------------------
    startDate: {
      type: Date,
      default: null,
      index: true,
    },

    endDate: {
      type: Date,
      default: null,
      index: true,
    },

    // ---------------------------------------------------------
    // Renewal
    // ---------------------------------------------------------
    autoRenew: {
      type: Boolean,
      default: false,
    },

    // ---------------------------------------------------------
    // Activation Audit
    // ---------------------------------------------------------
    activatedAt: {
      type: Date,
      default: null,
    },

    activatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ---------------------------------------------------------
    // Status Audit
    // ---------------------------------------------------------
    statusReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    statusChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ---------------------------------------------------------
    // Suspension Audit
    // ---------------------------------------------------------
    suspendedAt: {
      type: Date,
      default: null,
    },

    // ---------------------------------------------------------
    // Cancellation Audit
    // ---------------------------------------------------------
    cancelledAt: {
      type: Date,
      default: null,
    },

    // ---------------------------------------------------------
    // Expiration Audit
    // ---------------------------------------------------------
    expiredAt: {
      type: Date,
      default: null,
    },

    // ---------------------------------------------------------
    // Trial Metadata
    // ---------------------------------------------------------
    trialGrantedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    trialReason: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// -------------------------------------------------------------
// Common query indexes
// -------------------------------------------------------------

subscriptionSchema.index({
  instituteId: 1,
  status: 1,
});

subscriptionSchema.index({
  instituteId: 1,
  subscriptionType: 1,
});

subscriptionSchema.index({
  instituteId: 1,
  plan: 1,
});

// -------------------------------------------------------------
// CRITICAL PRODUCTION CONSTRAINT
//
// An institute can have many historical subscriptions,
// but only ONE subscription can be ACTIVE at a time.
//
// This is a database-level protection against race conditions.
// -------------------------------------------------------------

subscriptionSchema.index(
  { instituteId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "ACTIVE",
    },
    name: "unique_active_subscription_per_institute",
  }
);




subscriptionSchema.pre("validate", function () {
  if (
    this.subscriptionType === "TRIAL" &&
    !this.trialGrantedBy
  ) {
    throw new Error(
      "Trial subscription requires trialGrantedBy"
    );
  }

  if (
    this.subscriptionType === "TRIAL" &&
    (!this.durationDays || this.durationDays < 1)
  ) {
    throw new Error(
      "Trial subscription requires durationDays"
    );
  }

  if (
    this.subscriptionType === "TRIAL" &&
    this.paymentRequired
  ) {
    throw new Error(
      "Trial subscription cannot require payment"
    );
  }

  if (
    this.subscriptionType === "TRIAL" &&
    this.amount !== 0
  ) {
    throw new Error(
      "Trial subscription amount must be 0"
    );
  }

  if (
    this.plan === "FREE" &&
    this.paymentRequired
  ) {
    throw new Error(
      "FREE subscription cannot require payment"
    );
  }

  if (
    this.plan === "FREE" &&
    this.amount !== 0
  ) {
    throw new Error(
      "FREE subscription amount must be 0"
    );
  }

  if (
    this.durationDays !== null &&
    this.durationDays !== undefined &&
    this.durationDays < 1
  ) {
    throw new Error(
      "Subscription duration must be at least 1 day"
    );
  }

  if (
    this.startDate &&
    this.endDate &&
    this.endDate <= this.startDate
  ) {
    throw new Error(
      "Subscription endDate must be after startDate"
    );
  }
});

const Subscription = mongoose.model(
  "Subscription",
  subscriptionSchema
);

module.exports = Subscription;
