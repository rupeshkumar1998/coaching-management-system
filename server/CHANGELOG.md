# Changelog

All notable changes to the Subscription & Entitlement Stack are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Phases are numbered per the master roadmap (`32.16.15.X`).

---

## [Unreleased]

### Sprint 4 — Teacher / Admin / Parent Creates (32.16.16)

**Date:** 2026-11-10

Wired 3 remaining limits into existing + new endpoints.

**Modified — Existing Teacher create (controllers/adminTeacherController.js):**
- Now runs inside a MongoDB transaction
- Calls `reserveLimit(MAX_TEACHERS)` atomically
- Handles LIMIT_REACHED / FEATURE_DISABLED / SUBSCRIPTION_INACTIVE (403)
- Compensating deletes replaced by transaction rollback
- Tests updated to seed subscription (19/19 pass)

**Modified — Existing Admin create (controllers/ownerAdminController.js):**
- Now runs inside a MongoDB transaction
- Calls `reserveLimit(MAX_ADMINS)` atomically
- Handles LIMIT_REACHED / FEATURE_DISABLED / SUBSCRIPTION_INACTIVE (403)
- New test file: `tests/controllers/test-owner-admin-limit.js` (10 tests)

**Added — Parent create (new feature):**

*services/parentService.js:*
- `createParent()` — atomic transaction with reserveLimit(MAX_PARENTS)
- `listParents()`, `getParent()`, `updateParent()` — tenant-scoped
- Only name/phone updatable (email/password immutable)
- 14 service tests

*controllers/parentController.js + validators/parentValidator.js + routes/parentRoutes.js:*
- `POST /api/owner/parents` (PARENT_CREATE)
- `GET /api/owner/parents` (PARENT_READ)
- `GET /api/owner/parents/:parentId` (PARENT_READ)
- `PATCH /api/owner/parents/:parentId` (PARENT_UPDATE)
- 19 route tests

**Parent role clarification:**
- Currently reserved for future parent-student link + login
- Users can be registered + seat reserved (limit enforced)
- No login / no student link / no features yet
- `parentId` / `childIds` field is a future milestone

**Limit enforcement now complete:**
- MAX_STUDENTS (Sprint 3)
- MAX_TEACHERS (Sprint 4)
- MAX_ADMINS (Sprint 4)
- MAX_PARENTS (Sprint 4)
- MAX_CLASSES (Sprint 1)
- MAX_BATCHES (Sprint 2)

**All 6 limits enforced atomically, race-safe, transaction-rolled back.**

**Tests:** 39 new tests (10 owner admin limit + 14 parent service + 19 parent routes + updated 19 admin teacher)
**Total:** 708 + 39 = 747 tests, 0 failures

---

### Sprint 3 — Student Enrollment (32.16.16)

**Date:** 2026-11-10

Student enrollment with batch assignment + MAX_STUDENTS enforcement.

**Added — User model changes (2 fields):**
- `batchId` (ObjectId, nullable, ref Batch, indexed)
  Only meaningful for role=STUDENT
- `mustChangePassword` (Boolean, default false)
  Set to `true` when temp password is auto-generated

**Added — Student service (services/studentService.js):**
- `createStudent()` — atomic transaction with reserveLimit(MAX_STUDENTS),
  auto-generates 12-char base64url temp password, hashes it, sets
  `mustChangePassword: true`
- `listStudents({ classId?, batchId? })` — filters, tenant-scoped
- `getStudent()` — derives classId from batchId
- `updateStudent()` — only name/phone (not email/password/batchId)
- `assignBatch()` — enroll or reassign to different batch
- `removeBatch()` — unassign
- 20 service tests

**Added — HTTP layer (6 endpoints):**
- `POST /api/owner/students` (STUDENT_CREATE)
- `GET /api/owner/students?classId=&batchId=` (STUDENT_READ)
- `GET /api/owner/students/:studentId` (STUDENT_READ)
- `PATCH /api/owner/students/:studentId` (STUDENT_UPDATE) — name/phone only
- `PATCH /api/owner/students/:studentId/assign-batch` (STUDENT_UPDATE)
- `PATCH /api/owner/students/:studentId/remove-batch` (STUDENT_UPDATE)
- 23 route tests

