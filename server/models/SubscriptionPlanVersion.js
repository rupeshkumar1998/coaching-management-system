
const mongoose = require("mongoose");

const {
  validateEntitlementConfiguration,
} = require("../services/entitlementCatalogService");

const {
  DEFAULT_CURRENCY,
  isSupportedCurrency,
  validateAmount,
  validateCurrency,
  validateDurationDays,
  validatePaymentConfiguration,
} = require("../constants/commercialConfig");

const subscriptionPlanVersionSchema = new mongoose.Schema(
  {
    // Logical plan this version belongs to.
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
      index: true,
      immutable: true,
    },

    // Version number within one logical plan.
    version: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },

    // DRAFT versions can be edited.
    // PUBLISHED versions are immutable.
    // RETIRED versions remain available for historical references.
    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "RETIRED"],
      default: "DRAFT",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: [0, "Amount cannot be negative"],
    },

    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: DEFAULT_CURRENCY,
      validate: {
        validator: isSupportedCurrency,
        message: "Unsupported currency",
      },
    },

    durationDays: {
      type: Number,
      min: 1,
      default: null,
    },

    paymentRequired: {
      type: Boolean,
      required: true,
      default: false,
    },

    // Entitlement configuration for this version.
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
      required: true,
      default: [],
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
            type: Number,
            min: 0,
            validate: {
              validator: function (value) {
                return (
                  value === null ||
                  value === undefined ||
                  Number.isSafeInteger(value)
                );
              },
              message:
                "Limit value must be a non-negative safe integer or null",
            },
          },
        },
      ],
      required: true,
      default: [],
    },

    // Publication audit.
    publishedAt: {
      type: Date,
      default: null,
    },

    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    retiredAt: {
      type: Date,
      default: null,
    },

    retiredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
  }
);

// Each logical plan can have only one record for a given version.
subscriptionPlanVersionSchema.index(
  { planId: 1, version: 1 },
  {
    unique: true,
    name: "unique_plan_version",
  }
);

// Useful for finding published versions.
subscriptionPlanVersionSchema.index({
  planId: 1,
  status: 1,
});

// A plan can have at most one PUBLISHED version.
subscriptionPlanVersionSchema.index(
  { planId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: "PUBLISHED",
    },
    name: "one_published_version_per_plan",
  }
);

// Validate commercial and entitlement rules before saving.

subscriptionPlanVersionSchema.pre("validate", function () {
  // Commercial configuration validation.
  validateAmount(this.amount);

  this.currency = validateCurrency(this.currency);

  validateDurationDays(this.durationDays);

  validatePaymentConfiguration({
    amount: this.amount,
    paymentRequired: this.paymentRequired,
  });

  // Published versions require publication audit fields.
  if (
    this.status === "PUBLISHED" &&
    (!this.publishedAt || !this.publishedBy)
  ) {
    throw new Error(
      "Published version requires publishedAt and publishedBy"
    );
  }

  // Retired versions require retirement audit fields.
  if (
    this.status === "RETIRED" &&
    (!this.retiredAt || !this.retiredBy)
  ) {
    throw new Error(
      "Retired version requires retiredAt and retiredBy"
    );
  }

  // New plan versions must always start as DRAFT.
  if (this.isNew && this.status !== "DRAFT") {
    throw new Error(
      "New plan versions must be created as DRAFT"
    );
  }

  // Existing entitlement validation.
  if (
    this.isNew ||
    this.isModified("features") ||
    this.isModified("limits")
  ) {
    const normalized = validateEntitlementConfiguration({
      features: this.features,
      limits: this.limits,
    });

    this.features = normalized.features;
    this.limits = normalized.limits;
  }
});


// This hook blocks edits to an existing published or retired
// version through normal document save operations.
// Database-level update queries must also be restricted by the
// service layer; middleware alone cannot secure every write path.

