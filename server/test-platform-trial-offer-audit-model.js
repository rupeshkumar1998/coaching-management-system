
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PlatformTrialOfferAudit = require(
  "./models/PlatformTrialOfferAudit"
);

const makeAudit = (overrides = {}) =>
  new PlatformTrialOfferAudit({
    offerId: new mongoose.Types.ObjectId(),
    offerVersion: 1,
    eventType: "TRIAL_OFFER_CREATED",
    actorId: new mongoose.Types.ObjectId(),
    ...overrides,
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
  await runTest("Valid audit event passes validation", async () => {
    const audit = makeAudit();
    await audit.validate();
  });

  await runTest("Missing offerId is rejected", async () => {
    const audit = makeAudit({ offerId: undefined });
    await assert.rejects(() => audit.validate());
  });

  await runTest("Missing actorId is rejected", async () => {
    const audit = makeAudit({ actorId: undefined });
    await assert.rejects(() => audit.validate());
  });

  await runTest("Unknown event type is rejected", async () => {
    const audit = makeAudit({ eventType: "UNKNOWN_EVENT" });
    await assert.rejects(() => audit.validate());
  });

  await runTest("Invalid offer version is rejected", async () => {
    const audit = makeAudit({ offerVersion: 0 });
    await assert.rejects(() => audit.validate());
  });

  await runTest("Existing audit document cannot be saved again", async () => {
    const audit = makeAudit();
    audit.isNew = false;

    await assert.rejects(
      () => audit.save(),
      /Existing audit records cannot be modified/
    );
  });

  await runTest("Direct query update is blocked", async () => {
    const query = PlatformTrialOfferAudit.updateOne(
      { _id: new mongoose.Types.ObjectId() },
      { $set: { eventType: "TRIAL_OFFER_DISABLED" } }
    );

    await assert.rejects(
      () => query.exec(),
      /Audit records are append-only/
    );
  });

  await runTest("Direct query deletion is blocked", async () => {
    const query = PlatformTrialOfferAudit.deleteOne({
      _id: new mongoose.Types.ObjectId(),
    });

    await assert.rejects(
      () => query.exec(),
      /Audit records cannot be deleted/
    );
  });

  await runTest("Direct insertOne is blocked", async () => {
    await assert.rejects(
      () => PlatformTrialOfferAudit.insertOne({}),
      /insertOne is disabled/
    );
  });

  console.log("Platform trial offer audit model tests completed.");
})();