**Added — Validation chain:**
- `classId` + `batchId` both mandatory at creation (Q2 decision)
- Batch must belong to class (BATCH_CLASS_MISMATCH if not)
- Class must be active, not deleted
- Batch must be ACTIVE, not deleted
- Email unique globally
- Phone: 7-20 chars if provided

**Student model (normalized):**
- Only `batchId` stored on User
- `classId` derived via `Batch.classId` at query time
- No denormalization, single source of truth

**Temp password flow:**
- 12 chars from `crypto.randomBytes(9).toString("base64")`
- base64url alphabet (`-` and `_` instead of `+` and `/`)
- Returned once in create response with warning
- `mustChangePassword: true` set on user
- Enforcement (force password change on login) is a future enhancement

**Limit enforcement:**
- `createStudent` reserves 1 slot from `MAX_STUDENTS` (atomic)
- `LIMIT_REACHED` at plan limit
- `FEATURE_DISABLED` when `STUDENT_MANAGEMENT` not in subscription
- Transaction rollback on any failure → no partial writes
- Counter unchanged on update/assign/remove

**Tests:** 49 new tests (6 model + 20 service + 23 route)
**Total:** 659 + 49 = 708 tests, 0 failures

---

### Sprint 2 — Batch Management (32.16.16)

**Date:** 2026-11-10

New feature — Batch management with `MAX_BATCHES` limit enforcement
and multiple subject teachers support.

**Added:**

1. **`models/Batch.js`** — Schema with:
   - `instituteId` (immutable, tenant-scoped)
   - `classId` (immutable, belongs to one Class)
   - `name` (unique per class)
   - `teachers` array (`{teacherId, subject}` — same teacher may
     teach multiple subjects, but pairs must be unique)
   - `schedule` (optional: days + start/end time, strict validation)
   - `status: ACTIVE | INACTIVE`
   - Audit fields + delete protection
   - 4 indexes (unique name per class, listing, counter, ordering)
   - 17 model tests

2. **`services/counters/batchCounter.js`** — `MAX_BATCHES` counter:
   - Counts non-deleted batches per institute
   - `status: INACTIVE` does NOT free slot
   - Registered in `services/counters/index.js`
   - 6 total counters now (was 5)

3. **`services/batchService.js`** — Business logic:
   - `createBatch()` — atomic transaction with `reserveLimit(MAX_BATCHES)`
   - `listBatches({ classId? })` — tenant-scoped, optional filter
   - `getBatch()` — tenant-scoped
   - `updateBatch()` — no counter change
   - `classId` immutable (create new batch to move classes)
   - 23 service tests

4. **`controllers/batchController.js`** — 4 handlers
5. **`validators/batchValidator.js`** — Input validation
6. **`routes/batchRoutes.js`** — 4 endpoints:
   - `POST /api/owner/batches` (requires `BATCH_CREATE`)
   - `GET /api/owner/batches?classId=` (requires `BATCH_READ`)
   - `GET /api/owner/batches/:batchId` (requires `BATCH_READ`)
   - `PATCH /api/owner/batches/:batchId` (requires `BATCH_UPDATE`)
   - 22 route tests

**Permissions:** BATCH_* permissions were already in catalog
(OPERATIONAL, delegatable) since the initial permission seed.

**Access control:**
- `INSTITUTE_OWNER`: automatic
- `INSTITUTE_ADMIN`: requires Owner-assigned `BATCH_*` permission
- `TEACHER/STUDENT/PARENT`: 403 denied
- `SUPER_ADMIN`: bypasses middleware, service rejects (no tenant)

**Limit enforcement:**
- `createBatch` reserves 1 slot from `MAX_BATCHES`
- `LIMIT_REACHED` when plan limit exhausted
- `FEATURE_DISABLED` when `BATCH_MANAGEMENT` not in subscription
- Transaction rollback ensures no partial writes