subscriptionPlanVersionSchema.post("init", function (doc) {
  doc.$locals.originalStatus = doc.status;
});

subscriptionPlanVersionSchema.post("save", function (doc) {
  doc.$locals.originalStatus = doc.status;
});
////////////

// subscriptionPlanVersionSchema.pre("save", function () {
//   if (this.isNew) {
//     return;
//   }
//   const originalStatus = this.$locals.originalStatus;

//   if (
//     originalStatus &&
//     ["PUBLISHED", "RETIRED"].includes(originalStatus)
//   ) {
//     throw new Error(
//       "Published or retired plan versions cannot be modified"
//     );
//   }
// });
subscriptionPlanVersionSchema.pre("save", function () {
  if (this.isNew) {
    return;
  }

  const originalStatus = this.$locals.originalStatus;
  const lifecycleAuthorized =
    this.$locals.lifecycleTransition === true;

  const statusChanged = this.isModified("status");

  // A status transition must be explicitly authorized
  // by the controlled lifecycle service.
  if (statusChanged) {
    if (!lifecycleAuthorized) {
      throw new Error(
        "Plan version lifecycle transitions must use the controlled service"
      );
    }

    const allowedTransition =
      (originalStatus === "DRAFT" &&
        this.status === "PUBLISHED") ||
      (originalStatus === "PUBLISHED" &&
        this.status === "RETIRED");

    if (!allowedTransition) {
      throw new Error(
        `Invalid plan version transition: ${originalStatus} -> ${this.status}`
      );
    }

    return;
  }

  // Published and retired versions cannot be edited
  // through ordinary document save operations.
  if (
    ["PUBLISHED", "RETIRED"].includes(originalStatus)
  ) {
    throw new Error(
      "Published or retired plan versions cannot be modified"
    );
  }
});



const IMMUTABLE_PLAN_VERSION_STATUSES = [
  "PUBLISHED",
  "RETIRED",
];

// const rejectImmutablePlanVersionQueryUpdate = async function () {
//   const filter = this.getFilter();
//   const update = this.getUpdate();

//   // Reject pipeline updates because their final status and fields
//   // cannot be safely determined by this simple guard.
//   if (Array.isArray(update)) {
//     throw new Error(
//       "Aggregation-pipeline updates are not allowed for plan versions"
//     );
//   }

//   if (!update || typeof update !== "object") {
//     return;
//   }

//   // Reject updates that attempt to change the lifecycle status.
//   const statusChangeRequested =
//     Object.prototype.hasOwnProperty.call(update, "status") ||
//     Object.prototype.hasOwnProperty.call(
//       update.$set || {},
//       "status"
//     ) ||
//     Object.prototype.hasOwnProperty.call(
//       update.$unset || {},
//       "status"
//     );

//   if (statusChangeRequested) {
//     throw new Error(
//       "Plan version status must be changed through the controlled lifecycle service"
//     );
//   }

//   // Resolve documents matched by this update.
//   const matchingVersions = await this.model
//     .find(filter)
//     .select("_id status")
//     .setOptions({ strictQuery: false })
//     .lean();

//   const hasImmutableVersion = matchingVersions.some((doc) =>
//     IMMUTABLE_PLAN_VERSION_STATUSES.includes(doc.status)
//   );

