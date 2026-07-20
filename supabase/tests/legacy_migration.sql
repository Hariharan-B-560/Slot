-- =============================================================================
-- legacy_migration.sql — the one-time legacy onboarding path.
--   * sessions_already_delivered can't exceed total_sessions
--   * the migration path still honours rule 7 (no overlap)
--   * the historical period is never backfilled (rule 2 blocks past classes)
--   * remaining = total_sessions - (sessions_already_delivered + in-app delivered)
--   * generation halts at total_sessions counting historical + in-app
-- Fixtures on Teacher Two (…b02); students/conversions as in slot_rules.sql.
-- =============================================================================

begin;
select plan(7);

insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000e0001', 'Legacy Student A', 'lead'),
  ('00000000-0000-0000-0000-0000000e0002', 'Legacy Student B', 'lead'),
  ('00000000-0000-0000-0000-0000000e0003', 'Legacy Student C', 'lead'),
  ('00000000-0000-0000-0000-0000000e0004', 'Legacy Student D', 'lead');
insert into public.conversion_events (id, student_id, type, recorded_by, ref) values
  ('00000000-0000-0000-0000-0000000f0001', '00000000-0000-0000-0000-0000000e0001', 'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'legacy migration'),
  ('00000000-0000-0000-0000-0000000f0002', '00000000-0000-0000-0000-0000000e0002', 'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'legacy migration'),
  ('00000000-0000-0000-0000-0000000f0003', '00000000-0000-0000-0000-0000000e0003', 'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'legacy migration'),
  ('00000000-0000-0000-0000-0000000f0004', '00000000-0000-0000-0000-0000000e0004', 'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'legacy migration');

-- === TEST 1 — delivered-more-than-the-package is rejected ====================
select throws_ok(
  $$ insert into public.enrolments
       (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
        start_date, total_sessions, sessions_already_delivered, migrated_from_legacy)
     values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000f0001','12:00', 30, current_date, 10, 13, true) $$,
  '23514', null,
  'legacy: sessions_already_delivered (13) > total_sessions (10) is rejected'
);

-- === TEST 2 — the migration path still honours rule 7 (no overlap) ==========
-- An active 60-min booking 17:00–18:00 occupies 17:00 and 17:30.
insert into public.enrolments
  (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-0000000e0002','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000f0002','17:00', 60, current_date, 8);
select throws_ok(
  $$ insert into public.enrolments
       (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
        start_date, total_sessions, sessions_already_delivered, migrated_from_legacy)
     values ('00000000-0000-0000-0000-0000000e0003','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000f0003','17:30', 30, current_date, 20, 5, true) $$,
  '23P01', null,
  'legacy: a migrated enrolment overlapping an existing booking is rejected (rule 7)'
);

-- === TEST 3 — the historical period is never backfilled =====================
-- A legacy enrolment starting today; a class in the pre-app past is rejected by
-- rule 2 (published_at defaults now() > a past scheduled_start).
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start,
        duration_minutes, start_date, historical_start_date, total_sessions,
        sessions_already_delivered, migrated_from_legacy)
values ('00000000-0000-0000-0000-0000000e1001','00000000-0000-0000-0000-0000000e0004','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000f0004','12:30', 30, current_date, current_date - 30, 10, 3, true);
select throws_ok(
  $$ insert into public.classes
       (slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end)
     values ('ENROLLED','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-0000000e0004',
             '00000000-0000-0000-0000-0000000e1001', 30,
             now() - interval '10 days', now() - interval '10 days' + interval '30 minutes') $$,
  '23514', null,
  'no backfill: a class with scheduled_start before start_date (in the past) is rejected'
);

-- === TEST 4 — remaining = total - (already + in-app delivered) ==============
-- Reuse the e1001 enrolment: total 10, already 3 → 7 remaining before any app
-- delivery. Deliver two app classes and re-check. Delivery needs a report and
-- must land inside the class window (published_at set in the past so rule 2 holds).
create or replace function pg_temp.remaining(enr uuid) returns int language sql as $$
  select e.total_sessions - (e.sessions_already_delivered
    + (select count(*) from public.classes c
        where c.enrolment_id = e.id and c.status in ('delivered','verified')))
  from public.enrolments e where e.id = enr;
$$;

select is(pg_temp.remaining('00000000-0000-0000-0000-0000000e1001'), 7,
  'remaining: 10 total - (3 legacy + 0 app) = 7 before any app delivery');

-- Deliver app class #1.
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes,
        scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000e2001','ENROLLED','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000e0004','00000000-0000-0000-0000-0000000e1001', 30,
        now() - interval '15 minutes', now() + interval '15 minutes', now() - interval '2 hours');
insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
values ('00000000-0000-0000-0000-0000000e2001','present','e2001/o.png','e2001/c.png','00000000-0000-0000-0000-000000000b02');
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000b02')::text, true);
update public.classes set status = 'delivered' where id = '00000000-0000-0000-0000-0000000e2001';
select set_config('request.jwt.claims', '', true);

select is(pg_temp.remaining('00000000-0000-0000-0000-0000000e1001'), 6,
  'remaining: after 1 app delivery = 10 - (3 + 1) = 6');

-- Deliver app class #2.
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes,
        scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000e2002','ENROLLED','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000e0004','00000000-0000-0000-0000-0000000e1001', 30,
        now() - interval '5 minutes', now() + interval '25 minutes', now() - interval '2 hours');
insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
values ('00000000-0000-0000-0000-0000000e2002','present','e2002/o.png','e2002/c.png','00000000-0000-0000-0000-000000000b02');
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000b02')::text, true);
update public.classes set status = 'delivered' where id = '00000000-0000-0000-0000-0000000e2002';
select set_config('request.jwt.claims', '', true);

select is(pg_temp.remaining('00000000-0000-0000-0000-0000000e1001'), 5,
  'remaining: after 2 app deliveries = 10 - (3 + 2) = 5');

-- === TEST 5 — generation halts at total counting historical + in-app ========
-- total 5, already 2 → generation should produce exactly 3 (5 - 2). Start
-- tomorrow so every occurrence is future (and independent of the two delivered
-- above, which belong to a different enrolment).
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start,
        duration_minutes, start_date, total_sessions, sessions_already_delivered, migrated_from_legacy)
values ('00000000-0000-0000-0000-0000000e1002','00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-0000000f0001','09:00', 30, current_date + 1, 5, 2, true);
select public.generate_classes(30);
select is(
  (select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-0000000e1002'),
  3,
  'generation halts at total_sessions - sessions_already_delivered (5 - 2 = 3)'
);

select * from finish();
rollback;