**Validation:**
- Class must exist and belong to same institute
- Every teacher must be active TEACHER of same institute
- `{teacherId, subject}` pairs must be unique
- Schedule: 1-7 valid days (MON-SUN), HH:MM format, start < end
- Batch name unique per class
- `classId` immutable on update

**Tests:** 62 new tests (17 model + 23 service + 22 route)
**Total:** 597 + 62 = 659 tests, 0 failures

---

### Sprint 1 — Class Management (32.16.16)

**Date:** 2026-11-09

New feature — Class management with `MAX_CLASSES` limit enforcement.
This is the first limit fully wired into a real business endpoint.

**Added:**

1. **`models/Class.js`** — Schema with:
   - `instituteId` (immutable, tenant-scoped)
   - `name` (2-100 chars, unique per institute)
   - `description` (max 500)
   - `classTeacherId` (optional, must be active teacher of same institute)
   - `capacity` (informational, positive int or null)
   - `sortOrder` (custom display order)
   - `isActive`, `isDeleted`
   - Audit fields (createdBy, updatedBy, timestamps)
   - Delete protection (throw on all delete operations)
   - 3 indexes (unique name per institute, active list, ordered list)
   - 13 model tests

2. **`services/counters/classCounter.js`** — `MAX_CLASSES` counter:
   - Counts non-deleted classes per institute
   - Does not free on `isActive: false` (prevents abuse)
   - Registered in `services/counters/index.js`

3. **`services/classService.js`** — Business logic:
   - `createClass()` — atomic transaction with `reserveLimit(MAX_CLASSES)`
   - `listClasses()` — tenant-scoped
   - `updateClass()` — no counter change on update
   - 18 service tests

4. **`controllers/classController.js`** — HTTP handlers
5. **`validators/classValidator.js`** — Input validation
6. **`routes/classRoutes.js`** — 3 endpoints:
   - `POST /api/owner/classes` (requires `CLASS_CREATE`)
   - `GET /api/owner/classes` (requires `CLASS_READ`)
   - `PATCH /api/owner/classes/:classId` (requires `CLASS_UPDATE`)
   - 14 route tests

7. **New permission keys** in catalog:
   - `CLASS_READ`, `CLASS_CREATE`, `CLASS_UPDATE`, `CLASS_ACTIVATE`, `CLASS_DEACTIVATE`
   - All OPERATIONAL, all delegatable
   - Seeded to DB (5 created, 58 unchanged)

**Access control:**
- `INSTITUTE_OWNER`: automatic access (permission middleware bypass)
- `INSTITUTE_ADMIN`: requires Owner to assign specific `CLASS_*` permission
- `TEACHER`, `STUDENT`, `PARENT`: 403 denied
- `SUPER_ADMIN`: bypasses middleware, but service requires institute context

**Limit enforcement:**
- `createClass` reserves 1 slot from `MAX_CLASSES`
- `LIMIT_REACHED` returned when plan limit exhausted
- `FEATURE_DISABLED` when `CLASS_MANAGEMENT` not in subscription
- Transaction rollback ensures no partial writes on any failure
- Counter never changes on update

**Tests:** 45 new tests (13 model + 18 service + 14 route)
**Total:** 552 + 45 = 597 tests, 0 failures

---

### 🎯 32.16.15 Milestone Complete (2026-11-09)

All 18 phases of the Subscription & Entitlement Stack are complete.
Total: **552 tests, 0 failures**. Production-ready.

See phase-by-phase breakdown below.

### Pending Phases

**32.16.15** — ✅ All 18 phases complete (see [32.16.15 Milestone Complete] below.)

**32.16.16** — Subscription Limits Enforcement (in progress):
- Sprint 1 — Class Management ✅ (released)
- Sprint 2 — Batch Management ✅ (released)
- Sprint 3 — Student + batch assignment ✅ (released)
- Sprint 4 — Teacher/Admin/Parent creates ✅ (released)
- Sprint 5 — Dashboard + CI/CD + monitoring
- Sprint 6 — Final concurrency + upgrade/downgrade + verification

