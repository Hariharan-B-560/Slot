-- =============================================================================
-- enrolment_sessions.sql — admin edits the class count, safely.
--   * teacher cannot edit; reason is required; can't drop below delivered
--   * DECREASE cancels the surplus (latest) upcoming classes, never a delivered one
--   * INCREASE raises the cap (and regenerates)
--   * every change is audited
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures: enrolment with 2 delivered + 6 upcoming published classes -----
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000005e1', 'Sessions Student', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000005e1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, sessions_already_delivered)
values ('00000000-0000-0000-0000-0000000005ef', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000005e2', '09:00', 30, current_date - 10, 10, 0);

-- 2 verified (delivered so far = 2).
alter table public.classes disable trigger classes_enforce_lifecycle;
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at, status, delivered_at, verified_at)
values
  ('00000000-0000-0000-0000-00000000a501', 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000005e1',
   '00000000-0000-0000-0000-0000000005ef', 30, now() - interval '3 days', now() - interval '3 days' + interval '30 min', now() - interval '4 days', 'verified', now() - interval '3 days', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000a502', 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000005e1',
   '00000000-0000-0000-0000-0000000005ef', 30, now() - interval '2 days', now() - interval '2 days' + interval '30 min', now() - interval '4 days', 'verified', now() - interval '2 days', now() - interval '2 days');
alter table public.classes enable trigger classes_enforce_lifecycle;

-- 6 upcoming published (days +1..+6).
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at)
select ('00000000-0000-0000-0000-00000000b50' || g)::uuid, 'ENROLLED', '00000000-0000-0000-0000-000000000b02',
       '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005ef', 30,
       now() + (g || ' days')::interval, now() + (g || ' days')::interval + interval '30 min', now()
from generate_series(1, 6) g;

-- === TEACHER cannot edit ====================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
select throws_ok(
  $$ select public.set_enrolment_sessions('00000000-0000-0000-0000-0000000005ef', 5, 'nope') $$,
  '42501', null, 'a teacher cannot edit the class count');
reset role;
select set_config('request.jwt.claims', '', true);

-- === ADMIN ==================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

select throws_ok(
  $$ select public.set_enrolment_sessions('00000000-0000-0000-0000-0000000005ef', 5, '') $$,
  '23514', null, 'a reason is required');
select throws_ok(
  $$ select public.set_enrolment_sessions('00000000-0000-0000-0000-0000000005ef', 1, 'too low') $$,
  '23514', null, 'cannot set below the 2 sessions already delivered');

-- Decrease 10 -> 5: cancels the latest 3 upcoming (6 - (5-2)=3 surplus).
select lives_ok(
  $$ select public.set_enrolment_sessions('00000000-0000-0000-0000-0000000005ef', 5, 'student downsized package') $$,
  'admin decreases the class count to 5');
select is((select total_sessions from public.enrolments where id = '00000000-0000-0000-0000-0000000005ef'),
  5, 'the count is now 5');
select is((select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000005ef' and status = 'missed'),
  3, 'the 3 surplus upcoming classes were cancelled');
select is((select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000005ef' and status = 'published'),
  3, 'the earliest 3 upcoming classes remain');
select is((select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000005ef' and status = 'verified'),
  2, 'the 2 delivered classes are untouched');
select is((select count(*)::int from public.enrolment_sessions_history
     where enrolment_id = '00000000-0000-0000-0000-0000000005ef' and previous_total = 10 and new_total = 5 and reason = 'student downsized package'),
  1, 'the change was audited');

-- Increase 5 -> 8.
select public.set_enrolment_sessions('00000000-0000-0000-0000-0000000005ef', 8, 'student added sessions');
select is((select total_sessions from public.enrolments where id = '00000000-0000-0000-0000-0000000005ef'),
  8, 'admin increases the class count to 8');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
