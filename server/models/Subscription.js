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
        // ---------------------------------------------------------
    // Trial Source and Platform Offer Snapshot
    // ---------------------------------------------------------
    trialSource: {
      type: String,
      enum: ["PLATFORM_OFFER", "MANUAL_GRANT"],
      default: undefined,
    },

    platformTrialOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformTrialOffer",
      default: null,
      immutable: true,
    },

    platformTrialOfferVersion: {
      type: Number,
      min: 1,
      default: null,
      immutable: true,
    },


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


// -------------------------------------------------------------
// COMMERCIAL SUBSCRIPTION SNAPSHOT PROTECTION
//
// A subscription records the exact commercial configuration
// accepted at creation. Later plan publications must not alter
// existing or historical subscription snapshots.
//
// This is Mongoose application-layer protection. Direct native
// collection / database-admin writes remain outside its scope.
// -------------------------------------------------------------

const PROTECTED_SUBSCRIPTION_SNAPSHOT_PATHS = [
  "plan",
  "planVersion",
  "amount",
  "currency",
  "paymentRequired",
  "durationDays",
  "features",
  "limits",
];

function pathsOverlap(firstPath, secondPath) {
  return (
    firstPath === secondPath ||
    firstPath.startsWith(`${secondPath}.`) ||
    secondPath.startsWith(`${firstPath}.`)
  );
}

function isProtectedSnapshotPath(path) {
  return PROTECTED_SUBSCRIPTION_SNAPSHOT_PATHS.some(
    (protectedPath) => pathsOverlap(path, protectedPath)
  );
}

function getModifiedSnapshotPaths(document) {
  return document
    .modifiedPaths()
    .filter(isProtectedSnapshotPath);
}

function createSnapshotProtectionError(paths) {
  const error = new Error(
    "Subscription commercial snapshot is immutable after creation. " +
    `Protected fields: ${paths.join(", ")}`
  );

  error.code = "SUBSCRIPTION_SNAPSHOT_IMMUTABLE";
  return error;
}

// Inspect an ordinary MongoDB update document.
// Supports direct paths and operator-based paths such as:
// $set, $unset, $inc, $rename, $push, $pull, $addToSet, etc.
function collectUpdatedPaths(update, result = []) {
  if (!update || typeof update !== "object") {
    return result;
  }

  if (Array.isArray(update)) {
    throw createSnapshotProtectionError([
      "aggregation update pipeline",
    ]);
  }

  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        for (const updatePath of Object.keys(value)) {
          result.push(updatePath);

          // $rename has both a source and a destination path.
          if (
            key === "$rename" &&
            typeof value[updatePath] === "string"
          ) {
            result.push(value[updatePath]);
          }
        }
      }

      continue;
    }

    // Non-operator update documents use direct field paths.
    result.push(key);
  }

  return result;
}

function assertNoSnapshotUpdate(update) {
  const updatedPaths = collectUpdatedPaths(update);

  const protectedPaths = updatedPaths.filter(
    isProtectedSnapshotPath
  );

  if (protectedPaths.length > 0) {
    throw createSnapshotProtectionError(protectedPaths);
  }
}

// -------------------------------------------------------------
// DOCUMENT SAVE GUARD
//
// New subscriptions are allowed.
// Existing subscriptions cannot change snapshot fields.
// Lifecycle fields remain editable.
// -------------------------------------------------------------

subscriptionSchema.pre("save", function () {
  if (this.isNew) {
    return;
  }

  const modifiedSnapshotPaths =
    getModifiedSnapshotPaths(this);

  if (modifiedSnapshotPaths.length > 0) {
    throw createSnapshotProtectionError(
      modifiedSnapshotPaths
    );
  }
});

// -------------------------------------------------------------
// QUERY UPDATE GUARDS
//
// findByIdAndUpdate uses findOneAndUpdate middleware.
// Lifecycle-only updates remain allowed.
// -------------------------------------------------------------

