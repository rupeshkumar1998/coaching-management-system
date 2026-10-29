
const mongoose = require("mongoose");

const { Schema } = mongoose;

const TRIAL_CLAIM_SOURCES = [
  "PLATFORM_OFFER",
  "MANUAL_GRANT",
];

const TrialEligibilityClaimSchema = new Schema(
  {
    // One permanent claim per Institute.
    instituteId: {
      type: Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      immutable: true,
    },

    // The subscription created for this trial.
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      immutable: true,
    },

    source: {
      type: String,
      enum: TRIAL_CLAIM_SOURCES,
      required: true,
      immutable: true,
    },

    // The exact published platform offer used.
    // These fields are null for a manual grant.
    platformTrialOfferId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformTrialOffer",
      default: null,
      immutable: true,
      required() {
        return this.source === "PLATFORM_OFFER";
      },
    },

    platformTrialOfferVersion: {
      type: Number,
      default: null,
      min: 1,
      immutable: true,
      validate: {
        validator(value) {
          return (
            value === null ||
            (
              Number.isSafeInteger(value) &&
              value >= 1
            )
          );
        },
        message:
          "Offer version must be a positive safe integer or null",
      },
      required() {
        return this.source === "PLATFORM_OFFER";
      },
    },

    // Snapshot of the exact plan version granted.
    planId: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
      immutable: true,
    },

    planVersionId: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlanVersion",
      required: true,
      immutable: true,
    },

    planVersion: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value);
        },
        message: "Plan version must be a positive safe integer",
      },
    },

    // PLATFORM_OFFER: null
    // MANUAL_GRANT: authorized Super Admin's User ID
    trialGrantedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      immutable: true,
      required() {
        return this.source === "MANUAL_GRANT";
      },
    },

    // A manual grant must explain why it was issued.
    trialReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: 1000,
      immutable: true,
      required() {
        return this.source === "MANUAL_GRANT";
      },
      validate: {
        validator(value) {
          if (this.source !== "MANUAL_GRANT") {
            return value === null || value === undefined;
          }

          return (
            typeof value === "string" &&
            value.trim().length >= 10
          );
        },
        message:
          "Manual trial grants require a reason of at least 10 characters",
      },
    },

    claimedAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    versionKey: "__v",
  }
);

// A lifetime claim must never be duplicated for an Institute.
TrialEligibilityClaimSchema.index(
  { instituteId: 1 },
  {
    unique: true,
    name: "unique_lifetime_trial_claim_per_institute",
  }
);

// A subscription must not be linked to multiple claims.
TrialEligibilityClaimSchema.index(
  { subscriptionId: 1 },
  {
    unique: true,
    name: "unique_trial_claim_per_subscription",
  }
);

// Claims are append-only. Existing claims cannot be saved again.
TrialEligibilityClaimSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(
      "Trial eligibility claims are immutable and cannot be updated"
    );
  }
});

// Prevent query-based mutation and deletion.
const blockedQueryOperations = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
];

for (const operation of blockedQueryOperations) {
  TrialEligibilityClaimSchema.pre(
    operation,
    function () {
      throw new Error(
        "Trial eligibility claims cannot be updated or deleted"
      );
    }
  );
}

const TrialEligibilityClaim =
  mongoose.models.TrialEligibilityClaim ||
  mongoose.model(
    "TrialEligibilityClaim",
    TrialEligibilityClaimSchema
  );

module.exports = TrialEligibilityClaim;
