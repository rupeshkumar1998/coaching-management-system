
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PlatformTrialOfferAudit = require(
  "../../models/PlatformTrialOfferAudit"
);

const {
  appendPlatformTrialOfferAudit,
} = require("../../services/platformTrialOfferAuditService");

const makeOffer = () => ({
  _id: new mongoose.Types.ObjectId(),
  version: 1,
});

const makeSession = () => ({
  withTransaction: async () => {},
});

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
};

(async () => {
  const originalSave = PlatformTrialOfferAudit.prototype.save;
  let savedDocument = null;
  let savedOptions = null;

  PlatformTrialOfferAudit.prototype.save = async function (options) {
    savedDocument = this;
    savedOptions = options;
    return this;
  };

  try {
    await runTest("Valid audit event is saved with transaction session", async () => {
      const session = makeSession();
      const offer = makeOffer();
      const actorId = new mongoose.Types.ObjectId();

      await appendPlatformTrialOfferAudit({
        offer,
        eventType: "TRIAL_OFFER_CREATED",
        actorId,
        session,
        snapshot: { status: "DRAFT", enabled: false },
      });

      assert.ok(savedDocument);
      assert.equal(String(savedDocument.offerId), String(offer._id));
      assert.equal(savedDocument.offerVersion, offer.version);
      assert.equal(savedDocument.eventType, "TRIAL_OFFER_CREATED");
      assert.equal(String(savedDocument.actorId), String(actorId));
      assert.equal(savedOptions.session, session);
      assert.deepEqual(savedDocument.snapshot, {
        status: "DRAFT",
        enabled: false,
      });
    });

    await runTest("Missing offer is rejected", async () => {
      await assert.rejects(
        () =>
          appendPlatformTrialOfferAudit({
            offer: null,
            eventType: "TRIAL_OFFER_CREATED",
            actorId: new mongoose.Types.ObjectId(),
            session: makeSession(),
          }),
        { code: "INVALID_AUDIT_OFFER" }
      );
    });

    await runTest("Invalid actor is rejected", async () => {
      await assert.rejects(
        () =>
          appendPlatformTrialOfferAudit({
            offer: makeOffer(),
            eventType: "TRIAL_OFFER_CREATED",
            actorId: "invalid-actor",
            session: makeSession(),
          }),
        { code: "INVALID_AUDIT_ACTOR" }
      );
    });

    await runTest("Unknown event type is rejected", async () => {
      await assert.rejects(
        () =>
          appendPlatformTrialOfferAudit({
            offer: makeOffer(),
            eventType: "UNKNOWN_EVENT",
            actorId: new mongoose.Types.ObjectId(),
            session: makeSession(),
          }),
        { code: "INVALID_AUDIT_EVENT_TYPE" }
      );
    });

    await runTest("Missing transaction session is rejected", async () => {
      await assert.rejects(
        () =>
          appendPlatformTrialOfferAudit({
            offer: makeOffer(),
            eventType: "TRIAL_OFFER_CREATED",
            actorId: new mongoose.Types.ObjectId(),
          }),
        { code: "AUDIT_SESSION_REQUIRED" }
      );
    });
  } finally {
    PlatformTrialOfferAudit.prototype.save = originalSave;
  }

  console.log("Platform trial offer audit service tests completed.");
})();