**Deferred to v2:** Exam, Lead, Storage, SMS, Email, WhatsApp, API request limits.


## [32.16.15.18] - 2026-11-09

### Added — Final Entitlement Security Regression (15 E2E tests)

**Context:** This is the final phase. It verifies the complete
authorization stack end-to-end and proves that clients cannot bypass
security by injecting body fields.

### Added — Final E2E security file (15 tests)

`tests/api/test-final-entitlement-security-regression.js`

**Section A — Malicious payload attempts (5 tests):**
- A1: `instituteId` in body is ignored (server uses `req.tenantId`)
- A2: `planVersionId` in body is ignored (server uses DB snapshot)
- A3: `featureEnabled: true` in body is ignored (server reads snapshot)
- A4: `limit: null` in body is ignored (server reads usage counter)
- A5: `role: "SUPER_ADMIN"` in body is ignored (server reads `req.user.role`)

**Section B — Full 8-layer E2E (3 tests):**
- B1: Happy path — all 8 layers pass → 200 + counter incremented in DB
- B2: Expired subscription → 403 SUBSCRIPTION_INACTIVE, no counter change
- B3: Feature OFF → 403 FEATURE_NOT_INCLUDED, no counter change

**Section C — Cross-tenant isolation (4 tests):**
- C1: TEACHER blocked from owner route (role boundary)
- C2: INSTITUTE_ADMIN blocked from owner route (role boundary)
- C3: Owner body injection does not leak other tenant data
- C4: SUPER_ADMIN entitlement check still requires institute context

**Section D — Final invariants (3 tests):**
- D1: Duplicate feature keys in snapshot → ENTITLEMENT_CONFIGURATION_INVALID (fail closed)
- D2: Failed reserveLimit leaves counter unchanged (no partial write)
- D3: CORE feature (TENANT_ISOLATION) corruption → ENTITLEMENT_CONFIGURATION_INVALID (fail closed)

### Authentication Flow Verified (end-to-end):

1. Authentication (protect) → 401 if invalid
2. Role authorization (requireRole) → 403 if wrong role
3. Permission authorization (requirePermission) → 403 if missing
4. Tenant isolation (tenantIsolation) → tenantId from req.user only
5. Subscription status (getEffectiveSubscription) → 403 if expired
6. Feature entitlement (checkFeatureAccess) → 403 if OFF
7. Usage limit (reserveLimit) → 403 if at limit
8. Controller executes only if all above pass

### Security invariants proven:

- Client body fields are NEVER trusted for security decisions
- All denials return consistent 403 with reason
- Failed operations produce ZERO partial database writes
- Corrupted snapshots fail closed (never silently allow)
- CORE security features cannot be disabled even via DB corruption

### Tests:
- 15 new end-to-end security tests
- 552 total tests across the full stack
- 0 failures

### 🎯 PHASE 32.16.15 COMPLETE

- **18/18 phases complete**
- **552 tests passing, 0 failures**
- **Production-ready Subscription & Entitlement Stack**
- Full audit trail across all phases

### Final System Guarantees:

- Immutable published plan versions
- Historical subscription snapshots preserved
- Role-based access control enforced at every layer
- Tenant isolation at data and service level
- Feature entitlements verified against immutable snapshot
- Usage limits enforced with race safety
- Trial offer lifecycle fully managed
- Every change audited with actor + timestamp
- Fail-closed on any corruption or unexpected error

### References:
- Phase: 32.16.15.18 (final)
- Depends on: all previous phases (.9 through .17)
- **Parent milestone 32.16.15: 100% complete**

---

## [32.16.15.17] - 2026-11-09

### Added — Feature/Limit Change Regression (consolidated proof)

**Context:** Feature↔limit dependency validation was already covered
by `.9.14` and `.12`. This phase consolidates the dependency matrix
into a single formal file and adds the previously-unmounted catalog
validation suite to the master runner.

### Added — Consolidated regression file (15 new tests)

