const mongoose = require("mongoose");

const PlatformTrialOffer = require("../models/PlatformTrialOffer");

const {
  validateDraftTrialOfferConfiguration,
} = require("./platformTrialOfferValidationService");

const {
  appendPlatformTrialOfferAudit,
} = require("./platformTrialOfferAuditService");







const ALLOWED_DRAFT_UPDATE_FIELDS = [
  "planId",
  "planVersionId",
  "durationDays",
  "eligibility",
];

const createServiceError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const validateObjectId = (value, fieldName) => {
  if (!value || !mongoose.isValidObjectId(value)) {
    throw createServiceError(
      `INVALID_${fieldName.toUpperCase()}`,
      `A valid ${fieldName} is required`
    );
  }
};

const validateUpdateConfiguration = (configuration) => {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  ) {
    throw createServiceError(
      "INVALID_TRIAL_CONFIGURATION",
      "Configuration must be an object"
    );
  }

  const fields = Object.keys(configuration);

  if (fields.length === 0) {
    throw createServiceError(
      "EMPTY_TRIAL_CONFIGURATION",
      "At least one configuration field is required"
    );
  }

  const unsupportedFields = fields.filter(
    (field) => !ALLOWED_DRAFT_UPDATE_FIELDS.includes(field)
  );

  if (unsupportedFields.length > 0) {
    throw createServiceError(
      "UNSUPPORTED_TRIAL_CONFIGURATION_FIELDS",
      `Unsupported configuration fields: ${unsupportedFields.join(", ")}`
    );
  }

  /////////////////24-10_12:29
    const changesPlanId = Object.prototype.hasOwnProperty.call(
    configuration,
    "planId"
  );

  const changesPlanVersionId =
    Object.prototype.hasOwnProperty.call(
      configuration,
      "planVersionId"
    );

  if (changesPlanId !== changesPlanVersionId) {
    throw createServiceError(
      "PLAN_VERSION_SELECTION_INCOMPLETE",
      "planId and planVersionId must be provided together"
    );
  }
  /////////////////
};

const setLifecycleAuthorization = (offer) => {
  offer.$locals.lifecycleTransition = true;
};

const clearLifecycleAuthorization = (offer) => {
  delete offer.$locals.lifecycleTransition;
};

const setEnabledAuthorization = (offer) => {
  offer.$locals.enabledTransition = true;
};

const clearEnabledAuthorization = (offer) => {
  delete offer.$locals.enabledTransition;
};

// --------------------------------------------------
// 1. CREATE A DISABLED DRAFT OFFER
// --------------------------------------------------

const createDraftTrialOffer = async ({
  planId,
  planVersionId,
  durationDays,
  eligibility = "NEW_INSTITUTES_ONLY",
  actorId,
}) => {
  validateObjectId(planId, "planId");
  validateObjectId(planVersionId, "planVersionId");
  validateObjectId(actorId, "actorId");

  const validation =
    await validateDraftTrialOfferConfiguration({
      planId: String(planId),
      planVersionId: String(planVersionId),
      durationDays,
      eligibility,
      enabled: false,
    });

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const latestOffer = await PlatformTrialOffer.findOne({})
        .sort({ version: -1 })
        .select("version")
        .session(session)
        .lean();

      const nextVersion = latestOffer
        ? latestOffer.version + 1
        : 1;

      const offer = new PlatformTrialOffer({
        version: nextVersion,
        status: "DRAFT",
        enabled: false,
        planId: validation.configuration.planId,
        planVersionId: validation.configuration.planVersionId,
        durationDays: validation.configuration.durationDays,
        eligibility: validation.configuration.eligibility,
        createdBy: actorId,
        updatedBy: actorId,
      });

      await offer.save({ session });

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: "TRIAL_OFFER_CREATED",
        actorId,
        session,
        snapshot: {
          status: offer.status,
          enabled: offer.enabled,
          planId: String(offer.planId),
          planVersionId: String(offer.planVersionId),
          durationDays: offer.durationDays,
          eligibility: offer.eligibility,
        },
      });

      result = offer;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 2. UPDATE AN EXISTING DRAFT
// --------------------------------------------------

