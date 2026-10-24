
const mongoose = require("mongoose");

const { Schema } = mongoose;

const AUDIT_EVENT_TYPES = [
  "TRIAL_OFFER_CREATED",
  "TRIAL_OFFER_UPDATED",
  "TRIAL_OFFER_PUBLISHED",
  "TRIAL_OFFER_ENABLED",
  "TRIAL_OFFER_DISABLED",
  "TRIAL_OFFER_RETIRED",
];

const PlatformTrialOfferAuditSchema = new Schema(
  {
    entityType: {
      type: String,
      enum: ["PLATFORM_TRIAL_OFFER"],
      required: true,
      immutable: true,
      default: "PLATFORM_TRIAL_OFFER",
    },

    offerId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformTrialOffer",
      required: true,
      immutable: true,
      index: true,
    },

    offerVersion: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },

    eventType: {
      type: String,
      enum: AUDIT_EVENT_TYPES,
      required: true,
      immutable: true,
      index: true,
    },

    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    occurredAt: {
      type: Date,
      required: true,
      immutable: true,
      default: Date.now,
    },

    changes: {
      type: Schema.Types.Mixed,
      default: undefined,
      immutable: true,
    },

    snapshot: {
      type: Schema.Types.Mixed,
      default: undefined,
      immutable: true,
    },
  },
  {
    timestamps: false,
    strict: "throw",
    versionKey: false,
  }
);

// Query-based updates are not permitted for audit records.
PlatformTrialOfferAuditSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
  ],
  function () {
    throw new Error(
      "Audit records are append-only and cannot be updated"
    );
  }
);

// Audit records cannot be deleted through Mongoose model operations.
PlatformTrialOfferAuditSchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete"],
  function () {
    throw new Error("Audit records cannot be deleted");
  }
);

PlatformTrialOfferAuditSchema.pre("remove", function () {
  throw new Error("Audit records cannot be deleted");
});

// Only a new audit document may be saved.
PlatformTrialOfferAuditSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error("Existing audit records cannot be modified");
  }
});

// Block bulk mutations and alternative Mongoose insertion paths.
// The audit service will use new AuditDocument().save({ session }).
PlatformTrialOfferAuditSchema.pre("insertMany", function () {
  throw new Error(
    "Use the audit service to append audit records"
  );
});

PlatformTrialOfferAuditSchema.pre("bulkWrite", function () {
  throw new Error("bulkWrite is disabled for audit records");
});

const PlatformTrialOfferAudit =
  mongoose.models.PlatformTrialOfferAudit ||
  mongoose.model(
    "PlatformTrialOfferAudit",
    PlatformTrialOfferAuditSchema
  );

PlatformTrialOfferAudit.insertOne = async function () {
  throw new Error(
    "insertOne is disabled; use the audit service"
  );
};

module.exports = PlatformTrialOfferAudit;
