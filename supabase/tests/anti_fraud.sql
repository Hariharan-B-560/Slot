-- =============================================================================
-- anti_fraud.sql — the six Phase 1 acceptance tests (CLAUDE.md) + positive
-- controls. Runnable via `supabase test db` (pgTAP). Each impersonates a role
-- by setting request.jwt.claims so auth.uid() / RLS behave as in production.
--
-- Seed users (from seed.sql):
--   admin    00000000-0000-0000-0000-000000000a01
--   teacher1 00000000-0000-0000-0000-000000000b01
--   teacher2 00000000-0000-0000-0000-000000000b02
--   student1 00000000-0000-0000-0000-000000000c01
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures (created as the superuser test session; triggers still fire) ---
-- A class well in the FUTURE — used to prove out-of-window delivery, ownership,
-- and append-only rules.
insert into public.classes (id, slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000000d1', 'DEMO',
        '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 60,
        now() + interval '2 days', now() + interval '2 days' + interval '1 hour',
        now());

-- Two classes in the CURRENT window, moved to 'delivered' so verify rules can be
-- exercised. d2 = teacher-verify-must-fail; d3 = admin-verify-must-succeed.
insert into public.classes (id, slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values
  ('00000000-0000-0000-0000-0000000000d2', 'DEMO',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 60,
   now() - interval '30 minutes', now() + interval '30 minutes', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000d3', 'DEMO',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 60,
   now() - interval '30 minutes', now() + interval '30 minutes', now() - interval '2 hours');

-- RULE 8: every class that gets delivered needs a session report first. Reports
-- can only be filed inside the class window, so d1 (2 days out) gets none — TEST 1
-- delivering d1 is now blocked by rule 8 / the deliver window either way.
insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by) values
  ('00000000-0000-0000-0000-0000000000d2', 'present', 'd2/o.png', 'd2/c.png', '00000000-0000-0000-0000-000000000b01'),
  ('00000000-0000-0000-0000-0000000000d3', 'present', 'd3/o.png', 'd3/c.png', '00000000-0000-0000-0000-000000000b01');

update public.classes set status = 'delivered'
  where id in ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3');

-- Helper for TEST 6: performs a top-level UPDATE (data-modification must not be
-- nested in a CTE) and returns the number of rows it touched. SECURITY INVOKER
-- (the default) so it runs as the calling role and RLS applies exactly as it
-- would for that user. Created here as the superuser session; EXECUTE defaults
-- to PUBLIC so the impersonated 'authenticated' role can call it.
create function pg_temp.try_flag_class(p_id uuid)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  update public.classes set flag_reason = 'tampered' where id = p_id;
  get diagnostics affected = row_count;
  return affected;
end;
$$;


-- =============================================================================
-- TEST 1 — RULE 1: a teacher marking a class delivered OUTSIDE its window fails.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select throws_ok(
  $$ update public.classes set status = 'delivered'
       where id = '00000000-0000-0000-0000-0000000000d1' $$,
  null, null,
  'RULE 1: teacher cannot mark a class delivered outside its window'
);
reset role;


-- =============================================================================
-- TEST 2 — RULE 2: inserting a class with published_at AFTER scheduled_start fails.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.classes (slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
     values ('DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 60,
             now() + interval '2 days', now() + interval '2 days' + interval '1 hour',
             now() + interval '3 days') $$,
  null, null,
  'RULE 2: published_at after scheduled_start is rejected'
);
reset role;


-- =============================================================================
-- TEST 3 — RULE 4: a teacher attempting INSERT on conversion_events is denied by RLS.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select throws_ok(
  $$ insert into public.conversion_events (student_id, type, recorded_by)
     values ('00000000-0000-0000-0000-000000000c01', 'admin_signoff',
             '00000000-0000-0000-0000-000000000a01') $$,
  '42501', null,
  'RULE 4: teacher has no INSERT on conversion_events (RLS denies)'
);
reset role;


-- =============================================================================
-- TEST 4 — RULE 5: a teacher setting a class to verified is rejected.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);

select throws_ok(
  $$ update public.classes set status = 'verified'
       where id = '00000000-0000-0000-0000-0000000000d2' $$,
  null, null,
  'RULE 5: delivering teacher cannot verify their own class'
);
reset role;


-- =============================================================================
-- TEST 5 — RULE 3: rewriting a historical classes row (UPDATE) or DELETE is denied.
-- Run as superuser to prove the append-only trigger blocks even privileged writes.
-- =============================================================================
select throws_ok(
  $$ update public.classes set scheduled_start = now() + interval '5 days'
       where id = '00000000-0000-0000-0000-0000000000d1' $$,
  null, null,
  'RULE 3: mutating an immutable historical column is denied'
);

select throws_ok(
  $$ delete from public.classes
       where id = '00000000-0000-0000-0000-0000000000d1' $$,
  null, null,
  'RULE 3: deleting a classes row is denied (corrections are new rows)'
);


-- =============================================================================
-- TEST 6 — RULE 6: a teacher cannot read or write another teacher's classes row.
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b02","role":"authenticated"}', true);

-- Read denied → RLS makes teacher1's row invisible to teacher2 (0 rows).
select is(
  (select count(*)::int from public.classes where id = '00000000-0000-0000-0000-0000000000d1'),
  0,
  'RULE 6: teacher2 cannot read teacher1''s class'
);

-- Write denied → RLS filters the row out, so the UPDATE affects 0 rows.
-- (Run via a helper so the UPDATE is a top-level statement, not a nested CTE.)
select is(
  pg_temp.try_flag_class('00000000-0000-0000-0000-0000000000d1'),
  0,
  'RULE 6: teacher2 cannot update teacher1''s class'
);

-- Inserting a row owned by another teacher fails the WITH CHECK.
select throws_ok(
  $$ insert into public.classes (slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end)
     values ('DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01', 60,
             now() + interval '2 days', now() + interval '2 days' + interval '1 hour') $$,
  '42501', null,
  'RULE 6: teacher2 cannot insert a class owned by teacher1'
);
reset role;


-- =============================================================================
-- POSITIVE CONTROL — an admin CAN verify a delivered class (proves the layer
-- blocks fraud without blocking the legitimate path).
-- =============================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

select lives_ok(
  $$ update public.classes set status = 'verified'
       where id = '00000000-0000-0000-0000-0000000000d3' $$,
  'POSITIVE: an admin can verify a delivered class'
);
reset role;


select * from finish();
rollback;