const updateDraftTrialOffer = async ({
  offerId,
  configuration,
  actorId,
}) => {
  validateObjectId(offerId, "offerId");
  validateObjectId(actorId, "actorId");
  validateUpdateConfiguration(configuration);

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const offer = await PlatformTrialOffer.findById(
        offerId
      ).session(session);

      if (!offer) {
        throw createServiceError(
          "TRIAL_OFFER_NOT_FOUND",
          "Platform trial offer was not found",
          404
        );
      }

      if (offer.status !== "DRAFT") {
        throw createServiceError(
          "TRIAL_OFFER_NOT_DRAFT",
          "Only DRAFT trial offers can be edited",
          409
        );
      }

            // Capture persisted configuration before applying changes.
      const previousConfiguration = {
        planId: String(offer.planId),
        planVersionId: String(offer.planVersionId),
        durationDays: offer.durationDays,
        eligibility: offer.eligibility,
      };

      const selectedPlanId =
        Object.prototype.hasOwnProperty.call(
          configuration,
          "planId"
        )
          ? configuration.planId
          : String(offer.planId);

      const selectedPlanVersionId =
        Object.prototype.hasOwnProperty.call(
          configuration,
          "planVersionId"
        )
          ? configuration.planVersionId
          : String(offer.planVersionId);

      const validation =
        await validateDraftTrialOfferConfiguration({
          planId: String(selectedPlanId),
          planVersionId: String(selectedPlanVersionId),
          durationDays: Object.prototype.hasOwnProperty.call(
            configuration,
            "durationDays"
          )
            ? configuration.durationDays
            : offer.durationDays,
          eligibility: Object.prototype.hasOwnProperty.call(
            configuration,
            "eligibility"
          )
            ? configuration.eligibility
            : offer.eligibility,
          enabled: false,
        });


      offer.planId = validation.configuration.planId;

      offer.planVersionId =
        validation.configuration.planVersionId;

      offer.durationDays =
        validation.configuration.durationDays;

      offer.eligibility =
        validation.configuration.eligibility;

      offer.updatedBy = actorId;

      await offer.save({ session });

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: "TRIAL_OFFER_UPDATED",
        actorId,
        session,


        changes: {
          planId: {
            from: previousConfiguration.planId,
            to: String(offer.planId),
          },
          planVersionId: {
            from: previousConfiguration.planVersionId,
            to: String(offer.planVersionId),
          },
          durationDays: {
            from: previousConfiguration.durationDays,
            to: offer.durationDays,
          },
          eligibility: {
            from: previousConfiguration.eligibility,
            to: offer.eligibility,
          },
        },


        snapshot: {
          status: offer.status,
          enabled: offer.enabled,
          planId: String(offer.planId),
          planVersionId: String(offer.planVersionId),
          durationDays: offer.durationDays,
          eligibility: offer.eligibility,
        },
      });

      result = offer;
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 3. PUBLISH A DRAFT OFFER
// --------------------------------------------------

const publishTrialOffer = async ({
  offerId,
  actorId,
}) => {
  validateObjectId(offerId, "offerId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const offer = await PlatformTrialOffer.findById(
        offerId
      ).session(session);

      if (!offer) {
        throw createServiceError(
          "TRIAL_OFFER_NOT_FOUND",
          "Platform trial offer was not found",
          404
        );
      }

      if (offer.status !== "DRAFT") {
        throw createServiceError(
          "TRIAL_OFFER_NOT_DRAFT",
          "Only DRAFT trial offers can be published",
          409
        );
      }

      // Revalidate the exact selected plan version.
      await validateDraftTrialOfferConfiguration({
        planId: String(offer.planId),
        planVersionId: String(offer.planVersionId),
        durationDays: offer.durationDays,
        eligibility: offer.eligibility,
        enabled: false,
      });

      // Do not implicitly retire another published offer.
      const existingPublishedOffer =
        await PlatformTrialOffer.findOne({
          status: "PUBLISHED",
          _id: { $ne: offer._id },
        })
          .session(session)
          .lean();

      if (existingPublishedOffer) {
        throw createServiceError(
          "PUBLISHED_TRIAL_OFFER_EXISTS",
          "Retire the existing published trial offer before publishing another version",
          409
        );
      }

      offer.status = "PUBLISHED";
      offer.enabled = false;
      offer.publishedAt = new Date();
      offer.publishedBy = actorId;
      offer.updatedBy = actorId;

      setLifecycleAuthorization(offer);

//////////s
      try {
        await offer.save({ session });
      } finally {
        clearLifecycleAuthorization(offer);
      }

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: "TRIAL_OFFER_PUBLISHED",
        actorId,
        session,
        changes: {
          status: {
            from: "DRAFT",
            to: "PUBLISHED",
          },
          enabled: {
            from: false,
            to: false,
          },
        },
        snapshot: {
          status: offer.status,
          enabled: offer.enabled,
          planId: String(offer.planId),
          planVersionId: String(offer.planVersionId),
          durationDays: offer.durationDays,
          eligibility: offer.eligibility,
          publishedAt: offer.publishedAt,
          publishedBy: String(offer.publishedBy),
        },
      });

      result = offer;
