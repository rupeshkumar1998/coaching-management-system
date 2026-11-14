# Future Work — Backlog

Living backlog of known gaps, deferred features, and improvement ideas.
Updated after each milestone. Priority order is a suggestion; re-prioritize
based on real client feedback.

**Last updated:** 2026-11-14 (after 32.16.18 — Fees Management)

---

## 🔴 P0 — Must Do Before Serious Production

### 1. Audit Log Integration (Attendance + Fees)
**Gap:** `markStudentAttendance`, `updateStudentAttendance`, `deleteStudentAttendance`,
`createFee`, `recordPayment`, `refundPayment` — किसी का भी AuditLog entry नहीं बनता।
सिर्फ soft-delete fields (`deletedBy/At/Reason`) पर भरोसा।

**Impact:** किसी ने status बदला, amount बदला — कोई immutable trail नहीं।
Failed audits, disputes, या suspicious activity track नहीं हो सकती।

**Scope:**
- 8-10 hooks जोड़ें (attendance: 3, fee: 5, payment: 2)
- AuditLog में actor + timestamp + before/after diff
- Audit log read endpoint fees के लिए (attendance के लिए exists)

**Effort:** ~3 hrs (implementation + tests)
**Depends on:** Nothing (AuditLog model ready from .15.14)

---

### 2. Receipt PDF Generation
**Gap:** `Payment.receiptUrl` field है, पर कोई PDF generator नहीं।
Admin payment record करता है, पर parent को देने के लिए proper receipt नहीं।

**Impact:** Small institutes manual receipt (WhatsApp photo, notebook) पर depend करते हैं।
Professional image कम, GST/ITR records messy।

**Scope:**
- `POST /api/owner/fees/payments/:paymentId/receipt` → PDF stream response
- Or async: payment record होते ही PDF generate → S3/local upload → URL save
- Template: institute header, student details, amount, method, receipt number
- Numbering: financial-year series (e.g., `FEE/2026-27/001`)

**Library:** `pdfkit` (dependency-free, industry standard)
**Storage:** Local `uploads/receipts/` (MVP) or S3 (future)

**Effort:** ~4 hrs
**Depends on:** Nothing

---

## 🟠 P1 — Production Launch Essentials

### 3. Online Payment Gateway (Razorpay — India)
**Gap:** सिर्फ 3 methods (MANUAL_UPI, BANK_TRANSFER, ONLINE_GATEWAY reserved)।
Student खुद online pay नहीं कर सकता। Admin हमेशा middleman।

**Impact:** Cash collection track नहीं होता, late payment बढ़ता है।
Modern parents Razorpay/UPI expect करते हैं।

**Scope:**
- Razorpay SDK integration (`razorpay-node`)
- Webhook endpoint (`POST /api/webhooks/razorpay`) — payment.captured, payment.failed
- Student flow: `POST /api/student/fees/:feeId/initiate-payment` → Razorpay order
- Auto-create `Payment` record on webhook (status: PENDING → VERIFIED)
- Reconciliation: retry failed webhooks, signature verification
- Sandbox + production keys (env vars)

**Effort:** ~20 hrs (integration + webhook security + tests + sandbox flow)
**Depends on:** HTTPS deployment (`.20`), receipt PDF (nice to have)

---

### 4. Email / SMS Notifications
**Gap:** Due reminders, payment confirmation, overdue alerts — कुछ नहीं।

**Impact:** Parent को पता ही नहीं fees due है (जब तक admin बताए)।
Collection efficiency कम, follow-up calls बढ़ते हैं।

**Scope:**
- Provider: Resend (email) + Twilio/MSG91 (SMS India)
- Triggers:
  * Fee created → "New fee invoice"
  * 3 days before due → "Fee due soon"
  * Due date passed → "Overdue reminder"
  * Payment received → "Payment confirmation + receipt link"
- Template system (handlebars or similar)
- Send log (`Notification` collection for debugging)

**Effort:** ~8 hrs (integration + templates + trigger hooks + tests)
**Depends on:** Provider account setup, receipt PDF (for email attachment)

---

## 🟡 P2 — Post First Client

### 5. Parent-Student Link + Parent Portal
**Status:** Paused since handoff.
**Gap:** Parent role exists (data capture only) — login नहीं, link नहीं, features नहीं।

**Scope:**
- `ParentStudentLink` model (parent userId ↔ student userId, N:M for siblings)
- Parent login flow (same as student, separate role)
- `/api/parent/fees` — children की fees देखें
- `/api/parent/attendance` — children की attendance देखें
- Link management: admin/owner creates + assigns

**Effort:** ~8 hrs (link model + parent routes + tests + UI flow)
**Depends on:** Nothing critical, but better after `.18` fees stabilize

---

### 6. Fee Enhancements
Sub-features deferred from `.18`:

