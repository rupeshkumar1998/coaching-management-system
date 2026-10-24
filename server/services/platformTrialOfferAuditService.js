
const mongoose = require("mongoose");

const PlatformTrialOfferAudit = require(
  "../models/PlatformTrialOfferAudit"
);

const ALLOWED_EVENT_TYPES = new Set([
  "TRIAL_OFFER_CREATED",
  "TRIAL_OFFER_UPDATED",
  "TRIAL_OFFER_PUBLISHED",
  "TRIAL_OFFER_ENABLED",
  "TRIAL_OFFER_DISABLED",
  "TRIAL_OFFER_RETIRED",
]);

const createAuditError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
};

const appendPlatformTrialOfferAudit = async ({
  offer,
  eventType,
  actorId,
  session,
  changes,
  snapshot,
}) => {
  if (!offer || !offer._id) {
    throw createAuditError(
      "INVALID_AUDIT_OFFER",
      "A valid platform trial offer is required"
    );
  }

  if (!mongoose.isValidObjectId(actorId)) {
    throw createAuditError(
      "INVALID_AUDIT_ACTOR",
      "A valid audit actor is required"
    );
  }

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw createAuditError(
      "INVALID_AUDIT_EVENT_TYPE",
      "Unsupported platform trial offer audit event"
    );
  }

  if (!session || typeof session.withTransaction !== "function") {
    throw createAuditError(
      "AUDIT_SESSION_REQUIRED",
      "A MongoDB transaction session is required for audit writes"
    );
  }

  const audit = new PlatformTrialOfferAudit({
    offerId: offer._id,
    offerVersion: offer.version,
    eventType,
    actorId,
    occurredAt: new Date(),
    ...(changes !== undefined ? { changes } : {}),
    ...(snapshot !== undefined ? { snapshot } : {}),
  });

  await audit.save({ session });

  return audit;
};

module.exports = {
  appendPlatformTrialOfferAudit,
};
