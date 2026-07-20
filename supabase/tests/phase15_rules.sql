-- =============================================================================
-- phase15_rules.sql — DAILY model.
--   * dual-cap: an enrolment must set end_date and/or total_sessions
--   * RULE 9: no delivery without a session report
--   * generation is DAILY and stops at whichever cap binds first
-- (RULE 7 / RULE 8 / available_slots live in slot_rules.sql.)
-- =============================================================================

begin;
select plan(4);

insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000aa003', 'P15 Student 3', 'lead'),
  ('00000000-0000-0000-0000-0000000aa004', 'P15 Student 4', 'lead'),
  ('00000000-0000-0000-0000-0000000aa005', 'P15 Student 5', 'lead');

insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000bb003', '00000000-0000-0000-0000-0000000aa003', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000bb004', '00000000-0000-0000-0000-0000000aa004', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000bb005', '00000000-0000-0000-0000-0000000aa005', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- TEST 1 — dual-cap: neither end_date nor total_sessions.
select throws_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, start_date)
     values ('00000000-0000-0000-0000-0000000aa003','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000bb003','19:00', current_date) $$,
  '23514', null,
  'dual-cap: an enrolment with neither end_date nor total_sessions is rejected'
);

-- TEST 2 — RULE 9: deliver with no session report. The class is inside its
-- window, so only the missing report can block delivery.
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000cc001','DEMO','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-0000000aa003',
        now() - interval '15 minutes', now() + interval '15 minutes', now() - interval '1 hour');
select throws_ok(
  $$ update public.classes set status = 'delivered' where id = '00000000-0000-0000-0000-0000000cc001' $$,
  '23514', null,
  'RULE 9: marking a class delivered with no session_reports row is rejected'
);

-- --- Generation: DAILY, capped ---------------------------------------------
-- Both enrolments start TOMORROW so every occurrence is in the future,
-- regardless of the time of day the test runs.

-- Capped by count: 3 sessions.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, start_date, total_sessions)
values ('00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-0000000aa004','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000bb004','19:30', current_date + 1, 3);

-- Capped by date: tomorrow .. +3 days = 3 days.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, start_date, end_date)
values ('00000000-0000-0000-0000-0000000dd002','00000000-0000-0000-0000-0000000aa005','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000bb005','20:00', current_date + 1, current_date + 3);

select public.generate_classes(30);

select is(
  (select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000dd001'),
  3,
  'generation is daily and stops at total_sessions (cap of 3 -> 3 classes)'
);
-- Date-capped: classes land on the OPEN days within [start, end] (closed days
-- are skipped now), so compare against the open-day count for that range.
select is(
  (select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000dd002'),
  public.open_days_count('00000000-0000-0000-0000-000000000b02', current_date + 1, current_date + 3),
  'generation stops at end_date, counting only open days in the range'
);

select * from finish();
rollback;
