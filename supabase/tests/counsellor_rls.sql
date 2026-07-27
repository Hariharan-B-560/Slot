-- =============================================================================
-- counsellor_rls.sql — the counsellor role is strictly READ-ONLY.
--   CAN read: availability, students, enrolments (slot bookings), available_slots
--   CANNOT read: conversion_events, classes, payments (admin/teacher-only)
--   CANNOT write: no insert/update/delete on the tables they can read
-- Uses the seeded counsellor (d01). A payment + a demo class are seeded as
-- superuser first so the read-denials are proven against real rows.
-- =============================================================================

begin;
select plan(12);

-- Sensitive rows the counsellor must NOT see (inserted as superuser, bypassing RLS).
insert into public.payments (enrolment_id, amount, paid_at, recorded_by)
values ('00000000-0000-0000-0000-0000000000f1', 1000, now(), '00000000-0000-0000-0000-000000000a01');
insert into public.classes (slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01',
        now() + interval '2 days', now() + interval '2 days' + interval '30 minutes', now());

-- === Act as the counsellor ==================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000d01","role":"authenticated"}', true);

-- --- CAN read the three allowed surfaces ------------------------------------
select ok((select count(*) from public.students) > 0,
  'counsellor can read students');
select ok((select count(*) from public.availability_blocks) > 0,
  'counsellor can read availability_blocks');
select ok((select count(*) from public.enrolments) > 0,
  'counsellor can read enrolments (slot bookings)');
select ok((select count(*) from public.available_slots('00000000-0000-0000-0000-000000000b01', 30)) > 0,
  'counsellor can read the availability grid via available_slots ("slot taken by X")');

-- --- CANNOT read admin/teacher-only tables (rows exist; RLS returns none) ----
select is((select count(*)::int from public.conversion_events), 0,
  'counsellor cannot read conversion_events');
select is((select count(*)::int from public.classes), 0,
  'counsellor cannot read classes (teacher/admin only)');
select is((select count(*)::int from public.payments), 0,
  'counsellor cannot read payments');

-- --- CANNOT write anything --------------------------------------------------
select throws_ok(
  $$ insert into public.students (name, status) values ('Sneaky', 'lead') $$,
  '42501', null, 'counsellor cannot INSERT a student');

-- UPDATE/DELETE with no matching policy silently touch zero rows (no error).
-- Prove it by running them and asserting the target rows are unchanged.
update public.students set name = name || '!' where id = '00000000-0000-0000-0000-000000000c01';
select is((select name from public.students where id = '00000000-0000-0000-0000-000000000c01'),
  'Student One', 'counsellor UPDATE of a student changes nothing');
delete from public.students where id = '00000000-0000-0000-0000-000000000c01';
select is((select count(*)::int from public.students where id = '00000000-0000-0000-0000-000000000c01'),
  1, 'counsellor DELETE of a student removes nothing');

select throws_ok(
  $$ insert into public.availability_blocks (teacher_id, start_time, end_time)
     values ('00000000-0000-0000-0000-000000000b01', '09:00', '10:00') $$,
  '42501', null, 'counsellor cannot INSERT availability for a teacher');
update public.enrolments set status = 'ended' where id = '00000000-0000-0000-0000-0000000000f1';
select is((select status from public.enrolments where id = '00000000-0000-0000-0000-0000000000f1'),
  'active', 'counsellor UPDATE of an enrolment changes nothing');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