| Feature | Effort | Notes |
|---------|--------|-------|
| Structured discount/scholarship | ~2 hrs | `discount` field vs manual amount adjust |
| Installment plans | ~5 hrs | Fee → multiple scheduled installments |
| Late fee / penalty auto-apply | ~2 hrs | Cron job or on-login check |
| Bulk update fees | ~2 hrs | `PATCH /api/owner/fees/bulk` |
| Fee templates (per class/batch) | ~6 hrs | Auto-generate monthly fees |
| Fee reconciliation (bank statement) | ~6 hrs | CSV import + match |

---

### 7. Reports / Exports
**Gap:** Numbers visible (dashboard), पर downloadable नहीं।

**Scope:**
- CSV export: fees list, payments, outstanding, overdue
- Filters preserved on export (same as list)
- Include: attendance export (per batch, per date range)
- Later: PDF summary reports (monthly, quarterly)

**Effort:** ~3 hrs (CSV via `json2csv` or manual)

---

### 8. Attendance Follow-up Gaps
From `.17` production review (medium priority):

| Feature | Effort |
|---------|--------|
| Bulk update/delete attendance | ~2 hrs |
| Per-endpoint rate limits (attendance heavy) | ~1 hr |
| Teacher bulk single-mark endpoint | ~30 min |

---

## 🟢 P3 — Future / Nice to Have

### 9. Exam / Results Management
Not started. Full milestone later (~10 hrs for MVP).

### 10. Notices / Announcements
Not started (~4 hrs).

### 11. File Uploads / Storage
Not started. Needed for receipts, profile photos, documents (~5 hrs).

### 12. WhatsApp Integration
Post-SMS. WhatsApp Business API or Twilio (~6 hrs).

### 13. Custom Domain / White Label
Per-institute custom domain. Domain permission exists, flow deferred.

### 14. Advanced Analytics
Defaulter prediction, collection efficiency trends, batch-wise revenue.
(~8 hrs, needs enough data).

### 15. Multi-Branch Support
Institutes with multiple locations. Schema impact significant (~20 hrs).

### 16. Mobile App
Not scoped. Huge effort. React Native or Flutter.

---

## 🔵 Technical Debt / Infrastructure

### 17. CI/CD Pipeline
Deferred (solo dev, manual runs).

**Scope:**
- GitHub Actions: `npm test` on PR
- Auto-deploy to Render/Railway on main push
- Env var management (secrets)
- MongoDB Atlas migration

**Effort:** ~5.5 hrs (`.20` milestone)

---

### 18. Monitoring / Observability
**Gap:** Errors सिर्फ `console.error` में — कहीं persist नहीं।

**Scope:**
- Sentry (backend errors + traces)
- Log aggregation (Logtail/Datadog)
- Uptime monitoring (Better Uptime / UptimeRobot)
- Alert routing (Slack/email)

**Effort:** ~3 hrs

---

### 19. API Documentation (Swagger / OpenAPI)
**Gap:** कोई API docs नहीं। Frontend / mobile team onboarding painful।

**Scope:**
- `swagger-jsdoc` + `swagger-ui-express`
- Annotate all routes
- Auto-generate from validators + controllers

**Effort:** ~6 hrs

---

### 20. Test Coverage Gaps
**Known gaps:**
- `.17.3` LATE (fixed in follow-up ✅)
- Teacher attendance CRUD — still no dedicated tests (only covered by integration)
- Some error paths untested (e.g., partial transaction rollback in rare cases)

**Effort:** ~4 hrs for comprehensive pass

---

## 📋 Deferred From Earlier Handoff

Items explicitly deferred to v2:

- Exam management
- Lead management
- Storage
- SMS
- Email
- WhatsApp
- API request limits

---

## 🎯 Recommended Sequence (Post `.19`)

1. **`.20` Production Deploy** — CI/CD, MongoDB Atlas, Render deploy, Sentry
2. **Audit Log Integration** (P0 #1) — close compliance gap
3. **Receipt PDF** (P0 #2) — parent-facing trust
4. **Razorpay Integration** (P1 #3) — biggest UX improvement
5. **Email/SMS** (P1 #4) — collection efficiency
6. **`.18` follow-ups** (fee enhancements, reports)
7. **Parent Portal** — unlock new user segment

Real client feedback should reorder this list — ship fast, then prioritize what's actually used.

---

## 📝 How to Update This File

- Add new gaps as they're discovered (during audits, after client feedback)
- Move items up when they become blocking
- Strike through / remove when done (or move to CHANGELOG)
- Update "Last updated" date
- Keep effort estimates honest (add 50% buffer for unknowns)

---

**Total estimated effort (all items):** ~150-200 hrs across P0-P3.

Focus on P0 + P1 first — those are the difference between "demo-able" and "real production."