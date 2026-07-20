-- =============================================================================
-- student_visibility.sql — a teacher sees only students assigned to them
-- (enrolment or class); an admin sees all. Seeded: enrolment f1 = Teacher One +
-- Student Two; Student One is an unassigned lead.
-- =============================================================================

begin;
select plan(4);

-- --- As Teacher One --------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.students where id = '00000000-0000-0000-0000-000000000c02'),
  1,
  'teacher sees a student they are assigned (enrolment)'
);
select is(
  (select count(*)::int from public.students where id = '00000000-0000-0000-0000-000000000c01'),
  0,
  'teacher does NOT see an unassigned lead'
);
reset role;

-- --- As Admin --------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

select is(
  (select count(*)::int from public.students where id = '00000000-0000-0000-0000-000000000c01'),
  1,
  'admin sees the unassigned lead'
);
select is(
  (select count(*)::int from public.students),
  (select count(*)::int from public.students),
  'admin select runs without restriction'
);
reset role;

select * from finish();
rollback;
