-- =============================================================================
-- teacher_pay.sql — teacher pay is verified-only, atom-based, admin-only.
--   * verified 30 + verified 60 → 3 atoms, 2 classes, gross = 3 × rate
--   * a delivered-but-unverified class pays nothing
--   * a verified class outside the range pays nothing
--   * a teacher session gets zero rows (no pay figures, even own)
--   * an admin rate change writes a rate_history row (previous/new/reason)
--   * a teacher cannot change their own rate (self-update guard)
-- =============================================================================

begin;
select plan(11);

-- --- Fixtures ---------------------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-00000000e0a1', 'Pay-calc Student', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-00000000e0b1', '00000000-0000-0000-0000-00000000e0a1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-00000000e0f1', '00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-00000000e0b1', '15:00', 30, current_date - 60, 40);

-- Give Teacher Two a known rate.
update public.profiles set rate_per_30min = 100 where id = '00000000-0000-0000-0000-000000000b02';

-- Seed historical classes directly (lifecycle trigger forbids creating terminal
-- states; disable it for the fixtures only — rolled back with the txn).
alter table public.classes disable trigger classes_enforce_lifecycle;
create or replace function pg_temp.mk(p_id uuid, p_dur int, p_start timestamptz, p_status public.class_status)
returns void language plpgsql as $$
begin
  insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes,
                              scheduled_start, scheduled_end, published_at, status, delivered_at, verified_at)
  values (p_id, 'ENROLLED', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000e0a1',
          '00000000-0000-0000-0000-00000000e0f1', p_dur, p_start, p_start + make_interval(mins => p_dur),
          p_start - interval '2 hours', p_status,
          case when p_status in ('delivered','verified','flagged') then p_start + interval '10 minutes' end,
          case when p_status = 'verified' then p_start + interval '20 minutes' end);
end $$;
-- In range: a verified 30 (1 atom) + a verified 60 (2 atoms) = 3 atoms.
select pg_temp.mk('00000000-0000-0000-0000-00000000e001', 30, now() - interval '5 days', 'verified');
select pg_temp.mk('00000000-0000-0000-0000-00000000e002', 60, now() - interval '4 days', 'verified');
-- In range but only DELIVERED (unverified) → pays nothing.
select pg_temp.mk('00000000-0000-0000-0000-00000000e003', 60, now() - interval '3 days', 'delivered');
-- Verified but OUTSIDE the range (90 days ago) → pays nothing.
select pg_temp.mk('00000000-0000-0000-0000-00000000e004', 30, now() - interval '90 days', 'verified');
alter table public.classes enable trigger classes_enforce_lifecycle;

-- === TEACHER SESSION — no pay figures ======================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);
select is((select count(*)::int from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)), 0,
  'a teacher gets nothing from teacher_pay (even their own)');
select is((select count(*)::int from public.teacher_pay_all(current_date - 30, current_date)), 0,
  'a teacher gets nothing from teacher_pay_all');

-- A teacher cannot change their own rate — the self-update guard raises.
select throws_ok(
  $$ update public.profiles set rate_per_30min = 999 where id = '00000000-0000-0000-0000-000000000b02' $$,
  '42501', null, 'a teacher cannot change their own rate (self-update guard blocks it)');
reset role;
select set_config('request.jwt.claims', '', true);

-- === ADMIN SESSION =========================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- === atoms / classes / gross ================================================
select is(
  (select verified_atoms from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)),
  3::numeric, 'verified atoms = 1 (30-min) + 2 (60-min) = 3');
select is(
  (select verified_classes from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)),
  2, 'verified classes = 2 (the delivered-unverified one is excluded)');
select is(
  (select gross_pay from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)),
  300::numeric, 'gross = 3 atoms × rate 100 = 300');
select is(
  (select rate_per_30min from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)),
  100::numeric, 'reports the current rate');

-- teacher_pay_all carries the same figures per teacher.
select is(
  (select gross_pay from public.teacher_pay_all(current_date - 30, current_date)
     where teacher_id = '00000000-0000-0000-0000-000000000b02'),
  300::numeric, 'teacher_pay_all: same gross per teacher');

-- === set_teacher_rate writes rate_history ==================================
select public.set_teacher_rate('00000000-0000-0000-0000-000000000b02', 120, 'raise');
select is(
  (select count(*)::int from public.rate_history
     where teacher_id = '00000000-0000-0000-0000-000000000b02'
       and previous_rate = 100 and new_rate = 120 and reason = 'raise'),
  1, 'an admin rate change writes a rate_history row');
select is(
  (select gross_pay from public.teacher_pay('00000000-0000-0000-0000-000000000b02', current_date - 30, current_date)),
  360::numeric, 'gross recomputes on the new rate (3 × 120 = 360)');

-- A teacher cannot call set_teacher_rate either.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.set_teacher_rate('00000000-0000-0000-0000-000000000b02', 5, 'sneaky') $$,
  null, null, 'a teacher cannot call set_teacher_rate');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
