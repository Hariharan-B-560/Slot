-- =============================================================================
-- slot_change.sql — permanent slot change moves all FUTURE published classes to
-- the new time (dates preserved) and leaves frozen classes alone.
--   * a teacher cannot change a slot (admin-only)
--   * a non-active (paused) enrolment is rejected
--   * a slot that collides with another active enrolment for the teacher → rejected
--   * a successful change moves every future published class + writes history
--   * delivered/verified classes are untouched
-- =============================================================================

begin;
select plan(9);

-- Two future IST dates the classes live on.
create or replace function pg_temp.d2() returns date language sql as $$ select current_date + 2 $$;
create or replace function pg_temp.d3() returns date language sql as $$ select current_date + 3 $$;
create or replace function pg_temp.at_ist(p_date date, p_t time) returns timestamptz
  language sql as $$ select (p_date + p_t) at time zone 'Asia/Kolkata' $$;

-- --- Fixtures ---------------------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000051a1', 'Slot-change Student', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000051b1', '00000000-0000-0000-0000-0000000051a1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- Subject enrolment A: Teacher Two, daily 09:00.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-0000000051a1', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000051b1', '09:00', 30, current_date, 40);

-- A second ACTIVE enrolment for Teacher Two at 14:00 — the collision holder.
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000051a2', 'Slot Holder Student', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000051b2', '00000000-0000-0000-0000-0000000051a2', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-0000000051f2', '00000000-0000-0000-0000-0000000051a2', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000051b2', '14:00', 30, current_date, 40);

-- A PAUSED enrolment for Teacher Two at 05:00 — not reschedulable.
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000051a3', 'Slot Paused Student', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000051b3', '00000000-0000-0000-0000-0000000051a3', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, status, paused_at)
values ('00000000-0000-0000-0000-0000000051f3', '00000000-0000-0000-0000-0000000051a3', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000051b3', '05:00', 30, current_date, 40, 'paused', now());

-- Enrolment A's two FUTURE published classes at 09:00 (d2, d3) + one frozen
-- verified class (d2 10:00) that must NOT move.
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values
  ('00000000-0000-0000-0000-00000005c001', 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000051a1',
   '00000000-0000-0000-0000-0000000051f1', 30, pg_temp.at_ist(pg_temp.d2(), '09:00'), pg_temp.at_ist(pg_temp.d2(), '09:30'), now()),
  ('00000000-0000-0000-0000-00000005c002', 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000051a1',
   '00000000-0000-0000-0000-0000000051f1', 30, pg_temp.at_ist(pg_temp.d3(), '09:00'), pg_temp.at_ist(pg_temp.d3(), '09:30'), now());

alter table public.classes disable trigger classes_enforce_lifecycle;
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at, status, delivered_at, verified_at)
values
  ('00000000-0000-0000-0000-00000005c003', 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000051a1',
   '00000000-0000-0000-0000-0000000051f1', 30, pg_temp.at_ist(pg_temp.d2(), '10:00'), pg_temp.at_ist(pg_temp.d2(), '10:30'),
   now() - interval '2 hours', 'verified', now() - interval '90 minutes', now() - interval '80 minutes');
alter table public.classes enable trigger classes_enforce_lifecycle;

-- === TEACHER SESSION — cannot change a slot ================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_enrolment_slot('00000000-0000-0000-0000-0000000051f1', '08:00', 'nope') $$,
  '42501', null, 'a teacher cannot change an enrolment slot');
reset role;
select set_config('request.jwt.claims', '', true);

-- === ADMIN SESSION =========================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- A paused enrolment is rejected.
select throws_ok(
  $$ select public.set_enrolment_slot('00000000-0000-0000-0000-0000000051f3', '06:00', 'x') $$,
  '23514', null, 'a paused enrolment cannot be rescheduled');

-- A slot already held by another active enrolment for this teacher → rejected.
select throws_ok(
  $$ select public.set_enrolment_slot('00000000-0000-0000-0000-0000000051f1', '14:00', 'clash') $$,
  '23P01', null, 'a colliding slot is rejected by the enrolment EXCLUDE constraint');

-- A successful change moves BOTH future published classes to 08:00.
select is(
  (select public.set_enrolment_slot('00000000-0000-0000-0000-0000000051f1', '08:00', 'to morning')),
  2, 'the change moved both future published classes');

select is(
  (select scheduled_start from public.classes where id = '00000000-0000-0000-0000-00000005c001'),
  pg_temp.at_ist(pg_temp.d2(), '08:00'), 'class 1 moved to 08:00 on its own date');
select is(
  (select scheduled_start from public.classes where id = '00000000-0000-0000-0000-00000005c002'),
  pg_temp.at_ist(pg_temp.d3(), '08:00'), 'class 2 moved to 08:00 on its own date');
select is(
  (select slot_start from public.enrolments where id = '00000000-0000-0000-0000-0000000051f1'),
  '08:00'::time, 'the enrolment slot is now 08:00');
select is(
  (select count(*)::int from public.class_reschedule_history
     where class_id in ('00000000-0000-0000-0000-00000005c001','00000000-0000-0000-0000-00000005c002')),
  2, 'one reschedule-history row per moved class');

-- The frozen verified class is untouched.
select is(
  (select scheduled_start from public.classes where id = '00000000-0000-0000-0000-00000005c003'),
  pg_temp.at_ist(pg_temp.d2(), '10:00'), 'the verified class did not move');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
