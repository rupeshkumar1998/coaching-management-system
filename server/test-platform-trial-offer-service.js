const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  createDraftTrialOffer,
  updateDraftTrialOffer,
  publishTrialOffer,
  setTrialOfferEnabled,
  retireTrialOffer,
} = require("./services/platformTrialOfferService");

const validId = () => String(new mongoose.Types.ObjectId());

const runTest = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
};

const expectErrorCode = async (fn, expectedCode) => {
  await assert.rejects(
    fn,
    (error) => {
      assert.equal(error.code, expectedCode);
      return true;
    }
  );
};

(async () => {
  await runTest(
    "Draft creation rejects invalid plan ID",
    async () => {
      await expectErrorCode(
        () =>
          createDraftTrialOffer({
            planId: "invalid",
            planVersionId: validId(),
            durationDays: 14,
            actorId: validId(),
          }),
        "INVALID_PLANID"
      );
    }
  );

  await runTest(
    "Draft creation rejects invalid plan version ID",
    async () => {
      await expectErrorCode(
        () =>
          createDraftTrialOffer({
            planId: validId(),
            planVersionId: "invalid",
            durationDays: 14,
            actorId: validId(),
          }),
        "INVALID_PLANVERSIONID"
      );
    }
  );

  await runTest(
    "Draft creation rejects invalid actor ID",
    async () => {
      await expectErrorCode(
        () =>
          createDraftTrialOffer({
            planId: validId(),
            planVersionId: validId(),
            durationDays: 14,
            actorId: "invalid",
          }),
        "INVALID_ACTORID"
      );
    }
  );

  await runTest(
    "Draft update rejects invalid offer ID",
    async () => {
      await expectErrorCode(
        () =>
          updateDraftTrialOffer({
            offerId: "invalid",
            configuration: { durationDays: 14 },
            actorId: validId(),
          }),
        "INVALID_OFFERID"
      );
    }
  );

  await runTest(
    "Draft update rejects an empty configuration",
    async () => {
      await expectErrorCode(
        () =>
          updateDraftTrialOffer({
            offerId: validId(),
            configuration: {},
            actorId: validId(),
          }),
        "EMPTY_TRIAL_CONFIGURATION"
      );
    }
  );

  await runTest(
    "Draft update rejects unsupported configuration fields",
    async () => {
      await expectErrorCode(
        () =>
          updateDraftTrialOffer({
            offerId: validId(),
            configuration: {
              unsupportedField: "not-allowed",
            },
            actorId: validId(),
          }),
        "UNSUPPORTED_TRIAL_CONFIGURATION_FIELDS"
      );
    }
  );


    await runTest(
    "Draft update rejects planId without planVersionId",
    async () => {
      await expectErrorCode(
        () =>
          updateDraftTrialOffer({
            offerId: validId(),
            configuration: {
              planId: validId(),
            },
            actorId: validId(),
          }),
        "PLAN_VERSION_SELECTION_INCOMPLETE"
      );
    }
  );

  await runTest(
    "Draft update rejects planVersionId without planId",
    async () => {
      await expectErrorCode(
        () =>
          updateDraftTrialOffer({
            offerId: validId(),
            configuration: {
              planVersionId: validId(),
            },
            actorId: validId(),
          }),
        "PLAN_VERSION_SELECTION_INCOMPLETE"
      );
    }
  );


  await runTest(
    "Publish rejects invalid offer ID",
    async () => {
      await expectErrorCode(
        () =>
          publishTrialOffer({
            offerId: "invalid",
            actorId: validId(),
          }),
        "INVALID_OFFERID"
      );
    }
  );

  await runTest(
    "Enable/disable rejects a non-boolean value",
    async () => {
      await expectErrorCode(
        () =>
          setTrialOfferEnabled({
            offerId: validId(),
            enabled: "true",
            actorId: validId(),
          }),
        "INVALID_TRIAL_OFFER_ENABLED_VALUE"
      );
    }
  );

  await runTest(
    "Retirement rejects invalid offer ID",
    async () => {
      await expectErrorCode(
        () =>
          retireTrialOffer({
            offerId: "invalid",
            actorId: validId(),
          }),
        "INVALID_OFFERID"
      );
    }
  );

  console.log("\nPlatform trial offer service input tests completed.");
})().catch((error) => {
  console.error("Unexpected test runner error:", error);
  process.exitCode = 1;
});