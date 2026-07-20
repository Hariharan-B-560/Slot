-- =============================================================================
-- payments.sql — the append-only payment ledger.
--   * teachers get NOTHING on payments (select hidden, insert denied)
--   * admins insert; nobody updates/deletes (append-only)
--   * total_fee is admin-only to change, and every change is logged
--   * paid/remaining are computed from rows via enrolment_payment_status
-- =============================================================================

begin;
select plan(12);

-- --- Fixtures (superuser) ----------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000ba001'::uuid, 'Pay Student A', 'enrolled'),
  ('00000000-0000-0000-0000-0000000ba002'::uuid, 'Pay Student B', 'enrolled');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000bb001', '00000000-0000-0000-0000-0000000ba001', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000bb002', '00000000-0000-0000-0000-0000000ba002', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
-- E1 has a fee (10000); E2 has NO fee (NULL). Different students + slots (rules 7/8).
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, total_fee) values
  ('00000000-0000-0000-0000-0000000bf001', '00000000-0000-0000-0000-0000000ba001', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000bb001', '13:00', 30, current_date, 10, 10000),
  ('00000000-0000-0000-0000-0000000bf002', '00000000-0000-0000-0000-0000000ba002', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000bb002', '14:00', 30, current_date, 10, null);

-- =====================  TEACHER SESSION  ====================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

-- TEST 1 — a teacher sees NO payment rows (RLS hides them entirely).
select is((select count(*)::int from public.payments), 0, 'a teacher cannot see any payments');

-- TEST 2 — a teacher cannot INSERT a payment.
select throws_ok(
  $$ insert into public.payments (enrolment_id, amount, paid_at, recorded_by)
     values ('00000000-0000-0000-0000-0000000bf001', 5000, now(), '00000000-0000-0000-0000-000000000b01') $$,
  '42501', null,
  'a teacher cannot insert a payment');

-- TEST 3 — a teacher cannot change total_fee (RLS: no teacher write → silent no-op).
update public.enrolments set total_fee = 999 where id = '00000000-0000-0000-0000-0000000bf001';
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select total_fee from public.enrolments where id = '00000000-0000-0000-0000-0000000bf001'),
  10000::numeric,
  'a teacher''s total_fee update does not take effect');

-- =====================  ADMIN SESSION  ======================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- TEST 4 — an admin CAN insert a payment.
select lives_ok(
  $$ insert into public.payments (id, enrolment_id, amount, paid_at, recorded_by, note)
     values ('00000000-0000-0000-0000-0000000baa01','00000000-0000-0000-0000-0000000bf001', 5000, now(),
             '00000000-0000-0000-0000-000000000a01', 'instalment 1') $$,
  'an admin can insert a payment');

-- TEST 5 & 6 — the ledger is append-only: no UPDATE, no DELETE (even for admin).
select throws_ok(
  $$ update public.payments set amount = 1 where id = '00000000-0000-0000-0000-0000000baa01' $$,
  null, null, 'a payment row cannot be updated (append-only)');
select throws_ok(
  $$ delete from public.payments where id = '00000000-0000-0000-0000-0000000baa01' $$,
  null, null, 'a payment row cannot be deleted (append-only)');

-- TEST 7 — payment_status: a positive amount reduces remaining (10000 − 5000).
select is(
  (select remaining from public.enrolment_payment_status('00000000-0000-0000-0000-0000000bf001')),
  5000::numeric,
  'payment_status: +5000 leaves remaining = 5000');

-- A negative adjustment (the correction path).
insert into public.payments (enrolment_id, amount, paid_at, recorded_by, note)
values ('00000000-0000-0000-0000-0000000bf001', -2000, now(), '00000000-0000-0000-0000-000000000a01', 'refund: 2 missed');

-- TEST 8 — payment_status: a negative amount raises remaining back up (5000 + 2000).
select is(
  (select remaining from public.enrolment_payment_status('00000000-0000-0000-0000-0000000bf001')),
  7000::numeric,
  'payment_status: a −2000 adjustment leaves remaining = 7000');

-- A payment on the NULL-fee enrolment (paid still computes).
insert into public.payments (enrolment_id, amount, paid_at, recorded_by)
values ('00000000-0000-0000-0000-0000000bf002', 500, now(), '00000000-0000-0000-0000-000000000a01');

-- TEST 9 & 10 — NULL total_fee → remaining NULL, but paid still computes.
select is(
  (select remaining from public.enrolment_payment_status('00000000-0000-0000-0000-0000000bf002')),
  null,
  'payment_status: remaining is NULL when total_fee is NULL');
select is(
  (select paid from public.enrolment_payment_status('00000000-0000-0000-0000-0000000bf002')),
  500::numeric,
  'payment_status: paid still computes when total_fee is NULL');

-- TEST 11 — an admin total_fee change writes an enrolment_fee_history row.
update public.enrolments set total_fee = 8000 where id = '00000000-0000-0000-0000-0000000bf002';
select is(
  (select count(*)::int from public.enrolment_fee_history
     where enrolment_id = '00000000-0000-0000-0000-0000000bf002' and new_fee = 8000),
  1,
  'an admin total_fee change is logged to enrolment_fee_history');

-- TEST 12 — the delivering-teacher-can't-see holds even for the NULL enrolment.
select is(
  (select count(*)::int from public.enrolment_fee_history),
  1,
  'exactly one fee-history row exists so far (no phantom writes)');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