const guardedQueryOperations = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
];

guardedQueryOperations.forEach((operation) => {
  subscriptionSchema.pre(operation, function () {
    assertNoSnapshotUpdate(this.getUpdate());
  });
});

// -------------------------------------------------------------
// REPLACEMENT GUARDS
//
// Replacement can remove protected fields even when they are
// omitted from the replacement document. Reject replacements.
// -------------------------------------------------------------

subscriptionSchema.pre("replaceOne", function () {
  throw createSnapshotProtectionError([
    "replaceOne",
  ]);
});

subscriptionSchema.pre("findOneAndReplace", function () {
  throw createSnapshotProtectionError([
    "findOneAndReplace",
  ]);
});

// -------------------------------------------------------------
// BULK WRITE GUARD
//
// Check each update operation. Deletion operations remain
// available for registration rollback and test cleanup.
// -------------------------------------------------------------

subscriptionSchema.pre(
  "bulkWrite",
  function (operations) {
    if (!Array.isArray(operations)) {
      throw new Error(
        "Unable to inspect Subscription bulkWrite operations."
      );
    }

    for (const operation of operations) {
      if (operation.updateOne) {
        assertNoSnapshotUpdate(
          operation.updateOne.update
        );
      }

      if (operation.updateMany) {
        assertNoSnapshotUpdate(
          operation.updateMany.update
        );
      }

      if (operation.replaceOne) {
        throw createSnapshotProtectionError([
          "bulkWrite.replaceOne",
        ]);
      }
    }
  }
);


subscriptionSchema.pre("validate", function () {
  if (this.subscriptionType === "TRIAL") {
    if (this.trialSource === "PLATFORM_OFFER") {
      if (!this.platformTrialOfferId) {
        throw new Error(
          "Platform trial requires platformTrialOfferId"
        );
      }

      if (
        !Number.isInteger(this.platformTrialOfferVersion) ||
        this.platformTrialOfferVersion < 1
      ) {
        throw new Error(
          "Platform trial requires a valid offer version"
        );
      }

      if (this.trialGrantedBy) {
        throw new Error(
          "Platform trial cannot have trialGrantedBy"
        );
      }

      if (this.trialReason) {
        throw new Error(
          "Platform trial cannot have a manual trialReason"
        );
      }
    } else if (this.trialSource === "MANUAL_GRANT") {
      if (!this.trialGrantedBy) {
        throw new Error(
          "Manual trial requires trialGrantedBy"
        );
      }

      if (
        typeof this.trialReason !== "string" ||
        this.trialReason.trim().length < 5
      ) {
        throw new Error(
          "Manual trial requires a reason of at least 5 characters"
        );
      }

      if (
        this.platformTrialOfferId ||
        (
          this.platformTrialOfferVersion !== null &&
          this.platformTrialOfferVersion !== undefined
        )
      ) {
        throw new Error(
          "Manual trial cannot have a platform offer snapshot"
        );
      }
    } else if (
      this.trialSource === undefined ||
      this.trialSource === null
    ) {
      // Backward compatibility for historical trials
      // that predate the trialSource field.
      if (!this.trialGrantedBy) {
        throw new Error(
          "Trial subscription requires trialGrantedBy"
        );
      }
    } else {
      throw new Error("Invalid trialSource");
    }

    if (!this.durationDays || this.durationDays < 1) {
      throw new Error(
        "Trial subscription requires durationDays"
      );
    }

    if (this.paymentRequired) {
      throw new Error(
        "Trial subscription cannot require payment"
      );
    }

    if (this.amount !== 0) {
      throw new Error(
        "Trial subscription amount must be 0"
      );
    }
  }

  if (this.plan === "FREE" && this.paymentRequired) {
    throw new Error(
      "FREE subscription cannot require payment"
    );
  }

  if (this.plan === "FREE" && this.amount !== 0) {
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
