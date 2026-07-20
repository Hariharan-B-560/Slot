-- =============================================================================
-- auth_rules.sql — the policies that make auth real.
--   * anon reads nothing
--   * a forced user (must_change_password) cannot act, but CAN read own profile
--     and clear their own flag
--   * a retired user (active=false) cannot act
--   * a teacher cannot read another teacher's session_reports (rule 6)
--   * a teacher cannot self-escalate their role
-- Helpers: `imp(uid)` impersonates; `su()` returns to a clean superuser context
-- (role reset + jwt cleared, so auth.uid() is null and the self-update guard
-- treats fixture writes as unrestricted).
-- =============================================================================

begin;
select plan(9);

create or replace function pg_temp.imp(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.su() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- --- Fixtures (superuser, no jwt) ------------------------------------------
insert into public.students (id, name, status)
values ('00000000-0000-0000-0000-0000000a9001', 'Auth Student', 'lead');

-- A class owned by Teacher Two, in its window, with a report on it.
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000a9c01', 'DEMO',
        '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000a9001',
        now() - interval '15 minutes', now() + interval '15 minutes', now() - interval '1 hour');
insert into public.session_reports (id, class_id, attendance, opening_screenshot, closing_screenshot, created_by)
values ('00000000-0000-0000-0000-0000000a9e01', '00000000-0000-0000-0000-0000000a9c01',
        'present', 'x/o.png', 'x/c.png', '00000000-0000-0000-0000-000000000b02');

-- === TEST 1 & 2 — anon reads nothing ======================================
set local role anon;
select throws_ok('select 1 from public.classes limit 1',  '42501', null, 'anon cannot read classes');
select throws_ok('select 1 from public.profiles limit 1', '42501', null, 'anon cannot read profiles');
select pg_temp.su();

-- === TEST 3 & 4 — a forced user cannot act, but can read own profile =======
update public.profiles set must_change_password = true where id = '00000000-0000-0000-0000-000000000b01';
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');

select is(
  (select count(*)::int from public.classes),
  0,
  'a must_change_password user cannot act (own classes are filtered)'
);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000b01'),
  1,
  'a must_change_password user CAN still read their own profile row'
);
select pg_temp.su();
update public.profiles set must_change_password = false where id = '00000000-0000-0000-0000-000000000b01';

-- === TEST 5 — a retired (inactive) user cannot act =========================
update public.profiles set active = false where id = '00000000-0000-0000-0000-000000000b01';
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');
select is(
  (select count(*)::int from public.classes),
  0,
  'a retired (active=false) user cannot act'
);
select pg_temp.su();
update public.profiles set active = true where id = '00000000-0000-0000-0000-000000000b01';

-- === TEST 6 — teacher cannot read another teacher's session_reports ========
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');
select is(
  (select count(*)::int from public.session_reports where id = '00000000-0000-0000-0000-0000000a9e01'),
  0,
  'RULE 6: a teacher cannot read another teacher''s session_reports'
);
select pg_temp.su();

-- === TEST 7 — teacher cannot self-escalate their role ======================
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000b01' $$,
  '42501', null,
  'a teacher cannot escalate their own role'
);
select pg_temp.su();

-- === TEST 8 — a forced user CAN clear their own password flag (the escape) ==
update public.profiles set must_change_password = true where id = '00000000-0000-0000-0000-000000000b01';
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');
select lives_ok(
  $$ update public.profiles set must_change_password = false where id = '00000000-0000-0000-0000-000000000b01' $$,
  'a forced user may clear their own must_change_password (true -> false)'
);
select pg_temp.su();

-- === TEST 9 — teachers do NOT create classes (only admin placement / generator) ==
set local role authenticated;
select pg_temp.imp('00000000-0000-0000-0000-000000000b01');
select throws_ok(
  $$ insert into public.classes (slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
     values ('DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 30,
             now() + interval '1 hour', now() + interval '1 hour' + interval '30 minutes', now()) $$,
  '42501', null,
  'a teacher cannot create a class (no INSERT policy)'
);
select pg_temp.su();

select * from finish();
rollback;