////////////
    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 4. ENABLE OR DISABLE THE PUBLISHED OFFER
// --------------------------------------------------

const setTrialOfferEnabled = async ({
  offerId,
  enabled,
  actorId,
}) => {
  validateObjectId(offerId, "offerId");
  validateObjectId(actorId, "actorId");

  if (typeof enabled !== "boolean") {
    throw createServiceError(
      "INVALID_TRIAL_OFFER_ENABLED_VALUE",
      "enabled must be a boolean"
    );
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const offer = await PlatformTrialOffer.findById(
        offerId
      ).session(session);

      if (!offer) {
        throw createServiceError(
          "TRIAL_OFFER_NOT_FOUND",
          "Platform trial offer was not found",
          404
        );
      }

      if (offer.status !== "PUBLISHED") {
        throw createServiceError(
          "TRIAL_OFFER_NOT_PUBLISHED",
          "Only a PUBLISHED trial offer can be enabled or disabled",
          409
        );
      }

      if (offer.enabled === enabled) {
        result = offer;
        return;
      }

      offer.enabled = enabled;
      offer.updatedBy = actorId;

      setEnabledAuthorization(offer);


      try {
        await offer.save({ session });
      } finally {
        clearEnabledAuthorization(offer);
      }

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: enabled
          ? "TRIAL_OFFER_ENABLED"
          : "TRIAL_OFFER_DISABLED",
        actorId,
        session,
        changes: {
          enabled: {
            from: !enabled,
            to: enabled,
          },
        },
        snapshot: {
          status: offer.status,
          enabled: offer.enabled,
          planId: String(offer.planId),
          planVersionId: String(offer.planVersionId),
          durationDays: offer.durationDays,
          eligibility: offer.eligibility,
        },
      });

      result = offer;

    });

    return result;
  } finally {
    await session.endSession();
  }
};

// --------------------------------------------------
// 5. RETIRE A PUBLISHED OFFER
// --------------------------------------------------

const retireTrialOffer = async ({
  offerId,
  actorId,
}) => {
  validateObjectId(offerId, "offerId");
  validateObjectId(actorId, "actorId");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const offer = await PlatformTrialOffer.findById(
        offerId
      ).session(session);

      if (!offer) {
        throw createServiceError(
          "TRIAL_OFFER_NOT_FOUND",
          "Platform trial offer was not found",
          404
        );
      }

      if (offer.status !== "PUBLISHED") {
        throw createServiceError(
          "TRIAL_OFFER_NOT_PUBLISHED",
          "Only a PUBLISHED trial offer can be retired",
          409
        );
      }

      // The model permits enabled changes only while status remains
      // PUBLISHED, so disable first and then retire in this transaction.

      if (offer.enabled) {
        offer.enabled = false;
        offer.updatedBy = actorId;

        setEnabledAuthorization(offer);

        try {
          await offer.save({ session });
        } finally {
          clearEnabledAuthorization(offer);
        }

        await appendPlatformTrialOfferAudit({
          offer,
          eventType: "TRIAL_OFFER_DISABLED",
          actorId,
          session,
          changes: {
            enabled: {
              from: true,
              to: false,
            },
          },
          snapshot: {
            status: offer.status,
            enabled: offer.enabled,
            planId: String(offer.planId),
            planVersionId: String(offer.planVersionId),
            durationDays: offer.durationDays,
            eligibility: offer.eligibility,
          },
        });
      }


      offer.status = "RETIRED";
      offer.retiredAt = new Date();
      offer.retiredBy = actorId;
      offer.updatedBy = actorId;

      setLifecycleAuthorization(offer);


      try {
        await offer.save({ session });
      } finally {
        clearLifecycleAuthorization(offer);
      }

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: "TRIAL_OFFER_RETIRED",
        actorId,
        session,
        changes: {
          status: {
            from: "PUBLISHED",
            to: "RETIRED",
          },
          enabled: {
            from: false,
            to: false,
          },
        },
        snapshot: {
          status: offer.status,
          enabled: offer.enabled,
          planId: String(offer.planId),
          planVersionId: String(offer.planVersionId),
          durationDays: offer.durationDays,
          eligibility: offer.eligibility,
          retiredAt: offer.retiredAt,
          retiredBy: String(offer.retiredBy),
        },
      });

      result = offer;

    });

    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  createDraftTrialOffer,
  updateDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
  retireTrialOffer,
};