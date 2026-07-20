-- =============================================================================
-- Batch 2 — 1/3 SCHEMA (evidence model + course)
-- Revises session_reports from an operational log into the delivery-EVIDENCE
-- model, and tags enrolments with a course. No data at reset time, so the new
-- NOT NULL screenshot columns can be added directly.
-- =============================================================================

-- --- course (extensible enum) ------------------------------------------------
create type public.course_type as enum ('basic_live', 'elp');

alter table public.enrolments
  add column course public.course_type not null default 'basic_live';

-- --- session_reports: evidence model ----------------------------------------
-- Drop the operational-log fields; add screenshot evidence + absence reason.
alter table public.session_reports drop column topic;
alter table public.session_reports drop column homework;

alter table public.session_reports add column absent_reason text;
alter table public.session_reports add column opening_screenshot text not null;
alter table public.session_reports add column closing_screenshot text not null;
alter table public.session_reports add column recording text;   -- optional
-- notes stays (nullable). class_id stays UNIQUE. Still INSERT/SELECT-only.

-- A reason is required precisely when the student was absent.
alter table public.session_reports
  add constraint session_reports_absent_reason
  check (attendance <> 'absent' or absent_reason is not null);
