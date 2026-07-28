-- =============================================================================
-- admin_retro_close.sql — the ONE fenced way to recover a "taught but forgot to
-- mark delivered" class.
--   * a teacher cannot retro-close (admin only)
--   * the published->verified side door is now CLOSED (must go via delivered)
--   * admin retro-close → verified, delivered_at = the class window,
--     delivered_by = the TEACHER, verified_by = the ADMIN, + report + audit row
--   * a class older than 3 days is rejected
--   * a class still inside its window is rejected (deliver it normally)
--   * a teacher cannot read the retro-close audit
-- =============================================================================

begin;
select plan(12);

-- --- Fixtures (superuser): three past DEMO classes for Teacher One -----------
-- C1: yesterday, window passed, retro-closable.
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000ac101', 'DEMO', '00000000-0000-0000-0000-000000000b01',
        '00000000-0000-0000-0000-000000000c01',
        now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', now() - interval '1 day 2 hours');
-- C2: four days ago — too old.
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000ac102', 'DEMO', '00000000-0000-0000-0000-000000000b01',
        '00000000-0000-0000-0000-000000000c01',
        now() - interval '4 days', now() - interval '4 days' + interval '30 minutes', now() - interval '4 days 2 hours');
-- C3: happening now — still inside its window.
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-0000000ac103', 'DEMO', '00000000-0000-0000-0000-000000000b01',
        '00000000-0000-0000-0000-000000000c01',
        now() - interval '5 minutes', now() + interval '25 minutes', now() - interval '2 hours');

-- === TEACHER cannot retro-close ============================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
select throws_ok(
  $$ select public.admin_retro_close('00000000-0000-0000-0000-0000000ac101', 'mine', 'o.png', 'c.png') $$,
  '42501', null, 'a teacher cannot retro-close a class');
reset role;
select set_config('request.jwt.claims', '', true);

-- === ADMIN =================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- Side door is closed: an admin cannot jump a published class straight to verified.
select throws_ok(
  $$ update public.classes set status = 'verified' where id = '00000000-0000-0000-0000-0000000ac101' $$,
  '23514', null, 'published -> verified is blocked (must be delivered first)');

-- The sanctioned path succeeds.
select lives_ok(
  $$ select public.admin_retro_close('00000000-0000-0000-0000-0000000ac101', 'Teacher forgot to click', 'o.png', 'c.png') $$,
  'admin can retro-close a missed class with evidence + reason');

select is((select status from public.classes where id = '00000000-0000-0000-0000-0000000ac101'),
  'verified', 'the class is now verified');
select is((select delivered_at from public.classes where id = '00000000-0000-0000-0000-0000000ac101'),
  (select scheduled_end from public.classes where id = '00000000-0000-0000-0000-0000000ac101'),
  'delivered_at is stamped to the class window (not now)');
select is((select delivered_by from public.classes where id = '00000000-0000-0000-0000-0000000ac101'),
  '00000000-0000-0000-0000-000000000b01', 'delivered_by credits the TEACHER');
select is((select verified_by from public.classes where id = '00000000-0000-0000-0000-0000000ac101'),
  '00000000-0000-0000-0000-000000000a01', 'verified_by is the ADMIN (no self-verify)');
select is((select count(*)::int from public.session_reports where class_id = '00000000-0000-0000-0000-0000000ac101'),
  1, 'evidence (a session report) was filed');
select is((select count(*)::int from public.retro_close_events
     where class_id = '00000000-0000-0000-0000-0000000ac101' and reason = 'Teacher forgot to click'),
  1, 'an audit row was written');

-- Guards: too old, and still-in-window.
select throws_ok(
  $$ select public.admin_retro_close('00000000-0000-0000-0000-0000000ac102', 'late', 'o.png', 'c.png') $$,
  '23514', null, 'a class older than 3 days cannot be retro-closed');
select throws_ok(
  $$ select public.admin_retro_close('00000000-0000-0000-0000-0000000ac103', 'early', 'o.png', 'c.png') $$,
  '23514', null, 'a class still in its window cannot be retro-closed (deliver normally)');

reset role;
select set_config('request.jwt.claims', '', true);

-- === TEACHER cannot read the audit =========================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
select is((select count(*)::int from public.retro_close_events), 0,
  'a teacher cannot read retro_close_events (admin only)');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
