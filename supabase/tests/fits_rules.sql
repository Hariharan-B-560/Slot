-- =============================================================================
-- fits_rules.sql — pins the duration-aware start logic of available_slots.
--   An atom A is a valid start for duration D iff EVERY atom in [A, A+D) is
--   (a) inside the teacher's published window and (b) not covered by any
--   active enrolment. Half-open throughout: a session ending 18:00 must not
--   block an 18:00 start.
-- Regression: runs published as many TOUCHING per-slot blocks (what the app's
-- publish/split actions create) must offer the same 60-min starts as one wide
-- block. The old fits checked span-end against the SINGLE containing block's
-- end, so per-slot blocks never fit a 60 (t+60 <= t+30 is always false).
-- Fixtures use Teacher Two; each case reshapes their blocks inside this txn.
-- =============================================================================

begin;
select plan(6);

-- Clean slate for Teacher Two: drop the seeded 17:00–19:00 block.
delete from public.availability_blocks
 where teacher_id = '00000000-0000-0000-0000-000000000b02';

-- Students + conversions for the booked cases (RULE 4: enrolment needs one).
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000000f1'::uuid, 'Fits Student X', 'lead'),
  ('00000000-0000-0000-0000-0000000000f2'::uuid, 'Fits Student Y', 'lead'),
  ('00000000-0000-0000-0000-0000000000f3'::uuid, 'Fits Student Z', 'lead');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000f1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000f2', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000f3', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- === CASE 1 — the regression core ===========================================
-- Free 19:00–21:00 published as FOUR touching per-slot blocks, nothing booked.
-- 60-min starts must be exactly 19:00, 19:30, 20:00 (20:30 would overrun).
insert into public.availability_blocks (teacher_id, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000b02', '19:00', '19:30'),
  ('00000000-0000-0000-0000-000000000b02', '19:30', '20:00'),
  ('00000000-0000-0000-0000-000000000b02', '20:00', '20:30'),
  ('00000000-0000-0000-0000-000000000b02', '20:30', '21:00');

select is(
  (select array_agg(slot_start order by slot_start) filter (where fits)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 60)),
  array['19:00','19:30','20:00']::time[],
  'touching per-slot blocks: 60-min starts are 19:00, 19:30, 20:00 — not 20:30'
);
select is(
  (select array_agg(slot_start order by slot_start) filter (where fits)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 30)),
  array['19:00','19:30','20:00','20:30']::time[],
  'same atoms: all four fit a 30 (the free-atom set is identical)'
);

-- === CASE 2 — a run of exactly two atoms → exactly one 60 start =============
delete from public.availability_blocks
 where teacher_id = '00000000-0000-0000-0000-000000000b02';
insert into public.availability_blocks (teacher_id, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000b02', '10:00', '10:30'),
  ('00000000-0000-0000-0000-000000000b02', '10:30', '11:00');

select is(
  (select array_agg(slot_start order by slot_start) filter (where fits)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 60)),
  array['10:00']::time[],
  'two-atom run: exactly one valid 60 start (the first atom)'
);

-- === CASE 3 — a lone free atom between two bookings =========================
-- Window 17:00–20:00; booked 17:00–18:00 (60), 18:30–19:30 (60), 19:30–20:00
-- (30). Only 18:00 is free → zero 60 starts, one 30 start.
delete from public.availability_blocks
 where teacher_id = '00000000-0000-0000-0000-000000000b02';
insert into public.availability_blocks (teacher_id, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000b02', '17:00', '20:00');
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000000d4', '17:00', 60, current_date, 4),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000000d5', '18:30', 60, current_date, 4),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000000d6', '19:30', 30, current_date, 4);

select is(
  (select count(*)::int from public.available_slots('00000000-0000-0000-0000-000000000b02', 60) where fits),
  0,
  'lone free atom between bookings: zero 60-min starts'
);
select is(
  (select array_agg(slot_start order by slot_start) filter (where fits)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 30)),
  array['18:00']::time[],
  'lone free atom between bookings: exactly one 30-min start (18:00)'
);

-- === CASE 4 — half-open: a booking ENDING 18:00 does not block an 18:00 start
-- Window 17:00–19:00; booked 17:00–18:00 (60) only → 18:00 IS a valid 60 start.
update public.enrolments set status = 'cancelled'
 where id in ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6');
delete from public.availability_blocks
 where teacher_id = '00000000-0000-0000-0000-000000000b02';
insert into public.availability_blocks (teacher_id, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000b02', '17:00', '19:00');

select is(
  (select array_agg(slot_start order by slot_start) filter (where fits)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 60)),
  array['18:00']::time[],
  'half-open: a booking ending 18:00 leaves 18:00 as a valid 60 start'
);

select * from finish();
rollback;