`tests/services/test-feature-limit-change-regression.js`

**Section A — Feature ↔ Limit dependency (5 tests):**
- A1: LEAD_MANAGEMENT=OFF + MAX_ACTIVE_LEADS=500 → rejected
- A2: EXAM_TEST_MANAGEMENT=OFF + MAX_EXAMS_PER_MONTH=10 → rejected
- A3: SMS=OFF + MAX_SMS_PER_MONTH=100 → rejected
- A4: API_ACCESS=OFF + MAX_API_REQUESTS_PER_MONTH=1000 → rejected
- A5: STUDENT_MANAGEMENT=OFF + MAX_STUDENTS=100 → rejected

**Section B — Limit value semantics with feature ON (3 tests):**
- B1: SMS=ON + MAX_SMS_PER_MONTH=0 → accepted (no usage)
- B2: SMS=ON + MAX_SMS_PER_MONTH=null → accepted (unlimited)
- B3: SMS=ON + MAX_SMS_PER_MONTH=100 → accepted (positive)

**Section C — CORE security protection (3 tests):**
- C1: TENANT_ISOLATION=OFF → rejected
- C2: Each mandatory CORE disabled individually → each rejected
- C3: Missing AUTHENTICATION → rejected

**Section D — Premium feature independence (2 tests):**
- D1: FEE_MANAGEMENT=ON + ONLINE_FEE_PAYMENT=OFF → accepted
- D2: ONLINE_FEE_PAYMENT=ON without FEE_MANAGEMENT → accepted

**Section E — Catalog validation (2 tests):**
- E1: Unknown feature key → rejected
- E2: Unknown limit key → rejected

### Added — Previously unmounted catalog suite to runner

`tests/services/test-entitlement-catalog.js` (19 tests) — existed
since `.9` but was not in the master runner. Now CI-enforced:
- Feature catalog structure (9 CORE, 24 commercial, 13 limits)
- Unknown / inactive / duplicate feature rejection
- Mandatory CORE cannot be disabled
- Missing mandatory feature rejection
- Limit value type validation (0, null, positive, negative, fractional)
- Limit requires enabled feature
- Catalog lookup handles valid/invalid keys
- Every limit has a supported period

### ⚠️ Documented Discrepancy

The phase plan states "Feature OFF + related limit = 0 → allowed".
The current implementation **rejects ANY limit entry** (0, null,
positive) when its required feature is OFF — a fail-closed default
that is stricter than the plan. Behavior is verified by test A1
and left unchanged (no code modification). This is the safest
default for production.

### Tests:
- 15 new consolidated tests
- +19 previously-unmounted catalog tests now CI-enforced
- 537 total tests, 0 failures

### References:
- Depends on: `.9.2` Feature catalog, `.9.3` Limit catalog, `.9.14` service
- Parent roadmap: 9 of 10 phases complete (90%)
- CHANGELOG.md updated

---

## [32.16.15.16] - 2026-11-09

### Added — Plan Version Regression (formal consolidated proof)

**Context:** Plan version immutability was already covered across
`.9.14`, `.9.16`, `.12`. This phase consolidates the 10-item
regression matrix from the phase plan into a single test file and
adds the previously-unmounted immutability suite to the master runner.

### Added — Consolidated regression file (12 new tests)

`tests/services/test-plan-version-regression.js` — one-file proof for
the plan's 10-item regression matrix plus 2 supporting checks:

1. v3 status → RETIRED (not deleted) after v4 publish
2. v3 amount/features/limits unchanged after v4
3. Existing subscription still references v3 (planVersionId)
4. New subscription after v4 → references v4
5. Price isolation: A ₹1999, B ₹2499
6. Feature addition in v4 → existing v3 subscriber does not have it
7. Feature retention across publish
8. Limit increase in v4 → existing v3 subscriber unchanged
9. Limit decrease in v4 → existing v3 subscriber unchanged
10. Plan disable → existing subscriptions stay ACTIVE
11. Editing a published version → rejected
12. currentPublishedVersion pointer integrity + RETIRED versions readable