//   if (hasImmutableVersion) {
//     throw new Error(
//       "Published or retired plan versions cannot be modified"
//     );
//   }
// };
const rejectImmutablePlanVersionQueryUpdate = async function () {
  const filter = this.getFilter();
  const update = this.getUpdate();
  const options = this.getOptions();

  // Pipeline updates are not allowed.
  if (Array.isArray(update)) {
    throw new Error(
      "Aggregation-pipeline updates are not allowed for plan versions"
    );
  }

  // Upsert can create a document without following the
  // controlled plan-version creation lifecycle.
  if (options.upsert === true) {
    throw new Error(
      "Upsert is disabled for SubscriptionPlanVersion"
    );
  }

  if (!update || typeof update !== "object") {
    return;
  }


  // Identity fields must never be changed through query updates.
  const immutableIdentityFields = ["planId", "version"];

  let identityChangeRequested =
    immutableIdentityFields.some((field) =>
      Object.prototype.hasOwnProperty.call(update, field)
    );

  for (const [operator, value] of Object.entries(update)) {
    if (
      operator.startsWith("$") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // Covers $set, $unset, $inc, $setOnInsert and similar operators.
      if (
        immutableIdentityFields.some((field) =>
          Object.prototype.hasOwnProperty.call(value, field)
        )
      ) {
        identityChangeRequested = true;
      }

      // Prevent renaming another field to planId or version.
      if (
        operator === "$rename" &&
        Object.values(value).some((field) =>
          immutableIdentityFields.includes(field)
        )
      ) {
        identityChangeRequested = true;
      }
    }
  }

  if (identityChangeRequested) {
    throw new Error(
      "Plan version planId and version cannot be changed"
    );
  }




  // Reject direct status changes and any update operator
  // that attempts to modify or remove the status field.
  let statusChangeRequested =
    Object.prototype.hasOwnProperty.call(update, "status");

  for (const [operator, value] of Object.entries(update)) {
    if (
      operator.startsWith("$") &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      if (
        Object.prototype.hasOwnProperty.call(value, "status")
      ) {
        statusChangeRequested = true;
      }

      // $rename can also rename another field to "status".
      if (
        operator === "$rename" &&
        Object.values(value).includes("status")
      ) {
        statusChangeRequested = true;
      }
    }
  }

  if (statusChangeRequested) {
    throw new Error(
      "Plan version status must be changed through the controlled lifecycle service"
    );
  }

  // Check whether the query matches an immutable version.
  const matchingVersions = await this.model
    .find(filter)
    .select("_id status")
    .setOptions({ strictQuery: false })
    .lean();

  const hasImmutableVersion = matchingVersions.some((doc) =>
    IMMUTABLE_PLAN_VERSION_STATUSES.includes(doc.status)
  );

  if (hasImmutableVersion) {
    throw new Error(
      "Published or retired plan versions cannot be modified"
    );
  }
};




subscriptionPlanVersionSchema.pre(
  "updateOne",
  rejectImmutablePlanVersionQueryUpdate
);

subscriptionPlanVersionSchema.pre(
  "updateMany",
  rejectImmutablePlanVersionQueryUpdate
);

subscriptionPlanVersionSchema.pre(
  "findOneAndUpdate",
  rejectImmutablePlanVersionQueryUpdate
);



subscriptionPlanVersionSchema.pre(
  "replaceOne",
  rejectImmutablePlanVersionQueryUpdate
);

subscriptionPlanVersionSchema.pre(
  "findOneAndReplace",
  rejectImmutablePlanVersionQueryUpdate
);






// // Prevent deletion of published or retired plan versions.
// const rejectImmutablePlanVersionDelete = async function () {
//   const filter = this.getFilter();

//   const matchingVersions = await this.model
//     .find(filter)
//     .select("_id status")
//     .setOptions({ strictQuery: false })
//     .lean();

//   const hasImmutableVersion = matchingVersions.some((doc) =>
//     IMMUTABLE_PLAN_VERSION_STATUSES.includes(doc.status)
//   );

//   if (hasImmutableVersion) {
//     throw new Error(
//       "Published or retired plan versions cannot be modified"
//     );
//   }
// };

// // Query-based deletion protection.
// subscriptionPlanVersionSchema.pre(
//   "deleteOne",
//   { query: true, document: false },
//   rejectImmutablePlanVersionDelete
// );

// subscriptionPlanVersionSchema.pre(
//   "deleteMany",
//   rejectImmutablePlanVersionDelete
// );

