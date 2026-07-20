-- =============================================================================
-- DAILY SLOTS — 1/2 SCHEMA
-- Classes are DAILY at a fixed time. A slot is a TIME, not a day+time, so the
-- weekday dimension is removed everywhere. Rule 7 and rule 8 collapse from gist
-- EXCLUDE constraints (weekday-array overlap) into plain partial unique indexes.
-- =============================================================================

-- --- enrolments: drop the weekday-aware constraints, then the column ---------
alter table public.enrolments drop constraint if exists enrolments_no_double_book;
alter table public.enrolments drop constraint if exists enrolments_one_per_day;
alter table public.enrolments drop constraint if exists enrolments_weekdays_valid;

alter table public.enrolments drop column if exists weekdays;

-- RULE 7 — no double-book: two ACTIVE enrolments cannot claim the same
-- (teacher, slot_start). Without this a "free" slot is a lie.
create unique index enrolments_no_double_book
  on public.enrolments (teacher_id, slot_start)
  where status = 'active';

-- RULE 8 — a student holds ONE daily slot with a teacher, not several.
create unique index enrolments_one_per_student_teacher
  on public.enrolments (student_id, teacher_id)
  where status = 'active';

-- The dual-cap CHECK (end_date and/or total_sessions) is unchanged.

-- --- availability_blocks: a block is just a daily working window ------------
-- Dropping the column also drops its inline 0..6 check.
alter table public.availability_blocks drop column if exists weekday;

-- start_time < end_time and the session_minutes-multiple trigger both stay.
