-- =============================================================================
-- slot_rules.sql — MIXED DURATIONS (30/60) model.
--   RULE 7: no two ACTIVE enrolments' [slot_start, slot_start+duration) ranges
--           overlap for a teacher (range EXCLUDE — a 60 blocks BOTH its atoms).
--   duration_minutes must be 30 or 60.
--   RULE 8: one active enrolment per (student, teacher).
--   available_slots(teacher, duration): where can a session of that length start.
-- Teacher Two's seeded block is 17:00–19:00 → atoms 17:00 17:30 18:00 18:30.
-- =============================================================================

begin;
select plan(12);

insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'Slot Student A', 'lead'),
  ('00000000-0000-0000-0000-0000000000a2', 'Slot Student B', 'lead'),
  ('00000000-0000-0000-0000-0000000000a3', 'Slot Student C', 'lead');

insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- TEST 1 — baseline: Student A takes a 60-min session 17:00–18:00 (two atoms).
select lives_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c1','17:00', 60, current_date, 4) $$,
  'baseline: a 60-min enrolment 17:00–18:00 is accepted'
);

-- TEST 2 — RULE 7: a booking overlapping the SECOND atom (17:30) is rejected.
select throws_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c2','17:30', 30, current_date, 4) $$,
  '23P01', null,
  'RULE 7: a 30 at 17:30 overlaps the second atom of the 17:00–18:00 booking → rejected'
);

-- TEST 3 — adjacency: a 30 at 18:00 (right after the 60 ends) is ALLOWED.
select lives_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c2','18:00', 30, current_date, 4) $$,
  'adjacency: a 30 at 18:00 does not overlap the 17:00–18:00 booking → accepted'
);

-- TEST 4 — duration must be 30 or 60 (multiple of the atom).
select throws_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c3','18:30', 45, current_date, 4) $$,
  '23514', null,
  'duration_minutes = 45 is rejected (not 30 or 60)'
);

-- TEST 5 — RULE 8: same student cannot hold a second slot with that teacher.
select throws_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c1','18:30', 30, current_date, 4) $$,
  '23505', null,
  'RULE 8: a second active enrolment for the same (student, teacher) is rejected'
);

-- TEST 6 — an ENDED enrolment does not reserve the range (EXCLUDE covers only
-- active + paused; ended is terminal and releases the slot).
select lives_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, status)
     values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-0000000000c3','17:00', 60, current_date, 4, 'ended') $$,
  'an ended enrolment may overlap an active one'
);

-- === available_slots reflects the DB truth (Teacher Two) ====================
-- After A's 60 (17:00–18:00) + B's 30 (18:00): free atoms = 18:30 only.

-- TEST 7 — the SECOND atom of the 60 (17:30) is occupied, and names its student.
select is(
  (select is_free from public.available_slots('00000000-0000-0000-0000-000000000b02', 30) where slot_start = '17:30'),
  false,
  'available_slots: 17:30 (second atom of the 60) is occupied'
);
select is(
  (select student_name from public.available_slots('00000000-0000-0000-0000-000000000b02', 30) where slot_start = '17:30'),
  'Slot Student A',
  'available_slots: the second atom carries the occupying student'
);

-- TEST 9 — is_occupant_start marks the FIRST atom of the span, not the second.
select is(
  (select array_agg(is_occupant_start order by slot_start)
     from public.available_slots('00000000-0000-0000-0000-000000000b02', 30)
    where slot_start in ('17:00','17:30')),
  array[true, false],
  'available_slots: is_occupant_start is true at 17:00, false at 17:30'
);

-- TEST 10/11 — "fits" for a 60 depends on consecutive free atoms in the window.
--   18:30 alone can host a 30 but NOT a 60 (18:30+60 = 19:30 is past the 19:00 block).
select is(
  (select fits from public.available_slots('00000000-0000-0000-0000-000000000b02', 30) where slot_start = '18:30'),
  true,
  'available_slots(30): a 30 fits at 18:30'
);
select is(
  (select fits from public.available_slots('00000000-0000-0000-0000-000000000b02', 60) where slot_start = '18:30'),
  false,
  'available_slots(60): a 60 does NOT fit at 18:30 (not enough room before the window closes)'
);

-- TEST 12 — an occupied atom never "fits" a new booking.
select is(
  (select fits from public.available_slots('00000000-0000-0000-0000-000000000b02', 30) where slot_start = '17:00'),
  false,
  'available_slots: an occupied atom does not fit a new booking'
);

select * from finish();
rollback;
