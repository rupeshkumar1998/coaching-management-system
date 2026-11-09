require("dotenv").config();

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");

const User = require("../../models/User");
const Institute = require("../../models/Institute");
const Subscription = require("../../models/Subscription");
const SubscriptionPlan = require("../../models/SubscriptionPlan");
const SubscriptionPlanVersion = require("../../models/SubscriptionPlanVersion");
const PlatformTrialOffer = require("../../models/PlatformTrialOffer");
const PlatformTrialOfferAudit = require("../../models/PlatformTrialOfferAudit");
const TrialEligibilityClaim = require("../../models/TrialEligibilityClaim");

const connectTestDB = require("../helpers/connectTestDB");

const {
  createDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
  retireTrialOffer,
} = require("../../services/platformTrialOfferService");

const {
  createPlatformTrialSubscription,
} = require("../../services/platformTrialSubscriptionService");

// =========================================================
// 32.16.15.15 — Trial Offer Toggle Regression Tests
// =========================================================

const createdUserIds = [];
const createdInstituteIds = [];
const createdSubscriptionIds = [];
const createdPlanIds = [];
const createdVersionIds = [];
const createdOfferIds = [];
const createdClaimIds = [];

let passed = 0;
let failed = 0;

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const test = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
  }
};

// ---------------------------------------------------------
// Fixtures
// ---------------------------------------------------------

const makeSuperAdmin = async () => {
  const userId = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: userId,
    instituteId: null,
    name: "Trial Toggle Test SUPER_ADMIN",
    email: `tt-sa-${randomUUID()}@example.com`,
    password: "DummyHashedPassword123",
    role: "SUPER_ADMIN",
    isActive: true,
    accountStatus: "ACTIVE",
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdUserIds.push(userId);
  return userId;
};

