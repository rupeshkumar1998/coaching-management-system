const mongoose = require("mongoose");

// =========================================================
// 32.16.15.11 — UsageCounter Model
//
// Atomic counters backing the Limit Service.
//
// One document per (instituteId, limitKey, period).
//
// Design notes:
//   - `used` is modified ONLY via `$inc` (reserve/release/reconcile).
//   - Identity fields (`instituteId`, `limitKey`, `period`) are
//     immutable after creation.
//   - Deletion is blocked to preserve history.
//   - `version` is a future hook for optimistic locking; it is
//     currently unused and safe to increment.
//   - Reconciliation metadata (`lastReconciledAt`,
//     `actualUsageAtLastReconcile`) is populated by a
//     future-phase scheduled job; `.11` only stores the shape.
//
// Why these specific guards (not just schema-level `immutable`)?
//   Mongoose silently strips immutable paths from query updates,
//   which masks intent. We want loud, explicit failures so that
//   any bypass attempt is immediately visible in logs and tests.
// =========================================================

const IMMUTABLE_FIELDS = ["instituteId", "limitKey", "period"];
const INCREMENT_ONLY_FIELD = "used";

const usageCounterSchema = new mongoose.Schema(
  {
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      immutable: true,
      index: true,
    },

    limitKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      immutable: true,
      validate: {
        validator: (v) =>
          typeof v === "string" &&
          /^[A-Z][A-Z0-9_]{1,79}$/.test(v),
        message: "Invalid limit key format",
      },
    },

    period: {
      type: String,
      required: true,
      immutable: true,
      validate: {
        validator: (v) => {
          if (typeof v !== "string") return false;
          if (v === "lifetime") return true;
          return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
        },
        message: 'period must be "lifetime" or "YYYY-MM"',
      },
    },

    used: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: (v) =>
          Number.isSafeInteger(v) && v >= 0,
        message: "used must be a non-negative safe integer",
      },
    },

    version: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: (v) => Number.isSafeInteger(v) && v >= 0,
        message: "version must be a non-negative safe integer",
      },
    },

    lastReconciledAt: {
      type: Date,
      default: null,
    },

    actualUsageAtLastReconcile: {
      type: Number,
      default: null,
      validate: {
        validator: (v) =>
          v === null ||
          (Number.isSafeInteger(v) && v >= 0),
        message:
          "actualUsageAtLastReconcile must be a non-negative safe integer or null",
      },
    },
  },
  {
    timestamps: true,
    strict: "throw",
    minimize: false,
  }
);

// =========================================================
// Indexes
// =========================================================

// One counter per (institute, limitKey, period).
usageCounterSchema.index(
  { instituteId: 1, limitKey: 1, period: 1 },
  {
    unique: true,
    name: "unique_usage_counter_scope",
  }
);

// Common admin/reconciliation queries.
usageCounterSchema.index({ instituteId: 1, limitKey: 1 });
usageCounterSchema.index({ lastReconciledAt: 1 });

// =========================================================
// Update introspection helpers
// =========================================================

const collectUpdatedPaths = (update) => {
  const paths = new Set();

  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return paths;
  }

  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const field of Object.keys(value)) {
          paths.add(field);

          // $rename has both a source and a destination path.
          if (key === "$rename" && typeof value[field] === "string") {
            paths.add(value[field]);
          }
        }
      }
    } else {
      paths.add(key);
    }
  }

  return paths;
};

const hasSetOn = (update, field) => {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return false;
  }
  const set = update.$set;
  if (!set || typeof set !== "object" || Array.isArray(set)) return false;
  return Object.prototype.hasOwnProperty.call(set, field);
};

const hasIncOn = (update, field) => {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return false;
  }
  const inc = update.$inc;
  if (!inc || typeof inc !== "object" || Array.isArray(inc)) return false;
  return Object.prototype.hasOwnProperty.call(inc, field);
};

// =========================================================
// Document save guard
//
// New counters are inserted normally.
// Existing counters cannot change identity fields.
// `used` can never be modified via save() — only via $inc.
// =========================================================

usageCounterSchema.pre("save", function () {
  if (this.isNew) return;

  const modified = this.modifiedPaths();

  for (const field of IMMUTABLE_FIELDS) {
    if (modified.includes(field)) {
      throw new Error(
        `UsageCounter field "${field}" is immutable after creation`
      );
    }
  }

  if (modified.includes(INCREMENT_ONLY_FIELD)) {
    throw new Error(
      'UsageCounter "used" can only be modified via $inc on query updates'
    );
  }
});

// =========================================================
// Query update guards
// =========================================================

const rejectProtectedQueryUpdate = function () {
  const update = this.getUpdate();

  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return;
  }

  const updatedPaths = collectUpdatedPaths(update);

  // Identity fields must never be touched.
  for (const field of IMMUTABLE_FIELDS) {
    if (updatedPaths.has(field)) {
      throw new Error(
        `UsageCounter field "${field}" is immutable after creation`
      );
    }
  }

  // `used` must only be touched via $inc.
  if (updatedPaths.has(INCREMENT_ONLY_FIELD)) {
    if (hasSetOn(update, INCREMENT_ONLY_FIELD)) {
      throw new Error(
        'UsageCounter "used" must be modified via $inc, not $set'
      );
    }

    if (!hasIncOn(update, INCREMENT_ONLY_FIELD)) {
      throw new Error(
        'UsageCounter "used" must be modified via $inc'
      );
    }
  }
};

usageCounterSchema.pre("updateOne", rejectProtectedQueryUpdate);
usageCounterSchema.pre("updateMany", rejectProtectedQueryUpdate);
usageCounterSchema.pre("findOneAndUpdate", rejectProtectedQueryUpdate);

// Replacements can silently drop fields — reject outright.
usageCounterSchema.pre("replaceOne", function () {
  throw new Error("UsageCounter replacement is not allowed");
});
usageCounterSchema.pre("findOneAndReplace", function () {
  throw new Error("UsageCounter replacement is not allowed");
});

// =========================================================
// Delete protection (history preservation)
// =========================================================

const rejectDelete = function () {
  throw new Error(
    "UsageCounter documents cannot be deleted (history must be preserved)"
  );
};

usageCounterSchema.pre(
  "deleteOne",
  { query: true, document: false },
  rejectDelete
);
usageCounterSchema.pre(
  "deleteOne",
  { document: true, query: false },
  rejectDelete
);
usageCounterSchema.pre("deleteMany", rejectDelete);
usageCounterSchema.pre("findOneAndDelete", rejectDelete);

// =========================================================
// Bulk operation guards
// =========================================================

usageCounterSchema.pre("bulkWrite", function () {
  throw new Error("bulkWrite is disabled for UsageCounter");
});

usageCounterSchema.pre("insertMany", function () {
  throw new Error("insertMany is disabled for UsageCounter");
});

// =========================================================
// Model export
// =========================================================

const UsageCounter =
  mongoose.models.UsageCounter ||
  mongoose.model("UsageCounter", usageCounterSchema);

module.exports = UsageCounter;