
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const TrialEligibilityClaim = require(
  "../../models/TrialEligibilityClaim"
);

const id = () => new mongoose.Types.ObjectId();

const baseFields = () => ({
  instituteId: id(),
  subscriptionId: id(),
  planId: id(),
  planVersionId: id(),
  planVersion: 1,
});

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  ${error.message}`);
  }
};

const makePlatformClaim = (overrides = {}) =>
  new TrialEligibilityClaim({
    ...baseFields(),
    source: "PLATFORM_OFFER",
    platformTrialOfferId: id(),
    platformTrialOfferVersion: 1,
    trialGrantedBy: null,
    trialReason: null,
    ...overrides,
  });

const makeManualClaim = (overrides = {}) =>
  new TrialEligibilityClaim({
    ...baseFields(),
    source: "MANUAL_GRANT",
    platformTrialOfferId: null,
    platformTrialOfferVersion: null,
    trialGrantedBy: id(),
    trialReason: "Approved exceptional trial grant",
    ...overrides,
  });

test("Valid platform-offer claim passes validation", () => {
  const claim = makePlatformClaim();
  assert.equal(claim.validateSync(), undefined);
});

test("Valid manual-grant claim passes validation", () => {
  const claim = makeManualClaim();
  assert.equal(claim.validateSync(), undefined);
});

test("Platform claim rejects missing offer ID", () => {
  const claim = makePlatformClaim({
    platformTrialOfferId: null,
  });

  assert.ok(claim.validateSync());
});

test("Platform claim rejects missing offer version", () => {
  const claim = makePlatformClaim({
    platformTrialOfferVersion: null,
  });

  assert.ok(claim.validateSync());
});

test("Manual grant rejects missing grantor", () => {
  const claim = makeManualClaim({
    trialGrantedBy: null,
  });

  assert.ok(claim.validateSync());
});

test("Manual grant rejects missing reason", () => {
  const claim = makeManualClaim({
    trialReason: null,
  });

  assert.ok(claim.validateSync());
});

test("Manual grant rejects a short reason", () => {
  const claim = makeManualClaim({
    trialReason: "Too short",
  });

  assert.ok(claim.validateSync());
});

test("Unknown claim source is rejected", () => {
  const claim = makePlatformClaim({
    source: "UNKNOWN",
  });

  assert.ok(claim.validateSync());
});

test("Invalid plan version is rejected", () => {
  const claim = makePlatformClaim({
    planVersion: 0,
  });

  assert.ok(claim.validateSync());
});

test("Claim requires Institute ID", () => {
  const claim = makePlatformClaim({
    instituteId: null,
  });

  assert.ok(claim.validateSync());
});

test("Claim requires subscription ID", () => {
  const claim = makePlatformClaim({
    subscriptionId: null,
  });

  assert.ok(claim.validateSync());
});

test("Schema defines unique lifetime Institute claim index", () => {
  const indexes = TrialEligibilityClaim.schema.indexes();

  const instituteIndex = indexes.find(
    ([fields, options]) =>
      fields.instituteId === 1 &&
      options.unique === true &&
      options.name ===
        "unique_lifetime_trial_claim_per_institute"
  );

  assert.ok(instituteIndex);
});

test("Schema defines unique subscription claim index", () => {
  const indexes = TrialEligibilityClaim.schema.indexes();

  const subscriptionIndex = indexes.find(
    ([fields, options]) =>
      fields.subscriptionId === 1 &&
      options.unique === true &&
      options.name ===
        "unique_trial_claim_per_subscription"
  );

  assert.ok(subscriptionIndex);
});

test("Claim source and Institute ID are immutable schema fields", () => {
  assert.equal(
    TrialEligibilityClaim.schema.path("source").options.immutable,
    true
  );

  assert.equal(
    TrialEligibilityClaim.schema.path("instituteId").options.immutable,
    true
  );
});

console.log("\n--------------------------------");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log("--------------------------------");

if (failed > 0) {
  process.exitCode = 1;
}
