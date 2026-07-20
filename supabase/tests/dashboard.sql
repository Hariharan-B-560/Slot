-- =============================================================================
-- dashboard.sql — admin dashboard + integrity metrics.
--   * every metric is admin-only (a teacher session gets zero rows)
--   * utilisation denominators exclude Sundays + unopened Saturdays
--   * the delivered−verified gap flags a fabricating teacher over 20%
--   * renewals count legacy + in-app deliveries together
--   * attendance risk finds >7-day-silent students
--   * verify backlog counts only delivered >48h and still unverified
--   * integrity_summary is clean on a clean range, amber with a seeded gap
-- =============================================================================

begin;
select plan(18);

-- --- Fixtures ---------------------------------------------------------------
-- Teacher Two (b02) is the "fabricator": 5 ever-delivered, 3 verified → gap 40%.
-- Teacher One (b01) stays clean for contrast.
insert into public.students (id, name, phone, status) values
  ('00000000-0000-0000-0000-00000000da01', 'Dash Renewal', '+91-1', 'enrolled'),
  ('00000000-0000-0000-0000-00000000da02', 'Dash Silent',  '+91-2', 'enrolled'),
  ('00000000-0000-0000-0000-00000000da03', 'Dash Volume',  '+91-3', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-00000000db01', '00000000-0000-0000-0000-00000000da01', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-00000000db02', '00000000-0000-0000-0000-00000000da02', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-00000000db03', '00000000-0000-0000-0000-00000000da03', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- Renewal case: 10 total, 8 already delivered on legacy, +1 in app → 1 left.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
                               start_date, total_sessions, sessions_already_delivered)
values ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-00000000da01',
        '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000db01',
        '12:00', 30, current_date - 60, 10, 8);
-- Silent case: an active enrolment whose ONLY delivered class is 9 days old.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
                               start_date, total_sessions)
values ('00000000-0000-0000-0000-00000000dc02', '00000000-0000-0000-0000-00000000da02',
        '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000db02',
        '12:30', 30, current_date - 60, 40);
-- Volume case: carries the rest of Teacher Two's history so the silent student
-- stays silent and the renewal count stays exact.
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
                               start_date, total_sessions)
values ('00000000-0000-0000-0000-00000000dc03', '00000000-0000-0000-0000-00000000da03',
        '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000db03',
        '13:00', 30, current_date - 60, 40);

-- These metrics need HISTORICAL classes in terminal states (delivered/verified/
-- flagged, days in the past). The lifecycle trigger rightly forbids creating
-- those directly — delivery must happen inside the window with a report — so we
-- switch it off for the fixture inserts only. The lifecycle itself is covered by
-- anti_fraud.sql / phase15_rules.sql; here we're testing the METRICS.
-- DDL is transactional, so the rollback restores the trigger.
alter table public.classes disable trigger classes_enforce_lifecycle;

create or replace function pg_temp.mk_class(p_id uuid, p_teacher uuid, p_enrol uuid, p_student uuid,
                                            p_start timestamptz, p_status public.class_status)
returns void language plpgsql as $$
begin
  -- slot_type must agree with enrolment_id (classes_check1).
  insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes,
                              scheduled_start, scheduled_end, published_at, status,
                              delivered_at, verified_at)
  values (p_id, case when p_enrol is null then 'DEMO' else 'ENROLLED' end::public.slot_type,
          p_teacher, p_student, p_enrol, 30,
          p_start, p_start + interval '30 minutes', p_start - interval '2 hours', p_status,
          case when p_status in ('delivered','verified','flagged') then p_start + interval '10 minutes' end,
          case when p_status = 'verified' then p_start + interval '20 minutes' end);
end $$;

-- Silent student: ONE delivered class, 9 days ago — nothing since.
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc02','00000000-0000-0000-0000-00000000da02', now() - interval '9 days',  'verified');
-- Volume student: the rest of Teacher Two's in-range history (2 verified,
-- 1 delivered-unverified, 1 flagged) — this is what opens the gap.
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e002','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc03','00000000-0000-0000-0000-00000000da03', now() - interval '8 days',  'verified');
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e003','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc03','00000000-0000-0000-0000-00000000da03', now() - interval '7 days',  'verified');
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e004','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc03','00000000-0000-0000-0000-00000000da03', now() - interval '6 days',  'delivered');
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e005','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc03','00000000-0000-0000-0000-00000000da03', now() - interval '5 days',  'flagged');
-- The renewal student's single in-app delivery.
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e006','00000000-0000-0000-0000-000000000b02','00000000-0000-0000-0000-00000000dc01','00000000-0000-0000-0000-00000000da01', now() - interval '4 days', 'verified');
-- Backlog controls: delivered 1h ago (too fresh) and verified 3d ago (already done).
select pg_temp.mk_class('00000000-0000-0000-0000-00000000e007','00000000-0000-0000-0000-000000000b01',null,'00000000-0000-0000-0000-00000000da01', now() - interval '1 hour', 'delivered');