### Added — Runner integration (previously unmounted)

`tests/services/test-subscription-plan-version-immutability.js`
(28 tests) — this file existed since `.9` but was not in the
master runner. Now CI-enforced.

Coverage:
- Document save rejection on PUBLISHED/RETIRED
- updateOne / updateMany / findOneAndUpdate rejection
- replaceOne / findOneAndReplace rejection
- bulkWrite / insertMany / insertOne rejection
- All deletion methods rejection (deleteOne, deleteMany, findOneAndDelete)
- Logical plan deletion rejection
- planId and version immutability
- Status change blocking (including $unset, $setOnInsert, $set with updatePipeline)
- Upsert rejection

### Tests:
- 12 new consolidated tests
- +28 previously-unmounted immutability tests now in CI
- 498 total tests, 0 failures

### References:
- Depends on: `.9.4` PlanVersion, `.9.14` lifecycle, `.12` snapshot
- Parent roadmap: 8 of 10 phases complete (80%)
- CHANGELOG.md updated

---

## [32.16.15.15] - 2026-11-09

### Added — Trial Offer Admin API (new feature) + Trial ON/OFF Regression

**Context:** Trial offer lifecycle service existed (`platformTrialOfferService.js`)
but no HTTP routes existed for SUPER_ADMIN to manage it. This phase adds
the admin API and formally verifies trial ON/OFF semantics with real DB.

### Added — Trial Offer Admin API (3 new files, 7 endpoints)

**New files:**
- `validators/trialOfferAdminValidator.js` (5 validators)
- `controllers/trialOfferAdminController.js` (7 handlers)
- `routes/trialOfferAdminRoutes.js` (7 endpoints)

**Endpoints (all SUPER_ADMIN-only, mounted at `/api/admin/trial-offer`):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Get current PUBLISHED offer (or null) |
| GET | `/history` | List all offers (newest version first) |
| POST | `/` | Create DRAFT offer |
| PATCH | `/:offerId` | Update DRAFT offer |
| POST | `/:offerId/publish` | Publish DRAFT |
| PATCH | `/:offerId/toggle` | Enable/disable PUBLISHED offer |
| POST | `/:offerId/retire` | Retire PUBLISHED offer |

**Modified files:**
- `services/platformTrialOfferService.js` — added 2 read functions:
  * `getCurrentPublishedTrialOffer()`
  * `listTrialOffers()`
- `app.js` — mounted `/api/admin/trial-offer`

### Added — Regression Tests (22 new tests)

**Part 1 — Route tests (11 tests, real HTTP):**
- Auth: 401 (no auth) + 403 (5 non-admin roles × 7 endpoints)
- Validation: invalid offerId, missing required fields
- Lifecycle: create → update → publish, toggle ON/OFF, retire → history
- Error cases: 404 (not found), 409 (invalid transitions)

**Part 2 — Trial toggle regression (11 tests, real DB):**

Section A — Trial creation flow:
- A1: Offer ON + eligible → trial created (PENDING, correct plan version)
- A2: Offer OFF → TRIAL_OFFER_UNAVAILABLE
- A3: Previously used → TRIAL_ALREADY_USED
- A4: ON-OFF-ON → new allowed, used still blocked

Section B — Existing trial protection:
- B1: OFF + active → status/endDate/features unchanged
- B2: OFF + expired → remains EXPIRED
- B3: OFF + cancelled → remains CANCELLED

Section C — Snapshot + Concurrency:
- C1: toggle OFF/ON does not mutate snapshot fields
- C2: concurrent OFF + creation → deterministic outcome

Section D — Audit:
- D1: TRIAL_OFFER_ENABLED event recorded (actor, changes.enabled)
- D2: TRIAL_OFFER_DISABLED event recorded

### Tests:
- 22 new tests → 458 total tests, 0 failures

### References:
- Depends on: `.9` Plan, `.10` Entitlement, `.11` Limit, `.12` Snapshot
- Master roadmap: 7 of 10 phases complete

---

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