// subscriptionPlanVersionSchema.pre(
//   "findOneAndDelete",
//   rejectImmutablePlanVersionDelete
// );

// // // Document-based deletion protection.
// // subscriptionPlanVersionSchema.pre(
// //   "deleteOne",
// //   { document: true, query: false },
// //   function () {
// //     if (
// //       IMMUTABLE_PLAN_VERSION_STATUSES.includes(this.status)
// //     ) {
// //       throw new Error(
// //         "Published or retired plan versions cannot be modified"
// //       );
// //     }
// //   }
// // );
// // Document-based deletion protection.
// // Check the current database status rather than relying only
// // on the possibly stale document object.
// subscriptionPlanVersionSchema.pre(
//   "deleteOne",
//   { document: true, query: false },
//   async function () {
//     const currentVersion = await this.constructor
//       .findById(this._id)
//       .select("status")
//       .lean();

//     // If the record no longer exists, there is nothing to protect.
//     if (!currentVersion) {
//       return;
//     }

//     if (
//       IMMUTABLE_PLAN_VERSION_STATUSES.includes(
//         currentVersion.status
//       )
//     ) {
//       throw new Error(
//         "Published or retired plan versions cannot be modified"
//       );
//     }
//   }
// );

// -------------------------------------------------------------
// STRICT HISTORICAL VERSION DELETION PROTECTION
//
// All plan versions are permanent historical records.
// DRAFT, PUBLISHED and RETIRED versions cannot be deleted.
// -------------------------------------------------------------

const rejectPlanVersionDelete = function () {
  throw new Error(
    "Subscription plan versions cannot be deleted"
  );
};

// Query-based deletion protection.
subscriptionPlanVersionSchema.pre(
  "deleteOne",
  { query: true, document: false },
  rejectPlanVersionDelete
);

subscriptionPlanVersionSchema.pre(
  "deleteMany",
  rejectPlanVersionDelete
);

subscriptionPlanVersionSchema.pre(
  "findOneAndDelete",
  rejectPlanVersionDelete
);

// Document-based deletion protection.
subscriptionPlanVersionSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectPlanVersionDelete
);






// Block bulkWrite to prevent bypassing plan-version immutability guards.
subscriptionPlanVersionSchema.pre("bulkWrite", function () {
  throw new Error(
    "bulkWrite is disabled for SubscriptionPlanVersion"
  );
});

// Block insertMany to prevent bypassing plan-version validation.
subscriptionPlanVersionSchema.pre("insertMany", function () {
  throw new Error(
    "insertMany is disabled for SubscriptionPlanVersion"
  );
});


// // Block insertMany to ensure plan-version lifecycle validation
// // cannot be bypassed through bulk document creation.
// subscriptionPlanVersionSchema.pre("insertMany", function () {
//   throw new Error(
//     "insertMany is disabled for SubscriptionPlanVersion"
//   );
// });


///////////check it//
// // Block insertOne to prevent bypassing plan-version creation rules.
// subscriptionPlanVersionSchema.pre("insertOne", function () {
//   throw new Error(
//     "insertOne is disabled for SubscriptionPlanVersion"
//   );
// });
/////////






// const SubscriptionPlanVersion =
//   mongoose.models.SubscriptionPlanVersion ||
//   mongoose.model(
//     "SubscriptionPlanVersion",
//     subscriptionPlanVersionSchema
//   );

// module.exports = SubscriptionPlanVersion;


const SubscriptionPlanVersion =
  mongoose.models.SubscriptionPlanVersion ||
  mongoose.model(
    "SubscriptionPlanVersion",
    subscriptionPlanVersionSchema
  );

// Prevent direct Model.insertOne() calls.
// Draft creation must go through subscriptionPlanVersionService.
SubscriptionPlanVersion.insertOne = async function () {
  throw new Error(
    "insertOne is disabled for SubscriptionPlanVersion"
  );
};

module.exports = SubscriptionPlanVersion;
