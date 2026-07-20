# The Easy English — Slot Booking Build Brief (CLAUDE.md)

You are building a teacher live-class slot booking + attendance-truth app for The Easy English (online English institute).
**Read `decision-v1.md` first** — it holds the locked data model and the six anti-fraud rules. This file is *how* to build it.

**Roles in v1: `admin` and `teacher` only.** No student or counsellor role. Students are *data records*, not users. Admin does the conversion sign-off and reviews flagged classes.

## Non-negotiables — never drop these

1. **The six anti-fraud rules are enforced in Postgres (triggers + RLS), never in app code.** In short:
   - No backfilling: `delivered_at` must fall inside the class window. *(Primary teeth in v1.)*
   - Publish-before-happen: `published_at < scheduled_start`.
   - Append-only `classes` ledger: corrections are new rows, not edits.
   - No self-conversion: an enrolment needs a `conversion_events` row recorded by an admin (≠ demo teacher); teachers have no INSERT on `conversion_events`.
   - No self-verify: `verified` is set only by an admin or an auto-verify source — never the delivering teacher.
   - Row ownership: a teacher writes only their own `classes` rows.
2. **Scope is publish → deliver → verify → dashboard.** No payments UI, recordings, curriculum, notifications, student login, or self-booking. Don't add them "while we're here."
3. **DB-first.** Build and *prove* the enforcement layer before any UI.
4. **Keep students in the schema as data (no auth).** Also keep `student_confirmed_at` and `verify_source` columns present but unused — future student login / join-log auto-verify must slot in with no migration.

## Tech stack (pinned — don't substitute)

- Next.js App Router + TypeScript (strict).
- Supabase: Postgres, Auth, RLS, `pg_cron`.
- Schema/triggers/RLS via Supabase CLI SQL migrations. No ORM. Types via `supabase gen types typescript`.
- Roles: `admin | teacher` on a `profiles` table; policies key off role.
- Tailwind + shadcn/ui. Recharts for the dashboard.
- `rrule` for series expansion. `pg_cron` generates upcoming class instances daily.
- `timestamptz` everywhere; window math in `Asia/Kolkata` via Luxon.
- Zod for input validation. Deploy: Vercel + Supabase Cloud.

## Build order — do these in sequence, one phase at a time

**Phase 0 — scaffold.** create-next-app (TS, App Router, Tailwind), init shadcn/ui, `supabase init`, link project, commit.

**Phase 1 — the enforcement layer (the heart of the project).**
- Migrations for the tables in `decision-v1.md`.
- Then triggers + RLS implementing all six rules.
- Seed one admin and two teachers, plus two student *records*.
- Write the acceptance tests below and make them pass. **Do not proceed until they pass.**

**Phase 2 — instance generation.** `pg_cron` job expands active enrolments (via `rrule`) into `classes` rows for the coming window, all starting in `published`.

**Phase 3 — minimal role UI.** Teacher: publish availability, mark delivered (only inside window). Admin: record conversion event, review the flagged-classes queue, verify.

**Phase 4 — dashboard.** Utilisation (verified enrolled hours ÷ published availability hours, per teacher/period) and fabrication flags. Recharts.

## Acceptance tests — must pass before leaving Phase 1

Run under the relevant role:
- A teacher marking a class delivered *outside* its window → **rejected**.
- Inserting a `classes` row with `published_at` after `scheduled_start` → **rejected**.
- A teacher attempting INSERT on `conversion_events` → **denied by RLS**.
- A teacher setting any class to `verified` → **rejected** (only admin / auto-verify may).
- UPDATE/DELETE rewriting a historical `classes` row → **denied**.
- A teacher reading/writing another teacher's `classes` row → **denied**.

If any of these pass when they should fail, the enforcement layer is broken — stop and fix before building anything else.

## Working style for this repo

- Use Plan mode for Phase 1 and any migration work; show the plan before writing.
- One phase per session. Don't jump ahead to UI.
- If you think a rule should move to app code "for simplicity," don't — flag it to me instead.
