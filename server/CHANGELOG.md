# Changelog

All notable changes to the Subscription & Entitlement Stack are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Phases are numbered per the master roadmap (`32.16.15.X`).

---

## [Unreleased]

### Pending Phases (from 32.16.15)
- 32.16.15.12 — Subscription entitlement snapshot
- 32.16.15.13 — Existing subscription compatibility
- 32.16.15.14 — Entitlement regression tests
- 32.16.15.15 — Trial ON/OFF regression
- 32.16.15.16 — Plan version regression
- 32.16.15.17 — Feature/limit change regression
- 32.16.15.18 — Final entitlement security regression

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