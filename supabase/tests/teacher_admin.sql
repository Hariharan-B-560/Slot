-- =============================================================================
-- teacher_admin.sql — only an admin may manage teacher profiles.
-- A teacher must not be able to retire (deactivate) another teacher.
-- =============================================================================

begin;
select plan(3);

-- --- As Teacher One: try to deactivate Teacher Two -------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

update public.profiles set active = false
  where id = '00000000-0000-0000-0000-000000000b02';   -- RLS: affects 0 rows

reset role;

select is(
  (select active from public.profiles where id = '00000000-0000-0000-0000-000000000b02'),
  true,
  'a teacher cannot deactivate another teacher'
);

-- --- As Admin: deactivate, then reactivate ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

update public.profiles set active = false
  where id = '00000000-0000-0000-0000-000000000b02';

select is(
  (select active from public.profiles where id = '00000000-0000-0000-0000-000000000b02'),
  false,
  'an admin can deactivate a teacher'
);

-- A retired teacher drops out of the utilisation report.
select is(
  (select count(*)::int from public.dashboard_utilisation(current_date - 7, current_date)
   where teacher_id = '00000000-0000-0000-0000-000000000b02'),
  0,
  'a deactivated teacher is excluded from utilisation'
);
reset role;

select * from finish();
rollback;
