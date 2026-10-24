
const mongoose = require("mongoose");

const { Schema } = mongoose;

const TRIAL_OFFER_STATUSES = ["DRAFT", "PUBLISHED", "RETIRED"];

const TRIAL_ELIGIBILITY_POLICIES = ["NEW_INSTITUTES_ONLY"];

const PlatformTrialOfferSchema = new Schema(
  {
    version: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },

    status: {
      type: String,
      enum: TRIAL_OFFER_STATUSES,
      default: "DRAFT",
      required: true,
      index: true,
    },

    enabled: {
      type: Boolean,
      default: false,
      required: true,
    },

    planId: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
      //immutable: true,
      index: true,
    },

    planVersionId: {
      type: Schema.Types.ObjectId,
      ref: "SubscriptionPlanVersion",
      required: true,
     // immutable: true,
      index: true,
    },

    durationDays: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value);
        },
        message: "durationDays must be a positive safe integer",
      },
    },

    eligibility: {
      type: String,
      enum: TRIAL_ELIGIBILITY_POLICIES,
      required: true,
      default: "NEW_INSTITUTES_ONLY",
    },

    publishedAt: {
      type: Date,
      default: null,
    },

    publishedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    retiredAt: {
      type: Date,
      default: null,
    },

    retiredBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
    strict: "throw",
    versionKey: "__v",
  }
);

// Offer versions must be unique.
PlatformTrialOfferSchema.index(
  { version: 1 },
  { unique: true, name: "unique_platform_trial_offer_version" }
);

// Only one global offer may be PUBLISHED at a time.
PlatformTrialOfferSchema.index(
  { status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "PUBLISHED" },
    name: "one_published_platform_trial_offer",
  }
);

// A new offer version must begin as a disabled draft.
PlatformTrialOfferSchema.pre("validate", function () {
  if (this.isNew) {
    if (this.status !== "DRAFT") {
      throw new Error("A new platform trial offer must start as DRAFT");
    }

    if (this.enabled !== false) {
      throw new Error("A new platform trial offer must start disabled");
    }
  }

  if (this.status === "DRAFT") {
    if (this.enabled !== false) {
      throw new Error("A DRAFT platform trial offer cannot be enabled");
    }

    if (this.publishedAt || this.publishedBy) {
      throw new Error("A DRAFT offer cannot have publication metadata");
    }

    if (this.retiredAt || this.retiredBy) {
      throw new Error("A DRAFT offer cannot have retirement metadata");
    }
  }

  if (this.status === "PUBLISHED") {
    if (!this.publishedAt || !this.publishedBy) {
      throw new Error(
        "A PUBLISHED offer requires publishedAt and publishedBy"
      );
    }

    if (this.retiredAt || this.retiredBy) {
      throw new Error(
        "A PUBLISHED offer cannot have retirement metadata"
      );
    }
  }

  if (this.status === "RETIRED") {
    if (!this.retiredAt || !this.retiredBy) {
      throw new Error(
        "A RETIRED offer requires retiredAt and retiredBy"
      );
    }

    if (this.enabled !== false) {
      throw new Error("A RETIRED offer cannot be enabled");
    }
  }
});

// Capture the original persisted lifecycle state.
PlatformTrialOfferSchema.post("init", function (doc) {
  doc.$locals.originalStatus = doc.status;
  doc.$locals.originalEnabled = doc.enabled;
});

// Refresh the baseline after every successful save.
PlatformTrialOfferSchema.post("save", function (doc) {
  doc.$locals.originalStatus = doc.status;
  doc.$locals.originalEnabled = doc.enabled;
});

