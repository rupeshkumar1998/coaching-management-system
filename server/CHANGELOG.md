# Changelog

All notable changes to the Subscription & Entitlement Stack are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Phases are numbered per the master roadmap (`32.16.15.X`).

---

## [Unreleased]

### Pending Phases (from 32.16.15)
- 32.16.15.15 — Trial ON/OFF regression
- 32.16.15.16 — Plan version regression
- 32.16.15.17 — Feature/limit change regression
- 32.16.15.18 — Final entitlement security regression


## [32.16.15.14] - 2026-11-08

### Added — Entitlement Regression: Permission ↔ Entitlement Boundary

**Context:** Section 5 of the phase plan (permission vs entitlement
independence). The rest of the phase plan was already covered by
previous phases — this entry consolidates the coverage map and adds
the missing boundary tests.

### Boundary Tests Added (8 new tests):

**Part A — Contract-level (4 tests):**
- A1: `permissionMiddleware.js` does NOT import `entitlementService`
- A2: `entitlementService.js` does NOT import `permissionMiddleware`
- A3: SUPER_ADMIN bypasses permission, but entitlement still evaluates
- A4: INSTITUTE_OWNER bypasses permission, but entitlement still evaluates

**Part B — API integration (4 tests):**
- B1: Permission ✓ + Entitlement ✓ → 200
- B2: Permission ✗ + Entitlement ✓ → 403 (permission denies first, no `reason` field)
- B3: Permission ✓ + Entitlement ✗ → 403 (has `reason` field)
- B4: Permission ✗ + Entitlement ✗ → 403 (permission short-circuits)

### Already Covered by Previous Phases (consolidated map):

| Section (from plan) | Covered by | Tests |
|---------|-----------|------|
| §1 Test flow | All existing test files | — |
| §2 Core entitlement | `.10` | 40 |
| §3 Historical version regression | `.10` + `.12` + `.9.16` | 5+ |
| §4 Tenant isolation | `.10` + `.9.16` | 9+ |
| **§5 Permission vs entitlement** | **`.14` (this phase)** | **8** |
| §6 Snapshot integrity | `.12` + `.13` + `.9.4` | 80+ |
| §7 Test organization | Kept current structure (no reorg) | — |
| §8 Test environment rules | All existing files follow | — |
| §9 When to run | Master runner | — |
| §10 Completion criteria | All met (see below) | — |

### Completion Criteria — Verified:

- [x] Entitlement service tests pass (`.10` — 40 tests)
- [x] Subscription status tests pass (`.10` — covered)
- [x] Historical version regression (`.10`, `.12`, `.9.16`)
- [x] Snapshot integrity tests (`.12` — 53 tests)
- [x] Cross-tenant tests (`.10` — 5, `.9.16` — 4)
- [x] Permission-vs-entitlement tests (`.14` — 8 new)
- [x] Legacy compatibility (`.13` — 15 tests)
- [x] Failure cases grant no unauthorized access (fail-closed everywhere)

### Tests:
- 8 new tests → 436 total tests, 0 failures

### References:
- New test file: `tests/api/test-permission-entitlement-boundary.js`
- Depends on: `.10` (Entitlement), `.11` (Limit), `.12` (Snapshot), `.13` (Legacy)

----
## [32.16.15.13] - 2026-11-08

### Status: Compatibility Verified

**Context:** Production has no legacy subscriptions (system not yet
deployed). This phase formally verifies that legacy code paths
continue to work correctly for any future legacy data.

Verified (already implemented in previous phases):
- Historical price preservation (`.12` + `.9.15`)
- Snapshot immutability (`.12`)
- Legacy fallback in `validatePlanSnapshot` (`.9.x`)
- Fail-closed behavior in `entitlementService` (`.10.x`)
- Fail-closed behavior in `limitService` (`.11.x`)
- Active subscription rules (`.9.x`)
- Payment history preservation (`.9.15`)
- DB unique index on active subscriptions

Added:
- 15 formal tests covering legacy code paths
- Guard comments in 3 services to prevent accidental removal:
  * `subscriptionService.js` — validatePlanSnapshot fallback
  * `entitlementService.js` — ENTITLEMENT_SNAPSHOT_MISSING path
  * `limitService.js` — LIMIT_NOT_CONFIGURED path
- This CHANGELOG entry documenting the compatibility contract

