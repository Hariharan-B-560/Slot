# The Easy English — Slot Booking Finalised Decision (v1)

**What this is:** the locked design from our discussion, concrete enough to build from. Standalone app, Next.js + Supabase. Scope is deliberately small — publish → deliver → verify → dashboard. No LMS.

**Roles in v1: `admin` and `teacher` only.** No student or counsellor role. Students exist as *data records* (who a class is for), managed by admin — not as login users. Admin absorbs the counsellor's sign-off duty for now. Both are schema-ready to split out later with no migration.

---

## Locked flow

Lead → demo slot → demo delivered → **conversion gate (admin signs off)** → enrolled slot (recurring) → each class runs publish/deliver/verify → utilisation + fraud dashboard.

## Assumptions locked (override any in one line)

1. **Success gate = a conversion event recorded by an admin** (never the teacher who took the demo). This is the anti-fraud spine.
2. **Enrolled slot = a recurring series** (e.g. Mon/Wed/Fri 18:00, start→end date), not a single class. The one assumption that forces a rebuild if wrong.
3. **Verify is flag-based, not per-class.** Teacher marks delivered inside the window; admin only reviews *flagged* classes (not every one). Student confirmation and Zoom/Meet auto-verify are future adds that need no schema change.

## Honest limit of v1 (read this)

With no student confirmer, rules 1–4 stop retroactive and phantom fabrication cold, but they cannot *prove* a scheduled class was actually delivered. Closing that requires a video join log (Zoom/Meet auto-verify) or student confirmation — both deferred. Until one lands, the no-backfill window rule carries the attendance-truth goal.

---

## Two slot types, one engine

- `DEMO` — one-off trial. Teacher + a lead. No enrolment behind it.
- `ENROLLED` — born from a passed demo. Spawns a recurring class series.

Both produce `class` rows that share the same lifecycle. Build the lifecycle once.

## Data model (key columns only)

**profiles** — app users. `id`, `name`, `role` (`admin | teacher`).

**students** — data records, no login. `id`, `name`, `phone`, `status` (`lead | demo_scheduled | enrolled | dropped`). Reserved for future student login.

**app_config** — singleton. `slot_minutes` (default `30`) — the **atomic slot granularity** (the grid unit), NOT the session length. Every session is a whole multiple of this atom. `closed_weekdays` (default `{sun,sat}` — array of weekdays the institute is closed by default; Sunday permanently, Saturday openable per-date via override).

**availability_blocks** — teacher-published daily availability, entered as *blocks* (e.g. 16:00–20:00). `id`, `teacher_id`, `start_time`, `end_time`, `active`. No weekday (classes are daily on open days). The block is auto-sliced into `slot_minutes` atoms; a block's length must be a whole multiple of `slot_minutes`. Blocks apply only to *open* days (not in `closed_weekdays`).

**availability_overrides** — one-off unlocks (or closures) for a specific date. `id`, `teacher_id`, `date`, `kind` (`open | close`), `start_time`, `end_time` (nullable — full-day when null), `created_by` (must be admin), `reason`. **`open` overrides are the ONLY way to schedule on a `closed_weekday`** (e.g. opening a Saturday for a specific teacher). Sundays are hard-closed and NOT openable — a UI-level rule but also enforced in the generator. Overrides are per-date, never recurring; a permanent schedule change means updating `availability_blocks`, not stacking overrides.

**reschedule_requests** — teacher-initiated, admin-decided. `id`, `class_id` (FK), `requested_by` (teacher), `requested_at`, `reason`, `proposed_start` (nullable — teacher may suggest, admin may override), `status` (`pending | approved | denied`), `decided_by` (admin), `decided_at`, `decision_note`. **A teacher can never move their own class directly.** Approving a request MOVES the original class row (updates `scheduled_start` / `scheduled_end`) — it does not create a second class. The original `scheduled_start` is preserved in an append-only `class_reschedule_history` for audit. This preserves `total_sessions` integrity and every anti-fraud rule.

**conversion_events** — the objective gate. `id`, `student_id`, `type` (`payment | admin_signoff`), `recorded_by`, `recorded_at`, `ref`. **Constraint: `recorded_by` must be an admin, never the demo teacher.**

