
const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema(
  {
    // Stable identity of the plan.
    // Example: FREE, BASIC, PRO, ENTERPRISE.
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      immutable: true,
      match: [
        /^[A-Z][A-Z0-9_]{1,49}$/,
        "Plan code must be a valid uppercase code",
      ],
    },

    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    // Controls whether this plan can be offered for
    // new subscriptions. Existing subscriptions are
    // not automatically cancelled when a plan is disabled.
    isActive: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },

    // Points to the current published configuration.
    // SubscriptionPlanVersion will be implemented
    // separately in Step 32.16.15.5.
    currentPublishedVersion: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlanVersion",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    //versionKey: true,
  }
);

// Each logical plan must have a unique code.
subscriptionPlanSchema.index(
  { code: 1 },
  {
    unique: true,
    name: "unique_subscription_plan_code",
  }
);

// Common admin listing query.
subscriptionPlanSchema.index({
  isActive: 1,
  name: 1,
});

// Export the model.
const SubscriptionPlan =
  mongoose.models.SubscriptionPlan ||
  mongoose.model(
    "SubscriptionPlan",
    subscriptionPlanSchema
  );

module.exports = SubscriptionPlan;