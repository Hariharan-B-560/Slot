-- =============================================================================
-- Phase 1.5 — 1/3 TABLES
-- session_reports (operational log), enrolment dual-cap (end_date OR
-- total_sessions). Ordered before triggers and rls.
-- =============================================================================

-- Attendance is an operational fact, not progress tracking.
create type public.attendance as enum ('present', 'late', 'absent');

-- --- session_reports ---------------------------------------------------------
-- Exactly one report per class (class_id UNIQUE). This is a delivery log, NOT
-- progress tracking — no rubric, score, or curriculum fields.
create table public.session_reports (
  id         uuid primary key default extensions.gen_random_uuid(),
  class_id   uuid not null unique references public.classes (id),
  attendance public.attendance not null,
  topic      text not null,
  notes      text,
  homework   text,                       -- nullable
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index session_reports_class_idx on public.session_reports (class_id);

-- --- enrolments: dual-cap ----------------------------------------------------
-- total_sessions caps the series by count; end_date caps it by date. At least
-- one must be set — no open-ended enrolments.
alter table public.enrolments add column if not exists total_sessions integer;

alter table public.enrolments
  add constraint enrolments_total_sessions_positive
  check (total_sessions is null or total_sessions > 0);

alter table public.enrolments
  add constraint enrolments_has_cap
  check (end_date is not null or total_sessions is not null);
