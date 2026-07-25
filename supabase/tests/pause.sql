-- =============================================================================
-- pause.sql — pause / resume enrolments ("hold the slot").
--   * only admin changes status (a teacher write is a silent no-op)
--   * a status change is logged to enrolment_status_history by the trigger
--   * the generator makes no classes while paused; resume regenerates today-forward
--   * rule 7 still holds the slot — nobody else can take it while paused
--   * a class cannot be delivered under a paused enrolment
--   * a payment against a paused enrolment is allowed
--   * dashboard_long_paused lists only pauses older than 30 days
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures ---------------------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-00000000d0a1', 'Pause Student', 'enrolled'),
  ('00000000-0000-0000-0000-00000000d0a2', 'Rival Student', 'lead');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-00000000d0b1', '00000000-0000-0000-0000-00000000d0a1', 'admin_signoff', '00000000-0000-0000-0000-000000000a01'),
  ('00000000-0000-0000-0000-00000000d0b2', '00000000-0000-0000-0000-00000000d0a2', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
-- An active enrolment for Teacher Two at 12:00, starting tomorrow (all future).
insert into public.enrolments (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values ('00000000-0000-0000-0000-00000000d0f1', '00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-00000000d0b1', '12:00', 30, current_date + 1, 10);

-- === TEST 1 — a teacher cannot change enrolment status (silent no-op) ========
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
update public.enrolments set status = 'paused', paused_at = now() where id = '00000000-0000-0000-0000-00000000d0f1';
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select status from public.enrolments where id = '00000000-0000-0000-0000-00000000d0f1'),
  'active',
  'a teacher''s status update does not take effect');

-- === Admin session ==========================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);

-- === TEST 2 & 3 — admin pause logs history + flips status ====================
select public.pause_enrolment('00000000-0000-0000-0000-00000000d0f1', 'Travel');
select is(
  (select count(*)::int from public.enrolment_status_history
     where enrolment_id = '00000000-0000-0000-0000-00000000d0f1'
       and previous_status = 'active' and new_status = 'paused' and reason = 'Travel'),
  1, 'admin pause logs an active->paused history row via trigger');
select is(
  (select status from public.enrolments where id = '00000000-0000-0000-0000-00000000d0f1'),
  'paused', 'the enrolment is now paused');

-- === TEST 4 — the generator makes NO classes while paused ===================
select public.generate_classes(30);
select is(
  (select count(*)::int from public.classes where enrolment_id = '00000000-0000-0000-0000-00000000d0f1'),
  0, 'generator creates NO classes while the enrolment is paused');

-- === TEST 5 — rule 7: the slot is still held ================================
select throws_ok(
  $$ insert into public.enrolments (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
     values ('00000000-0000-0000-0000-00000000d0a2','00000000-0000-0000-0000-000000000b02',
             '00000000-0000-0000-0000-00000000d0b2','12:00', 30, current_date + 1, 10) $$,
  '23P01', null,
  'rule 7: another student cannot take a PAUSED student''s slot');

-- === TEST 6 — a class cannot be delivered while the enrolment is paused ======
reset role;  -- superuser: seed an in-window published class for the paused enrolment
insert into public.classes (id, slot_type, teacher_id, student_id, enrolment_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-00000000d0c1','ENROLLED','00000000-0000-0000-0000-000000000b02',
        '00000000-0000-0000-0000-00000000d0a1','00000000-0000-0000-0000-00000000d0f1',30,
        now() - interval '10 minutes', now() + interval '20 minutes', now() - interval '2 hours');
insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
values ('00000000-0000-0000-0000-00000000d0c1','present','p/o.png','p/c.png','00000000-0000-0000-0000-000000000b02');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000b02','role','authenticated')::text, true);
select throws_ok(
  $$ update public.classes set status = 'delivered' where id = '00000000-0000-0000-0000-00000000d0c1' $$,
  '23514', null,
  'a class cannot be delivered while its enrolment is paused');

-- === TEST 7 — a payment against a paused enrolment is allowed ================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.payments (enrolment_id, amount, paid_at, recorded_by, note)
     values ('00000000-0000-0000-0000-00000000d0f1', 3000, now(), '00000000-0000-0000-0000-000000000a01', 'balance while paused') $$,
  'a payment may be recorded against a paused enrolment');

-- === TEST 8 & 9 — resume flips status + regenerates today-forward ============
select public.resume_enrolment('00000000-0000-0000-0000-00000000d0f1');
select is(
  (select status from public.enrolments where id = '00000000-0000-0000-0000-00000000d0f1'),
  'active', 'resume sets the enrolment back to active');
select cmp_ok(
  (select count(*)::int from public.classes
     where enrolment_id = '00000000-0000-0000-0000-00000000d0f1'
       and status = 'published' and scheduled_start > now()),
  '>=', 1, 'resume regenerates future classes (today-forward)');

-- === TEST 10 — dashboard_long_paused lists only >30-day pauses ==============
reset role;  -- backdate a pause to 40 days to exercise the 30-day threshold
update public.enrolments set status = 'paused', paused_at = now() - interval '40 days'
 where id = '00000000-0000-0000-0000-00000000d0f1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
select is(
  (select days_paused from public.dashboard_long_paused()
     where student_id = '00000000-0000-0000-0000-00000000d0a1'),
  40,
  'dashboard_long_paused: a 40-day pause is listed with its day count');

reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
