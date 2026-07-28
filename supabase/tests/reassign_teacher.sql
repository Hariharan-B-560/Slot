-- =============================================================================
-- reassign_teacher.sql — moving a student to another teacher is a re-enrolment.
--   * a teacher cannot reassign (admin only)
--   * a slot already taken by another active enrolment for the new teacher → clash
--   * success: old enrolment ENDED, its future published class cancelled (missed),
--     a new ACTIVE enrolment under the new teacher continues the package
--     (total kept; delivered-so-far credited), and new classes generate
-- =============================================================================

begin;
select plan(9);

-- --- Fixtures ---------------------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-00000000511a', 'Reassign Student', 'enrolled'),
  ('00000000-0000-0000-0000-00000000512a', 'Slot Holder Two',  'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-00000000511b', '00000000-0000-0000-0000-00000000511a', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-00000000512b', '00000000-0000-0000-0000-00000000512a', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- E1: the student to move — Teacher One, 09:00, package of 40, none legacy.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, sessions_already_delivered)
values ('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-00000000511a', '00000000-0000-0000-0000-000000000b01',
        '00000000-0000-0000-0000-00000000511b', '09:00', 30, current_date - 30, 40, 0);
-- E2: an existing ACTIVE enrolment for Teacher Two at 14:00 — the clash holder.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-0000000051f2', '00000000-0000-0000-0000-00000000512a', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-00000000512b', '14:00', 30, current_date, 40);

-- Two VERIFIED classes on E1 (delivered so far = 2) + one FUTURE published class.
alter table public.classes disable trigger classes_enforce_lifecycle;
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at, status, delivered_at, verified_at)
values
  ('00000000-0000-0000-0000-000000051c01', 'ENROLLED', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000511a',
   '00000000-0000-0000-0000-0000000051f1', 30, now() - interval '5 days', now() - interval '5 days' + interval '30 min',
   now() - interval '6 days', 'verified', now() - interval '5 days', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000051c02', 'ENROLLED', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000511a',
   '00000000-0000-0000-0000-0000000051f1', 30, now() - interval '4 days', now() - interval '4 days' + interval '30 min',
   now() - interval '6 days', 'verified', now() - interval '4 days', now() - interval '4 days');
alter table public.classes enable trigger classes_enforce_lifecycle;

insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-000000051c03', 'ENROLLED', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000511a',
        '00000000-0000-0000-0000-0000000051f1', 30, now() + interval '2 days', now() + interval '2 days' + interval '30 min', now());

-- === TEACHER cannot reassign ================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reassign_teacher('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-000000000b02', '11:00', 'x') $$,
  '42501', null, 'a teacher cannot reassign a student');
reset role;
select set_config('request.jwt.claims', '', true);

-- === ADMIN ==================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- A slot already taken by another active enrolment for the new teacher → clash.
select throws_ok(
  $$ select public.reassign_teacher('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-000000000b02', '14:00', 'clash') $$,
  '23P01', null, 'reassigning into a taken slot is rejected (rule 7 exclusion)');

-- The clean reassign succeeds.
select lives_ok(
  $$ select public.reassign_teacher('00000000-0000-0000-0000-0000000051f1', '00000000-0000-0000-0000-000000000b02', '11:00', 'student requested') $$,
  'admin reassigns the student to Teacher Two at 11:00');

select is((select status from public.enrolments where id = '00000000-0000-0000-0000-0000000051f1'),
  'ended', 'the old enrolment is ended');
select is((select status from public.classes where id = '00000000-0000-0000-0000-000000051c03'),
  'missed', 'the old future published class was cancelled (missed)');

-- The new enrolment continues the package under Teacher Two.
select is(
  (select slot_start from public.enrolments
     where student_id = '00000000-0000-0000-0000-00000000511a' and teacher_id = '00000000-0000-0000-0000-000000000b02' and status = 'active'),
  '11:00'::time, 'new enrolment is at the chosen slot under the new teacher');
select is(
  (select total_sessions from public.enrolments
     where student_id = '00000000-0000-0000-0000-00000000511a' and teacher_id = '00000000-0000-0000-0000-000000000b02' and status = 'active'),
  40, 'the package total is preserved');
select is(
  (select sessions_already_delivered from public.enrolments
     where student_id = '00000000-0000-0000-0000-00000000511a' and teacher_id = '00000000-0000-0000-0000-000000000b02' and status = 'active'),
  2, 'the 2 sessions delivered so far are credited to the package');
select ok(
  (select count(*) from public.classes c
     join public.enrolments e on e.id = c.enrolment_id
    where e.student_id = '00000000-0000-0000-0000-00000000511a' and e.teacher_id = '00000000-0000-0000-0000-000000000b02'
      and e.status = 'active') > 0,
  'classes were generated under the new teacher');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