**enrolments** — created only when a conversion_event exists. Claims a recurring **daily** slot of a fixed length. `id`, `student_id`, `teacher_id`, `source_demo_id`, `conversion_event_id`, `slot_start` (time-of-day, e.g. `17:00`), `duration_minutes` (`30` or `60`; must be a multiple of `slot_minutes`), `start_date`, `end_date` (nullable), `total_sessions` (nullable int), `course` (e.g. `basic_live | elp`), `status`. The session runs `[slot_start, slot_start + duration_minutes)`.
  - **Mixed durations.** The atom stays 30 min. A 30-min session holds one atom; a 60-min session holds **two consecutive atoms** (17:00 booked ⇒ 17:00 *and* 17:30 are gone). No separate "60-min slot type" — a long session is just a two-atom span held by one enrolment.
  - **Classes are DAILY at a fixed time.** A student attends every day at the same `slot_start`. There is no weekday dimension — a slot is a *time*, not a day+time.
  - **Sizing = two optional caps, whichever hits first.** `total_sessions` set → count-based (e.g. 20 sessions, then renew). `end_date` set → date-based. Both set → ends at whichever comes first. **Constraint: at least one of the two must be set** (no open-ended enrolments).
  - **Legacy migration (existing students already running on the Google Form system).** Three extra fields, admin-set once, only on enrolments created via the migration path: `sessions_already_delivered` (int, default 0 — counts against `total_sessions` so "remaining" reads correctly from day one), `historical_start_date` (date, when they actually started before the app; the app's `start_date` still marks when generation begins here), and `migrated_from_legacy` (bool, default false — a flag so utilisation and reports can separate carried-over students from ones born in the app). *Past classes are NOT backfilled into the ledger* — that would violate rule 1 (no backfill), which has no exception for migration. The Google Sheet stays as a static archive for pre-cutover history.
  - **Payment.** `total_fee` (numeric, nullable — admin-set case by case, no fixed price list). "Paid" and "remaining" are NEVER stored — they are computed from `payments` rows. If admin needs to change the fee, that's an update to `total_fee`, tracked in `enrolment_fee_history`.

**payments** — the append-only payment ledger. `id`, `enrolment_id` (FK), `amount` (numeric — positive for received, negative for refund/adjustment), `paid_at` (timestamptz, admin-set — when the money moved), `recorded_by` (FK profiles, must be admin), `recorded_at` (auto), `note` (nullable — e.g. "instalment 2", "refund for missed classes"). INSERT/SELECT only. Corrections are new rows (a negative adjustment), never edits. Paid = sum of amounts; remaining = total_fee − paid. Never derive either from stored fields.

**enrolment_fee_history** — audit trail for `total_fee` changes. `id`, `enrolment_id`, `previous_fee`, `new_fee`, `changed_by`, `changed_at`, `reason`. Append-only. Written by trigger whenever `enrolments.total_fee` is updated.

10. **No self-payment (fabrication guard).** Only admin can INSERT into `payments`. Teachers have no read or write access. Admin cannot record a payment against their own student (not applicable in v1 since admin has no student, but the RLS pattern is written this way for future-proofing).
11. **Payment ledger is append-only.** No UPDATE/DELETE on `payments`. Corrections are new rows.
12. **Fee changes are logged.** `enrolments.total_fee` is writable by admin only; every change writes to `enrolment_fee_history` via trigger.
13. **Warn, don't block.** Unpaid balance surfaces as a warning on the roster and student drill-down but does NOT gate class generation, delivery, or verification. A student in arrears keeps getting classes; the human decides what to do.

**session_reports** — one per delivered class; the post-session form, and the action that flips a class to `delivered`. Evidence-based, mirroring the current Google Form. `id`, `class_id` (FK, unique), `attendance` (`present | late | absent`), `absent_reason` (nullable; required when absent), `opening_screenshot` + `closing_screenshot` (file paths in Supabase Storage — the verification evidence, both required), `recording` (nullable path, optional), `notes` (nullable), `created_by`, `created_at`. No topic/homework/rubric — richer content tracking is the Progress Tracker app's job. INSERT/SELECT only (append-only, like the ledger).

**Verification (v1) = admin reviews the evidence.** There are no Zoom/Meet join logs; proof of delivery is the teacher-submitted screenshots, server-timestamped so they must arrive inside the delivery window. Admin views them in a queue and marks `verified` or `flagged`. (Screenshots can be re-used, so this isn't unfakeable — a real join log stays the future upgrade — but it kills easy fabrication: no evidence → no `delivered`; late evidence → rejected. And the teacher-typed "completed classes count" is gone entirely — that number is now computed, not entered, closing the exact vector being audited.)

**classes** (instances — the append-only ledger) — `id`, `slot_type`, `teacher_id`, `student_id`, `enrolment_id` (null for DEMO), `scheduled_start`, `scheduled_end` (= start + the enrolment/demo `duration_minutes`), `duration_minutes`, `status`, `published_at`, `delivered_at`, `delivered_by`, `verified_at`, `verified_by`, `verify_source` (`admin | join_log | student` — future), `student_confirmed_at` (reserved, unused in v1), `flag_reason`.

## Session & availability slots (the #1 view)

- **Atom:** the grid unit is a **30-min slot** (`slot_minutes`). Sessions are 30 or 60 min = one or two atoms.
- **Classes are daily.** A slot is a **time**, not a day+time. No weekday dimension.
- **A teacher's atoms** = each active `availability_block` sliced into 30-min times.
- **An atom is occupied** if some active enrolment's `[slot_start, slot_start + duration_minutes)` range covers it. A 60-min booking occupies two atoms.
- **Free for 30 vs free for 60 are different questions.** A lone free atom between two taken ones can host a 30-min session but NOT a 60-min one. Placement must check for *enough consecutive free atoms within the published window* for the chosen duration.
- **The admin flow:** demo comes in → admin opens Availability → picks a duration (30/60) → sees where that length fits for each teacher → calls the teacher to confirm (offline) → places the student.

**The strip renders spans, not just cells:** a 30-min booking is one cell, a 60-min booking is one wide block (two atoms) carrying the student's name. Free atoms are blue; a run of free atoms is where a 60 can start.

## Class-instance state machine

| From | To | Trigger | Guard |
|---|---|---|---|
| — | `published` | class generated | `published_at < scheduled_start` |
| `published` | `delivered` | teacher marks | inside `[scheduled_start, scheduled_end + grace]` **and** a `session_reports` row exists for the class |
| `delivered` | `verified` | admin (on flagged) or auto-verify source | teacher alone cannot verify |
| `published` | `missed` | window passes, never delivered | auto |
| `delivered` | `flagged` | unverified beyond N days, or anomaly | surfaces on admin dashboard |

## Anti-fraud rules (enforced at the DB, not app code)

1. **No backfilling.** `delivered_at` must fall inside the class window. → Postgres trigger/check. *Primary teeth in v1.*
2. **Publish-before-happen.** `published_at < scheduled_start`. → trigger.
3. **Append-only ledger.** No destructive UPDATE/DELETE on `classes`. Corrections are new rows. → RLS + column-level policy; only status/verify columns writable.
4. **No self-conversion.** An `ENROLLED` enrolment can't exist without a `conversion_events` row whose `recorded_by` is an admin (≠ demo teacher). → FK + trigger. Teachers have no INSERT on `conversion_events` (RLS).
5. **No self-verify.** `verified` is set only by an admin or an auto-verify source, never by the delivering teacher. → trigger + RLS.
6. **Row ownership.** A teacher can only write their own `classes` rows. → RLS.
7. **No double-book / no overlap (capacity integrity).** For a given teacher, no two active enrolments' time ranges `[slot_start, slot_start + duration_minutes)` may overlap. → Postgres `EXCLUDE USING gist` over the time range with `teacher_id` equality (needs `btree_gist`), scoped to active status. A point unique index is NOT enough now — a 60-min booking spans two atoms, so overlap must be checked as ranges. Without this, a "free" slot is a lie and the whole #1 view is untrustworthy.
8. **One active enrolment per `(student, teacher)`.** A student holds one daily slot with a teacher, not several.
9. **No delivery without a report.** A class cannot move to `delivered` unless a `session_reports` row exists for it, filed inside the delivery window. → trigger. (Record-keeping + evidence; a self-filled form is not by itself proof.)

Rules 1, 4, 5 are the ones that directly attack the fabricated-entry problem you're auditing.

## Admin views

- **Student list (roster)** — one row per student: name, phone, status, their teacher, their slot (weekdays + time), **classes they get** (from `total_sessions` or the date-range computation), **delivered so far**, **remaining**. Pure read over students + enrolments + classes; no new tables. Click through to that student's class history + session reports.
- **Utilisation** = occupied 30-min slots ÷ total available 30-min slots, per teacher, per period. (Stricter variant: count only *verified-delivered* slots in the numerator — booked vs actually-taught.)
- **Fabrication flags** = delivered-but-unverified past threshold, rejected out-of-window attempts, and any teacher with a high delivered ÷ verified gap. Feeds an admin review queue.

## Not in v1 (scope guard)

Student login + self-booking (deferred, schema-ready), counsellor role, payments UI, recordings, curriculum, notifications. If it isn't publish/deliver/verify/utilisation, it waits.

## Later (explicitly future, not now)

- **wacrm integration** — booking app sits downstream of the CRM; a converted lead flows in as an enrolment. Cleanest via a shared Supabase project joining on a contact/student id.
- **Auto-verify** — Zoom/Meet join-log adapter behind an interface; sets `verify_source = join_log`. No schema change.