Skipped (not applicable):
- §2 Migration strategy — no production data
- §3 Subscription mapping — no legacy subs to map
- §5 Migration statuses — no migration in flight
- §7 Dry-run tooling — nothing to dry-run

Tests:
- 15 new tests → 428 total tests, 0 failures
- Groups:
  * A (4): Legacy subscription structure
  * B (3): validatePlanSnapshot fallback
  * C (3): entitlementService fail-closed behavior
  * D (2): limitService fail-closed behavior
  * E (3): Status transitions, immutability, no auto-upgrade

References:
- Protected by: `tests/services/test-legacy-subscription-compatibility.js`
- Depends on: `.12` Snapshot integrity, `.10` Entitlement, `.11` Limit

---

## [32.16.15.12] - 2026-11-07

### Added — Subscription Entitlement Snapshot

**Context:** Centralized snapshot creation across STANDARD and TRIAL
subscription flows. Standardized audit metadata.

Features:
- `snapshotCapturedAt` field on `Subscription` (immutable, audit proof)
- Central `buildSubscriptionSnapshot()` helper (DRY)
- Unified snapshot shape across STANDARD and TRIAL flows
- STANDARD registration now fully atomic via MongoDB transaction
- Legacy subscriptions preserve null `snapshotCapturedAt`

Architecture decisions:
- Flat snapshot structure (features/limits at top-level) + capturedAt
  metadata — not nested `entitlementSnapshot` — to preserve existing
  shape and avoid breaking existing tests
- Snapshot source of truth: immutable `SubscriptionPlanVersion`
- Runtime enforcement continues to use `validatePlanSnapshot()`

Atomicity:
- STANDARD registration: Institute + Admin + Subscription + Payment
  created in one transaction (previously used compensating deletes)
- TRIAL registration: unchanged (already atomic at service layer)
- Process crashes mid-flow cannot leave orphan records

Tests:
- 53 new tests (snapshot builder 25 + creation 14 + service regression 14)
- 413 total tests at time of this phase

Commit Reference:
- Commit: "32.16.15.12 COMPLETE — Subscription Entitlement Snapshot"
- Tags: `subscription-snapshot-v1.0`, `phase-32.16.15.12`

---

## [32.16.15.11] - 2026-11-07

### Added — Limit Service
- Central limit decision engine (checkLimit, reserveLimit, releaseLimit)
- Atomic reservation via UsageCounter with race-safe $inc guards
- Registry/strategy pattern for pluggable per-resource counters
- 4 production counters: MAX_STUDENTS, MAX_TEACHERS, MAX_ADMINS, MAX_PARENTS
- 9 pending counters fail closed (RESOURCE_NOT_IMPLEMENTED)
- Bulk dashboard endpoint (getLimitStatus, getAllLimitStatuses)
- Feature dependency enforced before limit check
- UTC-based monthly period policy (V1)

### Tests
- 101 tests passing

### Commit Reference
- Commit: "32.16.15.11 COMPLETE — Limit Service"
- Tag: `limit-service-v1.0`, `phase-32.16.15.11`

---

## [32.16.15.10] - 2026-11-06

### Added — Entitlement Service
- Central feature access resolver (checkFeatureAccess, hasFeature)
- Bulk entitlements endpoint (getInstituteEntitlements)
- Immutable subscription feature snapshot as source of truth
- CORE feature protection: fail-closed on corruption
- Legacy snapshot handling (ENTITLEMENT_SNAPSHOT_MISSING)

### Tests
- 40 tests passing

### Commit Reference
- Tag: `phase-32.16.15.10`

---

## [32.16.15.9] - 2026-11-05

### Added — Super Admin Plan Management Boundary

**Naming note:** This phase is canonically titled "Super Admin plan management boundary."
The commit message from that time reads "Subscription Plan Management" — both describe
the same delivered scope. The commit is preserved for historical accuracy; this
CHANGELOG entry documents the canonical phase name.

Delivered:
- Immutable published plan versions (DRAFT → PUBLISHED → RETIRED)
- Existing subscription snapshot protection
- Financial integrity (Payment ↔ Subscription ↔ PlanVersion)
- Audit logging for all plan changes (10 events)
- Role-based write boundaries (5 roles × 4 endpoints)

### Tests
- 219 tests passing

### Commit Reference
- Commit: "32.16.15.9 COMPLETE — Subscription Plan Management"
- Tag: `subscription-plan-v1.0`, `phase-32.16.15.9`