// Only an explicitly authorized service may change lifecycle state
// or toggle the published offer's enabled state.
// Enforce authorized and valid lifecycle transitions.
PlatformTrialOfferSchema.pre("save", function () {
  const originalStatus = this.$locals.originalStatus;
  const originalEnabled = this.$locals.originalEnabled;

  // New documents are validated by the schema rules.
  if (this.isNew || originalStatus === undefined) {
    return;
  }

  const statusChanged = this.status !== originalStatus;
  const enabledChanged = this.enabled !== originalEnabled;

  const lifecycleFields = [
    "publishedAt",
    "publishedBy",
    "retiredAt",
    "retiredBy",
  ];

  const lifecycleMetadataChanged = lifecycleFields.some((field) =>
    this.isModified(field)
  );

  const configurationFields = [
    "version",
    "planId",
    "planVersionId",
    "durationDays",
    "eligibility",
    "createdBy",
  ];

   // Configuration is immutable after publication or retirement.
  // During retirement, lifecycle metadata and enabled state may change,
  // but the actual offer configuration must remain unchanged.
  const protectedConfigurationFields =
    originalStatus === "PUBLISHED" &&
    this.status === "RETIRED"
      ? configurationFields
      : configurationFields;

  if (
    ["PUBLISHED", "RETIRED"].includes(originalStatus) &&
    protectedConfigurationFields.some((field) => this.isModified(field))
  ) {
    throw new Error(
      "Published or retired offer configuration is immutable"
    );
  }

  // A lifecycle transition must be explicitly authorized and valid.
  if (statusChanged) {
    if (this.$locals.lifecycleTransition !== true) {
      throw new Error(
        "Platform trial offer lifecycle changes must use the lifecycle service"
      );
    }

    const allowedTransition =
      (originalStatus === "DRAFT" && this.status === "PUBLISHED") ||
      (originalStatus === "PUBLISHED" && this.status === "RETIRED");

    if (!allowedTransition) {
      throw new Error(
        `Invalid platform trial offer lifecycle transition: ${originalStatus} -> ${this.status}`
      );
    }
  } else if (lifecycleMetadataChanged) {
    // Publication/retirement metadata may only change as part of
    // an actual authorized lifecycle transition.
    throw new Error(
      "Lifecycle metadata can only change during an authorized lifecycle transition"
    );
  }

  // Enable/disable is allowed only for an already-published offer.
  if (enabledChanged) {
    if (this.$locals.enabledTransition !== true) {
      throw new Error(
        "Platform trial offer enable/disable changes must use the offer service"
      );
    }

    if (
      originalStatus !== "PUBLISHED" ||
      this.status !== "PUBLISHED"
    ) {
      throw new Error(
        "Only a published platform trial offer can be enabled or disabled"
      );
    }
  }

  // A retired offer can never be reopened.
  if (originalStatus === "RETIRED" && this.status !== "RETIRED") {
    throw new Error("A retired platform trial offer cannot be reopened");
  }
});


/*
 * Deny all query-based mutations.
 *
 * Configuration changes and lifecycle transitions must go through
 * the dedicated service using validated document operations.
 */
PlatformTrialOfferSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
  ],
  function () {
    throw new Error(
      "Direct query updates are disabled for PlatformTrialOffer; use the platform trial offer service"
    );
  }
);


// Prevent document-level and query-level deletion.
PlatformTrialOfferSchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete"],
  function () {
    throw new Error(
      "Platform trial offers cannot be deleted; retire them instead"
    );
  }
);

PlatformTrialOfferSchema.pre("remove", function () {
  throw new Error(
    "Platform trial offers cannot be deleted; retire them instead"
  );
});

// Block Model.collection.insertOne-style document inserts through
// Mongoose's model API; lifecycle services should create drafts normally.
PlatformTrialOfferSchema.pre("insertMany", function () {
  throw new Error(
    "Use the platform trial offer service to create offer versions"
  );
});

// Block bulkWrite to prevent bypassing offer lifecycle protections.
PlatformTrialOfferSchema.pre("bulkWrite", function () {
  throw new Error(
    "bulkWrite is disabled for PlatformTrialOffer"
  );
});



const PlatformTrialOffer =
  mongoose.models.PlatformTrialOffer ||
  mongoose.model("PlatformTrialOffer", PlatformTrialOfferSchema);

// Prevent direct Model.insertOne() calls.
// Draft creation must go through the platform trial offer service.
PlatformTrialOffer.insertOne = async function () {
  throw new Error(
    "insertOne is disabled for PlatformTrialOffer"
  );
};

module.exports = PlatformTrialOffer;
