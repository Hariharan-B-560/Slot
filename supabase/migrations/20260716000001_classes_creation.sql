-- =============================================================================
-- Simplify class creation + close the model violation.
--  * Teachers may NOT create classes. Only admin placement (classes_admin_insert)
--    and the generator (generate_classes, SECURITY DEFINER) create them.
--  * A class's duration is always a valid session length (30/60) and its window
--    equals that duration — no per-class minutes override.
--  * expected_joining_date is captured at admin demo placement.
-- =============================================================================

-- Teachers no longer hand-create classes (removes the fabrication vector).
drop policy if exists classes_teacher_insert on public.classes;

-- Duration is a real session length, and the window matches it exactly.
alter table public.classes
  add constraint classes_duration_allowed check (duration_minutes in (30, 60));
alter table public.classes
  add constraint classes_end_matches_duration
  check (scheduled_end = scheduled_start + make_interval(mins => duration_minutes));

-- Captured when an admin places a lead as a DEMO (not on any teacher form).
alter table public.students add column expected_joining_date date;
