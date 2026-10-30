const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PlatformTrialOffer = require("../../models/PlatformTrialOffer");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require(
  "../../models/SubscriptionPlanVersion"
);

const {
  updateDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
  retireTrialOffer,
} = require("../../services/platformTrialOfferService");



const PlatformTrialOfferAudit = require(
  "../../models/PlatformTrialOfferAudit"
);

// This lifecycle test uses mocked sessions, not a real database.
// Collect audit events so lifecycle operations can assert them.
const capturedAuditEvents = [];

PlatformTrialOfferAudit.prototype.save = async function (options) {
  this.$locals.testSavedOptions = options;

  capturedAuditEvents.push({
    offerId: String(this.offerId),
    offerVersion: this.offerVersion,
    eventType: this.eventType,
    actorId: String(this.actorId),
    changes: this.changes,
    snapshot: this.snapshot,
    session: options?.session,
  });

  return this;
};

const resetAuditEvents = () => {
  capturedAuditEvents.length = 0;
};

// const assertAuditEvent = (eventType, expectedChanges = {}) => {
//   const matchingEvents = capturedAuditEvents.filter(
//     (event) => event.eventType === eventType
//   );

//   assert.equal(
//     matchingEvents.length,
//     1,
//     `Expected exactly one ${eventType} audit event`
//   );

//   const event = matchingEvents[0];

//   assert.equal(event.offerId, String(offerId));
//   assert.equal(event.offerVersion, 1);
//  assert.equal(
//   event.actorId,
//   String(expectedChanges.actorId ?? actorId)
//   );

//   for (const [key, expectedValue] of Object.entries(expectedChanges)) {
//     assert.deepEqual(
//       event.changes?.[key],
//       expectedValue,
//       `Unexpected audit change for ${key}`
//     );
//   }

//   assert.ok(
//     event.session,
//     `${eventType} audit event should use the transaction session`
//   );

//   return event;
// };

const assertAuditEvent = (
  eventType,
  expectedChanges = {},
  expectedActorId = actorId
) => {
  const matchingEvents = capturedAuditEvents.filter(
    (event) => event.eventType === eventType
  );

  assert.equal(
    matchingEvents.length,
    1,
    `Expected exactly one ${eventType} audit event`
  );

  const event = matchingEvents[0];

  assert.equal(event.offerId, String(offerId));
  assert.equal(event.offerVersion, 1);
  assert.equal(event.actorId, String(expectedActorId));

  for (const [key, expectedValue] of Object.entries(expectedChanges)) {
    assert.deepEqual(
      event.changes?.[key],
      expectedValue,
      `Unexpected audit change for ${key}`
    );
  }

  assert.ok(
    event.session,
    `${eventType} audit event should use the transaction session`
  );

  return event;
};




