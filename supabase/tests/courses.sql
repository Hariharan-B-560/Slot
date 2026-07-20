-- =============================================================================
-- courses.sql — the course enum is the real four-course list, and only those.
-- Course is a display label with identical mechanics across all four; the only
-- DB guarantee is that an unknown value cannot be stored.
-- =============================================================================

begin;
select plan(2);

insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-00000000ca01', 'Course Student', 'lead');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-00000000ca01', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');

-- A valid new-list course is accepted.
select lives_ok(
  $$ insert into public.enrolments
       (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, course)
     values ('00000000-0000-0000-0000-00000000ca01','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-00000000cb01','13:00', 30, current_date, 8, 'speaking_partner') $$,
  'a valid course (speaking_partner) is accepted'
);

-- An unknown / removed value (the old 'elp') is rejected at the enum cast.
select throws_ok(
  $$ insert into public.enrolments
       (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, course)
     values ('00000000-0000-0000-0000-00000000ca01','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-00000000cb01','13:30', 30, current_date, 8, 'elp') $$,
  '22P02', null,
  'an unknown course value is rejected (invalid enum input)'
);

select * from finish();
rollback;