const makeApprovedInstitute = async () => {
  const instituteId = new mongoose.Types.ObjectId();
  await Institute.collection.insertOne({
    _id: instituteId,
    code: `TT_${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 20)}`,
    name: "Trial Toggle Test Institute",
    approvalStatus: "APPROVED",
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdInstituteIds.push(instituteId);
  return instituteId;
};

const makeFreePlanAndVersion = async (actorId) => {
  const planId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  await SubscriptionPlan.collection.insertOne({
    _id: planId,
    code: "FREE", // Must match Subscription.plan enum
    name: "Trial Toggle Free Plan",
    description: "",
    isActive: true,
    currentPublishedVersion: versionId,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdPlanIds.push(planId);

  await SubscriptionPlanVersion.collection.insertOne({
    _id: versionId,
    planId,
    version: 1,
    status: "PUBLISHED",
    amount: 0,
    currency: "INR",
    durationDays: 14,
    paymentRequired: false,
    features: [{ key: "EXAM_TEST_MANAGEMENT", enabled: true }],
    limits: [],
    publishedAt: new Date(),
    publishedBy: actorId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdVersionIds.push(versionId);

  return { planId, versionId };
};

const cleanupLeftoverFreePlan = async () => {
  const leftover = await SubscriptionPlan.findOne({
    code: "FREE",
  }).lean();
  if (!leftover) return;

  console.log("Cleaning up leftover FREE plan from prior run...");

  const fakeActor = new mongoose.Types.ObjectId();

  const published = await PlatformTrialOffer.find({
    planId: leftover._id,
    status: "PUBLISHED",
  }).lean();
  for (const o of published) {
    try {
      await retireTrialOffer({ offerId: o._id, actorId: fakeActor });
    } catch (_) {
      // ignore
    }
  }

  const versions = await SubscriptionPlanVersion.find({
    planId: leftover._id,
  })
    .select("_id")
    .lean();
  const versionIds = versions.map((v) => v._id);

  const offers = await PlatformTrialOffer.find({
    planId: leftover._id,
  })
    .select("_id")
    .lean();
  const offerIds = offers.map((o) => o._id);

  await TrialEligibilityClaim.collection.deleteMany({
    platformTrialOfferId: { $in: offerIds },
  });
  await Subscription.collection.deleteMany({
    planVersionId: { $in: versionIds },
  });
  await PlatformTrialOfferAudit.collection.deleteMany({
    offerId: { $in: offerIds },
  });
  await PlatformTrialOffer.collection.deleteMany({
    _id: { $in: offerIds },
  });
  await SubscriptionPlanVersion.collection.deleteMany({
    _id: { $in: versionIds },
  });
  await SubscriptionPlan.collection.deleteOne({ _id: leftover._id });

  console.log("Cleanup done.");
};

const makeExistingClaim = async ({
  instituteId,
  offerId,
  planId,
  planVersionId,
}) => {
  const claimId = new mongoose.Types.ObjectId();
  await TrialEligibilityClaim.collection.insertOne({
    _id: claimId,
    instituteId,
    subscriptionId: new mongoose.Types.ObjectId(),
    source: "PLATFORM_OFFER",
    platformTrialOfferId: offerId,
    platformTrialOfferVersion: 1,
    planId,
    planVersionId,
    planVersion: 1,
    trialGrantedBy: null,
    trialReason: null,
    claimedAt: new Date(Date.now() - 86400000 * 30),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdClaimIds.push(claimId);
  return claimId;
};

const makeTrialSubscription = async ({
  instituteId,
  offerId,
  planId,
  planVersionId,
  status,
  endOffsetDays = 11,
  startOffsetDays = -3,
}) => {
  const subId = new mongoose.Types.ObjectId();
  await Subscription.collection.insertOne({
    _id: subId,
    instituteId,
    subscriptionType: "TRIAL",
    plan: "FREE",
    planVersion: 1,
    planVersionId,
    amount: 0,
    currency: "INR",
    paymentRequired: false,
    durationDays: 14,
    status,
    startDate: new Date(Date.now() + 86400000 * startOffsetDays),
    endDate:
      endOffsetDays === null
        ? null
        : new Date(Date.now() + 86400000 * endOffsetDays),
    features: [
      { key: "EXAM_TEST_MANAGEMENT", enabled: true },
      { key: "ANALYTICS", enabled: false },
    ],
    limits: [{ key: "MAX_STUDENTS", value: 500 }],
    trialSource: "PLATFORM_OFFER",
    platformTrialOfferId: offerId,
    platformTrialOfferVersion: 1,
    snapshotCapturedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  createdSubscriptionIds.push(subId);
  return subId;
};

// ---------------------------------------------------------
// Runner
// ---------------------------------------------------------

const run = async () => {
  await connectTestDB();

  try {
    await cleanupLeftoverFreePlan();

    const actorId = await makeSuperAdmin();
    const { planId, versionId } = await makeFreePlanAndVersion(actorId);

    // -----------------------------------------------------
    // Helper: retire any existing published offer, then
    // create a fresh enabled+published offer on our plan.
    // -----------------------------------------------------
    const freshOffer = async () => {
      const published = await PlatformTrialOffer.find({
        status: "PUBLISHED",
      }).lean();
      for (const o of published) {
        try {
          await retireTrialOffer({ offerId: o._id, actorId });
        } catch (_) {
          // ignore
        }
      }

      const draft = await createDraftTrialOffer({
        planId,
        planVersionId: versionId,
        durationDays: 14,
        eligibility: "NEW_INSTITUTES_ONLY",
        actorId,
      });

      const publishedDoc = await publishTrialOffer({
        offerId: draft._id,
        actorId,
      });

      const enabled = await setTrialOfferEnabled({
        offerId: publishedDoc._id,
        enabled: true,
        actorId,
      });

      createdOfferIds.push(enabled._id);
      return enabled;
    };

    // =====================================================
    // Section A — Trial creation flow
    // =====================================================

    await test(
      "A1: offer ON + eligible institute → trial created",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const result = await createPlatformTrialSubscription({
          instituteId,
        });

        assert(result.subscription, "subscription must exist");
        assert(
          result.subscription.subscriptionType === "TRIAL",
          "must be TRIAL"
        );
        assert(
          result.subscription.status === "PENDING",
          `expected PENDING, got ${result.subscription.status}`
        );
        assert(
          String(result.subscription.platformTrialOfferId) ===
            String(offer._id),
          "offer reference mismatch"
        );

        createdSubscriptionIds.push(result.subscription._id);
        if (result.claim?._id) {
          createdClaimIds.push(result.claim._id);
        }
      }
    );

    await test(
      "A2: offer OFF → TRIAL_OFFER_UNAVAILABLE",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        let threw = false;
        let code = null;
        try {
          await createPlatformTrialSubscription({ instituteId });
        } catch (e) {
          threw = true;
          code = e.code;
        }

        assert(threw, "should throw");
        assert(
          code === "TRIAL_OFFER_UNAVAILABLE",
          `expected TRIAL_OFFER_UNAVAILABLE, got ${code}`
        );
      }
    );

    await test(
      "A3: previously used → TRIAL_ALREADY_USED",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        await makeExistingClaim({
          instituteId,
          offerId: offer._id,
          planId,
          planVersionId: versionId,
        });

        let threw = false;
        let code = null;
        try {
          await createPlatformTrialSubscription({ instituteId });
        } catch (e) {
          threw = true;
          code = e.code;
        }

        assert(threw, "should throw");
        assert(
          code === "TRIAL_ALREADY_USED",
          `expected TRIAL_ALREADY_USED, got ${code}`
        );
      }
    );

    await test(
      "A4: ON-OFF-ON → new allowed, used still blocked",
      async () => {
        const offer = await freshOffer();

        // A uses trial
        const instituteA = await makeApprovedInstitute();
        const createdA = await createPlatformTrialSubscription({
          instituteId: instituteA,
        });
        createdSubscriptionIds.push(createdA.subscription._id);
        if (createdA.claim?._id) {
          createdClaimIds.push(createdA.claim._id);
        }

        // OFF
        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        // ON
        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: true,
          actorId,
        });

        // A: still blocked
        let threwA = false;
        try {
          await createPlatformTrialSubscription({
            instituteId: instituteA,
          });
        } catch (e) {
          threwA = true;
          assert(
            e.code === "TRIAL_ALREADY_USED",
            `A: expected TRIAL_ALREADY_USED, got ${e.code}`
          );
        }
        assert(threwA, "A should be blocked");

        // B: allowed
        const instituteB = await makeApprovedInstitute();
        const createdB = await createPlatformTrialSubscription({
          instituteId: instituteB,
        });
        createdSubscriptionIds.push(createdB.subscription._id);
        if (createdB.claim?._id) {
          createdClaimIds.push(createdB.claim._id);
        }
        assert(createdB.subscription, "B should succeed");
      }
    );

    // =====================================================
    // Section B — Existing trial protection
    // =====================================================

    await test(
      "B1: OFF + active trial → status/endDate/features unchanged",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const subId = await makeTrialSubscription({
          instituteId,
          offerId: offer._id,
          planId,
          planVersionId: versionId,
          status: "ACTIVE",
        });

        const before = await Subscription.findById(subId).lean();

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        const after = await Subscription.findById(subId).lean();

        assert(after.status === "ACTIVE", "status");
        assert(
          String(after.endDate) === String(before.endDate),
          "endDate"
        );
        assert(
          String(after.planVersionId) ===
            String(before.planVersionId),
          "planVersionId"
        );
        assert(
          JSON.stringify(after.features) ===
            JSON.stringify(before.features),
          "features"
        );
      }
    );

    await test(
      "B2: OFF + expired trial → remains expired",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const subId = await makeTrialSubscription({
          instituteId,
          offerId: offer._id,
          planId,
          planVersionId: versionId,
          status: "EXPIRED",
          startOffsetDays: -20,
          endOffsetDays: -6,
        });

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        const after = await Subscription.findById(subId).lean();
        assert(after.status === "EXPIRED", "must remain EXPIRED");
      }
    );

    await test(
      "B3: OFF + cancelled trial → remains cancelled",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const subId = await makeTrialSubscription({
          instituteId,
          offerId: offer._id,
          planId,
          planVersionId: versionId,
          status: "CANCELLED",
          endOffsetDays: null,
        });

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        const after = await Subscription.findById(subId).lean();
        assert(
          after.status === "CANCELLED",
          "must remain CANCELLED"
        );
      }
    );

    // =====================================================
    // Section C — Snapshot + Concurrency
    // =====================================================

    await test(
      "C1: toggle OFF does not mutate snapshot fields",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const subId = await makeTrialSubscription({
          instituteId,
          offerId: offer._id,
          planId,
          planVersionId: versionId,
          status: "ACTIVE",
        });

        const before = await Subscription.findById(subId).lean();

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });
        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: true,
          actorId,
        });

        const after = await Subscription.findById(subId).lean();

        assert(
          String(after.amount) === String(before.amount),
          "amount"
        );
        assert(
          String(after.currency) === String(before.currency),
          "currency"
        );
        assert(
          String(after.durationDays) ===
            String(before.durationDays),
          "durationDays"
        );
      }
    );

    await test(
      "C2: concurrent OFF + creation → deterministic",
      async () => {
        const offer = await freshOffer();
        const instituteId = await makeApprovedInstitute();

        const results = await Promise.allSettled([
          setTrialOfferEnabled({
            offerId: offer._id,
            enabled: false,
            actorId,
          }),
          createPlatformTrialSubscription({ instituteId }),
        ]);

        assert(
          results[0].status === "fulfilled",
          "toggle should succeed"
        );

        const creation = results[1];
        if (creation.status === "fulfilled") {
          const sub = creation.value.subscription;
          createdSubscriptionIds.push(sub._id);
          if (creation.value.claim?._id) {
            createdClaimIds.push(creation.value.claim._id);
          }

          const offerDoc = await PlatformTrialOffer.findById(
            offer._id
          ).lean();
          assert(
            offerDoc.enabled === false,
            "offer should end disabled"
          );
        } else {
          assert(
            creation.reason?.code ===
              "TRIAL_OFFER_UNAVAILABLE" ||
              creation.reason?.code === "TRIAL_ALREADY_USED",
            `unexpected error: ${creation.reason?.code}`
          );
        }
      }
    );

    // =====================================================
    // Section D — Audit events
    // =====================================================

    await test(
      "D1: TRIAL_OFFER_ENABLED audit event recorded",
      async () => {
        const offer = await freshOffer();

        const audits = await PlatformTrialOfferAudit.find({
          offerId: offer._id,
          eventType: "TRIAL_OFFER_ENABLED",
        }).lean();

        assert(
          audits.length === 1,
          `expected 1 ENABLED audit, got ${audits.length}`
        );
        const a = audits[0];
        assert(
          String(a.actorId) === String(actorId),
          "actor mismatch"
        );
        assert(
          a.changes?.enabled?.from === false &&
            a.changes?.enabled?.to === true,
          "change snapshot wrong"
        );
      }
    );

    await test(
      "D2: TRIAL_OFFER_DISABLED audit event recorded",
      async () => {
        const offer = await freshOffer();

        await setTrialOfferEnabled({
          offerId: offer._id,
          enabled: false,
          actorId,
        });

        const audits = await PlatformTrialOfferAudit.find({
          offerId: offer._id,
          eventType: "TRIAL_OFFER_DISABLED",
        }).lean();

        assert(
          audits.length === 1,
          `expected 1 DISABLED audit, got ${audits.length}`
        );
        const a = audits[0];
        assert(
          a.changes?.enabled?.from === true &&
            a.changes?.enabled?.to === false,
          "change snapshot wrong"
        );
      }
    );

    console.log("\n------------------------------");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log("------------------------------");

    if (failed > 0) process.exitCode = 1;
  } finally {
    // Cleanup order matters
    if (createdClaimIds.length) {
      await TrialEligibilityClaim.collection.deleteMany({
        _id: { $in: createdClaimIds },
      });
    }
    if (createdSubscriptionIds.length) {
      await Subscription.collection.deleteMany({
        _id: { $in: createdSubscriptionIds },
      });
    }
    if (createdOfferIds.length) {
      await PlatformTrialOfferAudit.collection.deleteMany({
        offerId: { $in: createdOfferIds },
      });
      await PlatformTrialOffer.collection.deleteMany({
        _id: { $in: createdOfferIds },
      });
    }
    if (createdVersionIds.length) {
      await SubscriptionPlanVersion.collection.deleteMany({
        _id: { $in: createdVersionIds },
      });
    }
    if (createdPlanIds.length) {
      await SubscriptionPlan.collection.deleteMany({
        _id: { $in: createdPlanIds },
      });
    }
    if (createdInstituteIds.length) {
      await Institute.collection.deleteMany({
        _id: { $in: createdInstituteIds },
      });
    }
    if (createdUserIds.length) {
      await User.collection.deleteMany({
        _id: { $in: createdUserIds },
      });
    }
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error("TEST SETUP ERROR:", error.message);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exitCode = 1;
});