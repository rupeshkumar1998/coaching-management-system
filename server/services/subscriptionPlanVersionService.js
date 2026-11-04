const mongoose = require("mongoose");

const SubscriptionPlan = require("../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../models/SubscriptionPlanVersion");

const {
  validateEntitlementConfiguration,
} = require("./entitlementCatalogService");

const {
  validateAmount,
  validateCurrency,
  validateDurationDays,
  validatePaymentConfiguration,
} = require("../constants/commercialConfig");


const ALLOWED_CONFIGURATION_FIELDS = [
  "amount",
  "currency",
  "durationDays",
  "paymentRequired",
  "features",
  "limits",
];

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const validateObjectId = (value, fieldName) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw new Error(`Valid ${fieldName} is required`);
  }
};

const validateConfiguration = (configuration) => {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  ) {
    throw new Error("Configuration must be an object");
  }

  const unknownFields = Object.keys(configuration).filter(
    (field) => !ALLOWED_CONFIGURATION_FIELDS.includes(field)
  );

  if (unknownFields.length > 0) {
    throw new Error(
      `Unsupported configuration fields: ${unknownFields.join(", ")}`
    );
  }
};

const validateCommercialConfiguration = (version) => {
  validateAmount(version.amount);

  validateCurrency(version.currency);

  validateDurationDays(version.durationDays);

  validatePaymentConfiguration({
    amount: version.amount,
    paymentRequired: version.paymentRequired,
  });
};

const applyConfiguration = (version, configuration) => {
  for (const field of ALLOWED_CONFIGURATION_FIELDS) {
    if (hasOwn(configuration, field)) {
      version.set(field, configuration[field]);
    }
  }
};

const setLifecycleAuthorization = (version) => {
  version.$locals.lifecycleTransition = true;
};

const clearLifecycleAuthorization = (version) => {
  delete version.$locals.lifecycleTransition;
};

// --------------------------------------------------
// 1. CREATE DRAFT VERSION
// --------------------------------------------------

const createDraftPlanVersion = async ({
  planId,
  configuration,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(actorId, "actorId");
  validateConfiguration(configuration);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const plan = await SubscriptionPlan.findById(planId)
        .session(session);

      if (!plan) {
        throw new Error("Subscription plan not found");
      }

      const latestVersion = await SubscriptionPlanVersion.findOne({
        planId,
      })
        .sort({ version: -1 })
        .select("version")
        .session(session)
        .lean();

      const nextVersion = latestVersion
        ? latestVersion.version + 1
        : 1;

      const draft = new SubscriptionPlanVersion({
        planId,
        version: nextVersion,
        status: "DRAFT",
        createdBy: actorId,
        updatedBy: actorId,
      });

      applyConfiguration(draft, configuration);

      await draft.save({ session });

      result = draft;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 2. UPDATE DRAFT CONFIGURATION
// --------------------------------------------------

const updateDraftPlanVersion = async ({
  planId,
  versionId,
  configuration,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(versionId, "versionId");
  validateObjectId(actorId, "actorId");
  validateConfiguration(configuration);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const version = await SubscriptionPlanVersion.findOne({
        _id: versionId,
        planId,
      }).session(session);

      if (!version) {
        throw new Error("Plan version not found");
      }

      if (version.status !== "DRAFT") {
        throw new Error("Only DRAFT versions can be edited");
      }

      applyConfiguration(version, configuration);
      version.updatedBy = actorId;

      await version.save({ session });

      result = version;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 3. PUBLISH DRAFT VERSION
// --------------------------------------------------

const publishPlanVersion = async ({
  planId,
  versionId,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(versionId, "versionId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const plan = await SubscriptionPlan.findById(planId)
        .session(session);

      if (!plan) {
        throw new Error("Subscription plan not found");
      }

      const version = await SubscriptionPlanVersion.findOne({
        _id: versionId,
        planId,
      }).session(session);

      if (!version) {
        throw new Error("Plan version not found");
      }

      if (version.status !== "DRAFT") {
        throw new Error("Only DRAFT versions can be published");
      }

      // Revalidate persisted entitlements before publishing.
      // This also protects against corrupted data written outside Mongoose.
      validateEntitlementConfiguration({
        features: version.features,
        limits: version.limits,
      });

      // Revalidate persisted commercial configuration before publishing.
      // This also protects against corrupted data written outside Mongoose.
      validateCommercialConfiguration(version);


      // Retire the previous current version first.
      if (plan.currentPublishedVersion) {
        const previousVersion =
          await SubscriptionPlanVersion.findOne({
            _id: plan.currentPublishedVersion,
            planId,
          }).session(session);

        if (
          !previousVersion ||
          previousVersion.status !== "PUBLISHED"
        ) {
          throw new Error(
            "Current published version pointer is inconsistent"
          );
        }

        previousVersion.status = "RETIRED";
        previousVersion.retiredAt = new Date();
        previousVersion.retiredBy = actorId;
        previousVersion.updatedBy = actorId;

        setLifecycleAuthorization(previousVersion);

        try {
          await previousVersion.save({ session });
        } finally {
          clearLifecycleAuthorization(previousVersion);
        }
      }

      // Publish the selected draft.
      version.status = "PUBLISHED";
      version.publishedAt = new Date();
      version.publishedBy = actorId;
      version.updatedBy = actorId;

      setLifecycleAuthorization(version);

      try {
        await version.save({ session });
      } finally {
        clearLifecycleAuthorization(version);
      }

      // Update the plan pointer in the same transaction.
      plan.currentPublishedVersion = version._id;
      plan.updatedBy = actorId;

      await plan.save({ session });

      result = version;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 4. RETIRE CURRENT PUBLISHED VERSION
// --------------------------------------------------

const retirePublishedPlanVersion = async ({
  planId,
  versionId,
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(versionId, "versionId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const plan = await SubscriptionPlan.findById(planId)
        .session(session);

      if (!plan) {
        throw new Error("Subscription plan not found");
      }

      if (
        !plan.currentPublishedVersion ||
        plan.currentPublishedVersion.toString() !==
        versionId.toString()
      ) {
        throw new Error(
          "Version is not the plan's current published version"
        );
      }

      const version = await SubscriptionPlanVersion.findOne({
        _id: versionId,
        planId,
      }).session(session);

      if (!version || version.status !== "PUBLISHED") {
        throw new Error("Published version not found");
      }

      version.status = "RETIRED";
      version.retiredAt = new Date();
      version.retiredBy = actorId;
      version.updatedBy = actorId;

      setLifecycleAuthorization(version);

      try {
        await version.save({ session });
      } finally {
        clearLifecycleAuthorization(version);
      }

      plan.currentPublishedVersion = null;
      plan.updatedBy = actorId;

      await plan.save({ session });

      result = version;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createDraftPlanVersion,
  updateDraftPlanVersion,
  publishPlanVersion,
  retirePublishedPlanVersion,
};