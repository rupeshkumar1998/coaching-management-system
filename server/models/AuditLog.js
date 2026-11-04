const mongoose = require("mongoose");

// All allowed audit actions.
const AUDIT_ACTIONS = [
  "PLAN_CREATED",
  "PLAN_DRAFT_CREATED",
  "PLAN_PRICE_CHANGED",
  "PLAN_DURATION_CHANGED",
  "PLAN_FEATURE_CHANGED",
  "PLAN_LIMIT_CHANGED",
  "PLAN_VERSION_PUBLISHED",
  "PLAN_VERSION_RETIRED",
  "PLAN_DISABLED",
  "PLAN_ENABLED",
];

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      index: true,
    },

    action: {
      type: String,
      enum: AUDIT_ACTIONS,
      required: true,
      immutable: true,
      index: true,
    },

    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
      immutable: true,
      index: true,
    },

    planVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlanVersion",
      default: null,
      immutable: true,
    },

    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },

    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      immutable: true,
    },

    reason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
      immutable: true,
    },
  },
  {
    // Only a single creation timestamp; no updatedAt because
    // audit records are immutable.
    timestamps: { createdAt: "timestamp", updatedAt: false },
    strict: "throw",
  }
);

// Common admin listing queries.
auditLogSchema.index({ planId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ actor: 1, timestamp: -1 });

// ---------------------------------------------------------------
// AUDIT LOG IMMUTABILITY
//
// Audit records are append-only. They cannot be updated or
// deleted through any Mongoose write path.
// ---------------------------------------------------------------

const rejectAuditLogMutation = function () {
  throw new Error(
    "Audit logs are immutable and cannot be modified"
  );
};

// Document-level save guard: only allow first-time insert.
auditLogSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error(
      "Audit logs are immutable and cannot be modified"
    );
  }
});

// Block all query-based write paths.
auditLogSchema.pre("updateOne", rejectAuditLogMutation);
auditLogSchema.pre("updateMany", rejectAuditLogMutation);
auditLogSchema.pre("findOneAndUpdate", rejectAuditLogMutation);
auditLogSchema.pre("replaceOne", rejectAuditLogMutation);
auditLogSchema.pre("findOneAndReplace", rejectAuditLogMutation);
auditLogSchema.pre(
  "deleteOne",
  { query: true, document: false },
  rejectAuditLogMutation
);
auditLogSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectAuditLogMutation
);
auditLogSchema.pre("deleteMany", rejectAuditLogMutation);
auditLogSchema.pre("findOneAndDelete", rejectAuditLogMutation);
auditLogSchema.pre("bulkWrite", rejectAuditLogMutation);
auditLogSchema.pre("insertMany", rejectAuditLogMutation);

const AuditLog =
  mongoose.models.AuditLog ||
  mongoose.model("AuditLog", auditLogSchema);

module.exports = {
  AuditLog,
  AUDIT_ACTIONS,
};