const offerId = new mongoose.Types.ObjectId();
const planId = new mongoose.Types.ObjectId();
const planVersionId = new mongoose.Types.ObjectId();
const actorId = new mongoose.Types.ObjectId();

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.stack || error.message}`);
    process.exitCode = 1;
  }
};

const createSessionMock = () => ({
  withTransaction: async (callback) => callback(),
  endSession: async () => {},
});

const makeOffer = ({
  status = "PUBLISHED",
  enabled = false,
} = {}) => ({
  _id: offerId,
  version: 1,
  status,
  enabled,
  planId,
  planVersionId,
  durationDays: 14,
  eligibility: "NEW_INSTITUTES_ONLY",
  publishedAt: new Date(),
  publishedBy: actorId,
  retiredAt: null,
  retiredBy: null,
  updatedBy: actorId,
  $locals: {},
  save: async function () {
    this.savedLifecycleAuthorization =
      this.$locals.lifecycleTransition === true;

    this.savedEnabledAuthorization =
      this.$locals.enabledTransition === true;

    this.savedStatus = this.status;
    this.savedEnabled = this.enabled;

    return this;
  },
});

const installSessionMock = () => {
  const original = mongoose.startSession;
  mongoose.startSession = async () => createSessionMock();

  return () => {
    mongoose.startSession = original;
  };
};

const installPublishedPlanMocks = ({
  selectedPlanId = planId,
  selectedPlanVersionId = planVersionId,
} = {}) => {
  const originalPlanFindById = SubscriptionPlan.findById;
  const originalVersionFindOne = SubscriptionPlanVersion.findOne;

  SubscriptionPlan.findById = (id) => ({
    lean: async () => {
      if (String(id) !== String(selectedPlanId)) {
        return null;
      }

      return {
        _id: selectedPlanId,
        isActive: true,
        currentPublishedVersion: selectedPlanVersionId,
      };
    },
  });

  SubscriptionPlanVersion.findOne = (filter) => ({
    lean: async () => {
      if (
        String(filter._id) !== String(selectedPlanVersionId) ||
        String(filter.planId) !== String(selectedPlanId) ||
        filter.status !== "PUBLISHED"
      ) {
        return null;
      }

      return {
        _id: selectedPlanVersionId,
        planId: selectedPlanId,
        status: "PUBLISHED",
      };
    },
  });

  return () => {
    SubscriptionPlan.findById = originalPlanFindById;
    SubscriptionPlanVersion.findOne = originalVersionFindOne;
  };
};

const installOfferFindByIdMock = (offer) => {
  const original = PlatformTrialOffer.findById;

  PlatformTrialOffer.findById = () => ({
    session: async () => offer,
  });

  return () => {
    PlatformTrialOffer.findById = original;
  };
};

(async () => {
////////////////
  await runTest(
    "Updating a DRAFT offer saves its new plan version and configuration",
    async () => {
      const newPlanId = new mongoose.Types.ObjectId();
      const newPlanVersionId = new mongoose.Types.ObjectId();
      const newActorId = new mongoose.Types.ObjectId();

      const restoreSession = installSessionMock();

      const offer = makeOffer({
        status: "DRAFT",
        enabled: false,
      });

      offer.publishedAt = null;
      offer.publishedBy = null;
      offer.retiredAt = null;
      offer.retiredBy = null;

      const restoreFind = installOfferFindByIdMock(offer);

      const restorePlanMocks = installPublishedPlanMocks({
        selectedPlanId: newPlanId,
        selectedPlanVersionId: newPlanVersionId,
      });

      try {
        resetAuditEvents();
        const result = await updateDraftTrialOffer({
          offerId: String(offerId),
          configuration: {
            planId: String(newPlanId),
            planVersionId: String(newPlanVersionId),
            durationDays: 30,
            eligibility: "NEW_INSTITUTES_ONLY",
          },
          actorId: String(newActorId),
        });

        assert.equal(String(offer.planId), String(newPlanId));
        assert.equal(
          String(offer.planVersionId),
          String(newPlanVersionId)
        );
        assert.equal(offer.durationDays, 30);
        assert.equal(
          offer.eligibility,
          "NEW_INSTITUTES_ONLY"
        );
        assert.equal(String(offer.updatedBy), String(newActorId));
        assert.equal(offer.status, "DRAFT");
        assert.equal(offer.enabled, false);

        assert.equal(String(result.planId), String(newPlanId));
        assert.equal(
          String(result.planVersionId),
          String(newPlanVersionId)
        );
        assert.equal(result.durationDays, 30);




const audit = assertAuditEvent(
  "TRIAL_OFFER_UPDATED",
  {},
  newActorId
);

assert.equal(audit.changes?.durationDays?.from, 14);
assert.equal(audit.changes?.durationDays?.to, 30);




        console.log(
          "  Verified: new plan/version IDs and configuration are applied."
        );
      } finally {
        restorePlanMocks();
        restoreFind();
        restoreSession();
      }
    }
  );
///////////////////
  await runTest(
    "Publishing rejects an offer that is not a DRAFT",
    async () => {
      const restoreSession = installSessionMock();
      const restoreFind = installOfferFindByIdMock(
        makeOffer({ status: "PUBLISHED" })
      );

      try {
        await assert.rejects(
          () =>
            publishTrialOffer({
              offerId: String(offerId),
              actorId: String(actorId),
            }),
          (error) => {
            assert.equal(error.code, "TRIAL_OFFER_NOT_DRAFT");
            return true;
          }
        );
      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );

  await runTest(
    "Enabling rejects an offer that is not PUBLISHED",
    async () => {
      const restoreSession = installSessionMock();
      const draft = makeOffer({
        status: "DRAFT",
        enabled: false,
      });
      const restoreFind = installOfferFindByIdMock(draft);

      try {
        await assert.rejects(
          () =>
            setTrialOfferEnabled({
              offerId: String(offerId),
              enabled: true,
              actorId: String(actorId),
            }),
          (error) => {
            assert.equal(error.code, "TRIAL_OFFER_NOT_PUBLISHED");
            return true;
          }
        );

        assert.equal(draft.savedEnabledAuthorization, undefined);
      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );

  await runTest(
    "Disabling a published offer uses enabled-transition authorization",
    async () => {
      const restoreSession = installSessionMock();
      const offer = makeOffer({
        status: "PUBLISHED",
        enabled: true,
      });
      const restoreFind = installOfferFindByIdMock(offer);

      try {
        resetAuditEvents();
        const result = await setTrialOfferEnabled({
          offerId: String(offerId),
          enabled: false,
          actorId: String(actorId),
        });

        assert.equal(result.enabled, false);
        assert.equal(offer.savedEnabledAuthorization, true);
        assert.equal(offer.savedStatus, "PUBLISHED");
        assert.equal(offer.$locals.enabledTransition, undefined);

        assertAuditEvent("TRIAL_OFFER_DISABLED", {
          enabled: { from: true, to: false },
        });

      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );

  await runTest(
    "Retiring a published offer uses lifecycle authorization",
    async () => {
      const restoreSession = installSessionMock();
      const offer = makeOffer({
        status: "PUBLISHED",
        enabled: false,
      });
      const restoreFind = installOfferFindByIdMock(offer);

      try {
        resetAuditEvents();
        const result = await retireTrialOffer({
          offerId: String(offerId),
          actorId: String(actorId),
        });

        assert.equal(result.status, "RETIRED");
        assert.equal(offer.savedLifecycleAuthorization, true);
        assert.equal(offer.savedStatus, "RETIRED");
        assert.ok(offer.retiredAt instanceof Date);
        assert.equal(String(offer.retiredBy), String(actorId));
        assert.equal(offer.$locals.lifecycleTransition, undefined);
        assertAuditEvent("TRIAL_OFFER_RETIRED", {
  status: { from: "PUBLISHED", to: "RETIRED" },
});

      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );

  await runTest(
    "Retirement disables an enabled offer before retiring it",
    async () => {
      const restoreSession = installSessionMock();
      const offer = makeOffer({
        status: "PUBLISHED",
        enabled: true,
      });

      const saveHistory = [];
      offer.save = async function () {
        saveHistory.push({
          status: this.status,
          enabled: this.enabled,
          lifecycleAuthorized:
            this.$locals.lifecycleTransition === true,
          enabledAuthorized:
            this.$locals.enabledTransition === true,
        });

        return this;
      };

      const restoreFind = installOfferFindByIdMock(offer);

      try {
        resetAuditEvents();
        await retireTrialOffer({
          offerId: String(offerId),
          actorId: String(actorId),
        });

        assert.equal(saveHistory.length, 2);

        assert.deepEqual(saveHistory[0], {
          status: "PUBLISHED",
          enabled: false,
          lifecycleAuthorized: false,
          enabledAuthorized: true,
        });

        assert.deepEqual(saveHistory[1], {
          status: "RETIRED",
          enabled: false,
          lifecycleAuthorized: true,
          enabledAuthorized: false,
        });

        assert.deepEqual(
  capturedAuditEvents.map((event) => event.eventType),
  ["TRIAL_OFFER_DISABLED", "TRIAL_OFFER_RETIRED"]
);

assert.equal(capturedAuditEvents[0].changes?.enabled?.from, true);
assert.equal(capturedAuditEvents[0].changes?.enabled?.to, false);

assert.equal(capturedAuditEvents[1].changes?.status?.from, "PUBLISHED");
assert.equal(capturedAuditEvents[1].changes?.status?.to, "RETIRED");

      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );

  await runTest(
    "Missing offer is rejected when enabling",
    async () => {
      const restoreSession = installSessionMock();
      const restoreFind = installOfferFindByIdMock(null);

      try {
        await assert.rejects(
          () =>
            setTrialOfferEnabled({
              offerId: String(offerId),
              enabled: true,
              actorId: String(actorId),
            }),
          (error) => {
            assert.equal(error.code, "TRIAL_OFFER_NOT_FOUND");
            return true;
          }
        );
      } finally {
        restoreFind();
        restoreSession();
      }
    }
  );


    await runTest(
    "Publishing is rejected when another published offer exists",
    async () => {
      const restoreSession = installSessionMock();
      const restoreFindById = installOfferFindByIdMock(
        makeOffer({
          status: "DRAFT",
          enabled: false,
        })
      );
      const originalFindOne = PlatformTrialOffer.findOne;
      const restorePlanMocks = installPublishedPlanMocks();

      PlatformTrialOffer.findOne = () => ({
        session: () => ({
          lean: async () => ({
            _id: new mongoose.Types.ObjectId(),
            status: "PUBLISHED",
          }),
        }),
      });

      try {
        await assert.rejects(
          () =>
            publishTrialOffer({
              offerId: String(offerId),
              actorId: String(actorId),
            }),
          (error) => {
            assert.equal(
              error.code,
              "PUBLISHED_TRIAL_OFFER_EXISTS"
            );
            return true;
          }
        );
      } finally {
        PlatformTrialOffer.findOne = originalFindOne;
        restorePlanMocks();
        restoreFindById();
        restoreSession();
      }
    }
  );

  await runTest(
    "Valid DRAFT is published with lifecycle authorization",
    async () => {
      const restoreSession = installSessionMock();
      const offer = makeOffer({
        status: "DRAFT",
        enabled: false,
      });

      offer.publishedAt = null;
      offer.publishedBy = null;
      offer.retiredAt = null;
      offer.retiredBy = null;

      const originalSave = offer.save;

      offer.save = async function () {
        this.savedLifecycleAuthorization =
          this.$locals.lifecycleTransition === true;

        this.savedStatus = this.status;
        this.savedEnabled = this.enabled;

        return this;
      };

      const restoreFindById = installOfferFindByIdMock(offer);
      const restorePlanMocks = installPublishedPlanMocks();
      const originalFindOne = PlatformTrialOffer.findOne;

      PlatformTrialOffer.findOne = () => ({
        session: () => ({
          lean: async () => null,
        }),
      });

      try {
        resetAuditEvents();
        const result = await publishTrialOffer({
          offerId: String(offerId),
          actorId: String(actorId),
        });

        assert.equal(result.status, "PUBLISHED");
        assert.equal(result.enabled, false);
        assert.equal(offer.savedStatus, "PUBLISHED");
        assert.equal(offer.savedEnabled, false);
        assert.equal(offer.savedLifecycleAuthorization, true);
        assert.ok(offer.publishedAt instanceof Date);
        assert.equal(String(offer.publishedBy), String(actorId));
        assert.equal(offer.$locals.lifecycleTransition, undefined);
        assertAuditEvent("TRIAL_OFFER_PUBLISHED", {
          status: { from: "DRAFT", to: "PUBLISHED" },
        });
      } finally {
        offer.save = originalSave;
        PlatformTrialOffer.findOne = originalFindOne;
        restorePlanMocks();
        restoreFindById();
        restoreSession();
      }
    }
  );


  console.log(
    "\nPlatform trial offer lifecycle service tests completed."
  );
})().catch((error) => {
  console.error("Unexpected test runner error:", error);
  process.exitCode = 1;
});