alter table public.classes enable trigger classes_enforce_lifecycle;

-- =====================  TEACHER SESSION — everything is empty  ==============
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select is((select count(*)::int from public.dashboard_headline(current_date - 30, current_date)), 0,
  'teacher: dashboard_headline returns nothing');
select is((select count(*)::int from public.dashboard_renewals()), 0,
  'teacher: dashboard_renewals returns nothing');
select is((select count(*)::int from public.dashboard_attendance_risk()), 0,
  'teacher: dashboard_attendance_risk returns nothing');
select is((select count(*)::int from public.dashboard_verify_backlog()), 0,
  'teacher: dashboard_verify_backlog returns nothing');
select is((select count(*)::int from public.integrity_by_teacher(current_date - 30, current_date)), 0,
  'teacher: integrity_by_teacher returns nothing');
select is((select count(*)::int from public.integrity_summary(current_date - 30, current_date)), 0,
  'teacher: integrity_summary returns nothing');
select is((select count(*)::int from public.dashboard_money(current_date - 30, current_date)), 0,
  'teacher: dashboard_money returns nothing');
select is((select count(*)::int from public.dashboard_trend(current_date - 30, current_date)), 0,
  'teacher: dashboard_trend returns nothing');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================  ADMIN SESSION  ======================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- TEST 8 — utilisation denominator excludes Sundays + unopened Saturdays.
-- A full week has 5 open days by default; opening a Saturday makes it 6, which
-- must LOWER utilisation (bigger denominator) for the same verified hours.
select is(
  public.open_days_count('00000000-0000-0000-0000-000000000b02',
    date_trunc('week', current_date)::date + 7, date_trunc('week', current_date)::date + 13),
  5,
  'utilisation denominator: a default week counts 5 open days (no Sun, no Sat)');

-- TEST 9 & 10 — the delivered−verified gap flags the fabricator, not the clean teacher.
-- Threshold, not an exact figure: the seed contributes its own classes, so
-- pinning a number would make this test brittle for no added meaning.
select cmp_ok(
  (select gap_pct from public.integrity_by_teacher(current_date - 30, current_date)
    where teacher_id = '00000000-0000-0000-0000-000000000b02'),
  '>=', 20::numeric,
  'integrity: the fabricating teacher''s delivered−verified gap is over 20%');
select is(
  (select concerning from public.integrity_by_teacher(current_date - 30, current_date)
    where teacher_id = '00000000-0000-0000-0000-000000000b02'),
  true,
  'integrity: a 40% gap is concerning (≥20% threshold)');

-- TEST 11 — renewals count legacy + in-app deliveries together (8 + 1 of 10 → 1 left).
select is(
  (select sessions_left from public.dashboard_renewals()
    where student_id = '00000000-0000-0000-0000-00000000da01'),
  1,
  'renewals: 10 total − (8 legacy + 1 in-app) = 1 session left');

-- TEST 12 — attendance risk finds the 9-days-silent student, and only real risks.
select is(
  (select count(*)::int from public.dashboard_attendance_risk()
    where student_id = '00000000-0000-0000-0000-00000000da02'),
  1,
  'attendance risk: a student silent for 9 days is listed');

-- TEST 13 — verify backlog counts only delivered >48h that are still unverified.
-- e004 (delivered, 6d) qualifies; e007 (delivered, 1h) and the verified ones don't.
select is(
  (select cnt from public.dashboard_verify_backlog()),
  1,
  'verify backlog: only the >48h delivered-and-unverified class counts');

-- TEST — the trend buckets daily for a short range and weekly for a long one.
select is(
  (select count(*)::int from public.dashboard_trend(current_date - 6, current_date)),
  7,
  'trend: a 7-day range yields 7 daily buckets');
select cmp_ok(
  (select count(*)::int from public.dashboard_trend(current_date - 89, current_date)),
  '<=', 15,
  'trend: a 90-day range switches to weekly buckets (not 90 points)');
-- The volume student's 4 classes (3 ever-delivered before today) land in range.
select cmp_ok(
  (select sum(delivered)::int from public.dashboard_trend(current_date - 30, current_date)),
  '>=', 5,
  'trend: delivered totals include the seeded in-range history');

-- TEST 14 — integrity_summary is non-zero with the seeded gap (strip goes amber).
select is(
  (select concerning_teachers > 0 or flagged_classes > 0
     from public.integrity_summary(current_date - 30, current_date)),
  true,
  'integrity strip: concerning state when a fabricated gap is present');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
