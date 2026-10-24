
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PlatformTrialOffer = require("./models/PlatformTrialOffer");
const PlatformTrialOfferAudit = require("./models/PlatformTrialOfferAudit");
const SubscriptionPlan = require("./models/SubscriptionPlan");
const SubscriptionPlanVersion = require("./models/SubscriptionPlanVersion");

const {
  createDraftTrialOffer,
} = require("./services/platformTrialOfferService");

const makeId = () => new mongoose.Types.ObjectId();

const planId = makeId();
const planVersionId = makeId();
const actorId = makeId();

const transactionSession = {
  withTransaction: async (callback) => callback(),
  endSession: async () => {},
};

let savedOffer = null;
let savedOfferSession = null;
let savedAuditEvents = [];
let auditSaveSessions = [];

const originalStartSession = mongoose.startSession;
const originalPlanFindById = SubscriptionPlan.findById;
const originalPlanVersionFindOne = SubscriptionPlanVersion.findOne;
const originalOfferFindOne = PlatformTrialOffer.findOne;
const originalOfferSave = PlatformTrialOffer.prototype.save;
const originalAuditSave = PlatformTrialOfferAudit.prototype.save;

const run = async () => {
  try {
    mongoose.startSession = async () => transactionSession;

    SubscriptionPlan.findById = () => ({
      lean: async () => ({
        _id: planId,
        isActive: true,
        currentPublishedVersion: planVersionId,
      }),
    });

    SubscriptionPlanVersion.findOne = (query) => {
      assert.equal(String(query._id), String(planVersionId));
      assert.equal(String(query.planId), String(planId));
      assert.equal(query.status, "PUBLISHED");

      return {
        lean: async () => ({
          _id: planVersionId,
          planId,
          status: "PUBLISHED",
        }),
      };
    };

    PlatformTrialOffer.findOne = () => {
      const query = {
        sort() {
          return this;
        },
        select() {
          return this;
        },
        session(session) {
          assert.equal(session, transactionSession);
          return this;
        },
        lean: async () => null,
      };

      return query;
    };

    PlatformTrialOffer.prototype.save = async function (options = {}) {
      savedOffer = this;
      savedOfferSession = options.session;
      return this;
    };

    PlatformTrialOfferAudit.prototype.save = async function (
      options = {}
    ) {
      savedAuditEvents.push({
        offerId: String(this.offerId),
        offerVersion: this.offerVersion,
        eventType: this.eventType,
        actorId: String(this.actorId),
        occurredAt: this.occurredAt,
        snapshot: this.snapshot,
      });

      auditSaveSessions.push(options.session);
      return this;
    };

    const result = await createDraftTrialOffer({
      planId: String(planId),
      planVersionId: String(planVersionId),
      durationDays: 14,
      actorId: String(actorId),
    });

    assert.ok(savedOffer, "The draft offer should be saved");
    assert.equal(result, savedOffer);
    assert.equal(savedOfferSession, transactionSession);

    assert.equal(savedOffer.version, 1);
    assert.equal(savedOffer.status, "DRAFT");
    assert.equal(savedOffer.enabled, false);
    assert.equal(String(savedOffer.planId), String(planId));
    assert.equal(
      String(savedOffer.planVersionId),
      String(planVersionId)
    );
    assert.equal(savedOffer.durationDays, 14);
    assert.equal(savedOffer.eligibility, "NEW_INSTITUTES_ONLY");
    assert.equal(String(savedOffer.createdBy), String(actorId));
    assert.equal(String(savedOffer.updatedBy), String(actorId));

    assert.equal(
      savedAuditEvents.length,
      1,
      "Exactly one creation audit event should be saved"
    );

    const audit = savedAuditEvents[0];

    assert.equal(audit.eventType, "TRIAL_OFFER_CREATED");
    assert.equal(audit.offerId, String(savedOffer._id));
    assert.equal(audit.offerVersion, 1);
    assert.equal(audit.actorId, String(actorId));
    assert.ok(audit.occurredAt instanceof Date);

    assert.deepEqual(audit.snapshot, {
      status: "DRAFT",
      enabled: false,
      planId: String(planId),
      planVersionId: String(planVersionId),
      durationDays: 14,
      eligibility: "NEW_INSTITUTES_ONLY",
    });

    assert.equal(auditSaveSessions.length, 1);
    assert.equal(auditSaveSessions[0], transactionSession);

    console.log(
      "PASS: Draft offer is saved in the transaction session"
    );
    console.log(
      "PASS: Draft offer starts disabled with the correct configuration"
    );
    console.log(
      "PASS: Exactly one TRIAL_OFFER_CREATED audit event is generated"
    );
    console.log(
      "PASS: Audit event contains the correct actor, offer version and snapshot"
    );
    console.log(
      "PASS: Offer and audit writes use the same transaction session"
    );
    console.log("\nPlatform trial offer creation audit tests completed.");
  } finally {
    mongoose.startSession = originalStartSession;
    SubscriptionPlan.findById = originalPlanFindById;
    SubscriptionPlanVersion.findOne = originalPlanVersionFindOne;
    PlatformTrialOffer.findOne = originalOfferFindOne;
    PlatformTrialOffer.prototype.save = originalOfferSave;
    PlatformTrialOfferAudit.prototype.save = originalAuditSave;
  }
};

run().catch((error) => {
  console.error("FAIL: Platform trial offer creation audit test");
  console.error(error);
  process.exitCode = 1;
});
