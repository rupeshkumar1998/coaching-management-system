
const mongoose = require("mongoose");
const Subscription = require("./models/Subscription");

let passed = 0;
let failed = 0;

function makeTrial(overrides = {}) {
  return new Subscription({
    instituteId: new mongoose.Types.ObjectId(),
    subscriptionType: "TRIAL",
    plan: "BASIC",
    planVersion: 1,
    amount: 0,
    currency: "INR",
    paymentRequired: false,
    durationDays: 14,
    ...overrides,
  });
}

async function test(name, callback) {
  try {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
}

async function expectValid(document) {
  await document.validate();
}

async function expectInvalid(document, expectedMessage) {
  try {
    await document.validate();
  } catch (error) {
    if (error.message.includes(expectedMessage)) {
      return;
    }

    throw new Error(
      `Expected "${expectedMessage}", received "${error.message}"`
    );
  }

  throw new Error(
    `Expected validation failure containing "${expectedMessage}"`
  );
}

async function runTests() {
  const grantorId = new mongoose.Types.ObjectId();
  const offerId = new mongoose.Types.ObjectId();

  await test(
    "Platform-offer trial is valid without manual grantor",
    async () => {
      await expectValid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
        })
      );
    }
  );

  await test(
    "Manual trial is valid with grantor and reason",
    async () => {
      await expectValid(
        makeTrial({
          trialSource: "MANUAL_GRANT",
          trialGrantedBy: grantorId,
          trialReason: "Approved by Super Admin",
        })
      );
    }
  );

  await test(
    "Platform trial rejects missing offer ID",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferVersion: 1,
        }),
        "Platform trial requires platformTrialOfferId"
      );
    }
  );

  await test(
    "Platform trial rejects missing offer version",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
        }),
        "Platform trial requires a valid offer version"
      );
    }
  );

  await test(
    "Platform trial rejects a manual grantor",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
          trialGrantedBy: grantorId,
        }),
        "Platform trial cannot have trialGrantedBy"
      );
    }
  );

  await test(
    "Platform trial rejects a manual reason",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
          trialReason: "Manual approval",
        }),
        "Platform trial cannot have a manual trialReason"
      );
    }
  );

  await test(
    "Manual trial rejects missing grantor",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "MANUAL_GRANT",
          trialReason: "Approved by Super Admin",
        }),
        "Manual trial requires trialGrantedBy"
      );
    }
  );

  await test(
    "Manual trial rejects missing reason",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "MANUAL_GRANT",
          trialGrantedBy: grantorId,
        }),
        "Manual trial requires a reason"
      );
    }
  );

  await test(
    "Manual trial rejects a short reason",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "MANUAL_GRANT",
          trialGrantedBy: grantorId,
          trialReason: "No",
        }),
        "Manual trial requires a reason"
      );
    }
  );

  await test(
    "Manual trial rejects a platform offer snapshot",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "MANUAL_GRANT",
          trialGrantedBy: grantorId,
          trialReason: "Approved by Super Admin",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
        }),
        "Manual trial cannot have a platform offer snapshot"
      );
    }
  );

  await test(
    "Trial rejects payment requirement",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
          paymentRequired: true,
        }),
        "Trial subscription cannot require payment"
      );
    }
  );

  await test(
    "Trial rejects non-zero amount",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
          amount: 100,
        }),
        "Trial subscription amount must be 0"
      );
    }
  );

  await test(
    "Trial rejects missing duration",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "PLATFORM_OFFER",
          platformTrialOfferId: offerId,
          platformTrialOfferVersion: 1,
          durationDays: null,
        }),
        "Trial subscription requires durationDays"
      );
    }
  );

  await test(
    "Unknown trial source is rejected",
    async () => {
      await expectInvalid(
        makeTrial({
          trialSource: "UNKNOWN_SOURCE",
        }),
        "trialSource"
      );
    }
  );

  await test(
    "Legacy manual trial remains valid without trialSource",
    async () => {
      await expectValid(
        makeTrial({
          trialGrantedBy: grantorId,
          trialReason: "Legacy manual grant",
        })
      );
    }
  );

  console.log("\n--------------------------------");
  console.log(`Subscription Model: ${passed} PASS / ${failed} FAIL`);
  console.log("--------------------------------");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runTests()
  .catch((error) => {
    console.error("Unexpected test error:", error);
    process.exitCode = 1;
  });
