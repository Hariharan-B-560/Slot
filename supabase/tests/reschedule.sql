-- =============================================================================
-- reschedule.sql — teachers request, admins decide; a teacher can NEVER move
-- their own class.
--   * teacher cannot INSERT an availability_override (admin-only)
--   * teacher cannot UPDATE their class's scheduled_start (append-only)
--   * teacher CAN file a request for their own class; NOT for another's
--   * approving into an overlapping published slot → rejected (rule 7 EXCLUDE)
--   * a successful approve MOVES the class + writes ONE history row + approves
--   * a delivered class cannot be rescheduled
-- =============================================================================

begin;
select plan(10);

-- --- Fixtures (superuser) ----------------------------------------------------
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-00000000d001'::uuid, 'Resched Student', 'lead');

-- Future, published DEMO classes owned by Teacher One (b01):
--   C1 movable (09:00), C2 collision target (10:00). Two days out so they clear
--   the seed's live published class for b01.
insert into public.classes (id, slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values
  ('00000000-0000-0000-0000-00000000c101', 'DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000d001', 30,
   date_trunc('day', now()) + interval '2 days 9 hours',  date_trunc('day', now()) + interval '2 days 9 hours 30 minutes', now()),
  ('00000000-0000-0000-0000-00000000c102', 'DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000d001', 30,
   date_trunc('day', now()) + interval '2 days 10 hours', date_trunc('day', now()) + interval '2 days 10 hours 30 minutes', now());
-- A future published class owned by Teacher Two (b02) — the "another teacher's class".
insert into public.classes (id, slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values
  ('00000000-0000-0000-0000-00000000c104', 'DEMO', '00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000d001', 30,
   date_trunc('day', now()) + interval '2 days 9 hours',  date_trunc('day', now()) + interval '2 days 9 hours 30 minutes', now());

-- A DELIVERED class owned by b01 (in-window + report, delivered as the teacher).
insert into public.classes (id, slot_type, teacher_id, student_id, duration_minutes, scheduled_start, scheduled_end, published_at)
values
  ('00000000-0000-0000-0000-00000000c103', 'DEMO', '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000d001', 30,
   now() - interval '15 minutes', now() + interval '15 minutes', now() - interval '2 hours');
insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
values ('00000000-0000-0000-0000-00000000c103', 'present', 'r/o.png', 'r/c.png', '00000000-0000-0000-0000-000000000b01');
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000b01')::text, true);
update public.classes set status = 'delivered' where id = '00000000-0000-0000-0000-00000000c103';
select set_config('request.jwt.claims', '', true);

-- === TEST 1 — teacher cannot INSERT an availability_override (admin-only) ====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000b01","role":"authenticated"}', true);
select throws_ok(
  $$ insert into public.availability_overrides (teacher_id, date, kind, created_by)
     values ('00000000-0000-0000-0000-000000000b01', current_date + 3, 'open', '00000000-0000-0000-0000-000000000b01') $$,
  '42501', null,
  'a teacher cannot insert an availability_override (admin only)'
);

-- === TEST 2 — teacher cannot UPDATE scheduled_start on their own class =======
select throws_ok(
  $$ update public.classes set scheduled_start = scheduled_start + interval '1 hour'
       where id = '00000000-0000-0000-0000-00000000c101' $$,
  null, null,
  'a teacher cannot move their own class (scheduled_start is immutable to them)'
);

-- === TEST 3 — teacher CAN file a reschedule request for their OWN class ======
select lives_ok(
  $$ insert into public.reschedule_requests (id, class_id, requested_by, reason)
     values ('00000000-0000-0000-0000-00000000a101','00000000-0000-0000-0000-00000000c101',
             '00000000-0000-0000-0000-000000000b01','sick that day') $$,
  'a teacher may file a reschedule request for their own class'
);

-- === TEST 4 — teacher CANNOT file a request for another teacher's class ======
select throws_ok(
  $$ insert into public.reschedule_requests (class_id, requested_by, reason)
     values ('00000000-0000-0000-0000-00000000c104','00000000-0000-0000-0000-000000000b01','not mine') $$,
  '42501', null,
  'a teacher cannot file a reschedule request for another teacher''s class'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- === TEST 5 — approving into an overlapping published slot → rejected ========
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000a01","role":"authenticated"}', true);
select throws_ok(
  $$ select public.reschedule_class('00000000-0000-0000-0000-00000000c101',
        date_trunc('day', now()) + interval '2 days 10 hours') $$,   -- onto C2's slot
  null, null,
  'approving a move into a taken published slot is rejected (rule 7 overlap)'
);

-- === TEST 6 — a successful approve MOVES the class, writes history, approves ==
select lives_ok(
  $$ select public.reschedule_class('00000000-0000-0000-0000-00000000c101',
        date_trunc('day', now()) + interval '2 days 14 hours',
        '00000000-0000-0000-0000-00000000a101', 'moved to afternoon') $$,
  'admin can reschedule a published class into a free slot'
);
select is(
  (select scheduled_start from public.classes where id = '00000000-0000-0000-0000-00000000c101'),
  date_trunc('day', now()) + interval '2 days 14 hours',
  'the ORIGINAL class row was moved (no duplicate class created)'
);
select is(
  (select count(*)::int from public.class_reschedule_history where class_id = '00000000-0000-0000-0000-00000000c101'),
  1,
  'exactly one class_reschedule_history row was written'
);
select is(
  (select status from public.reschedule_requests where id = '00000000-0000-0000-0000-00000000a101'),
  'approved',
  'the request is marked approved'
);

-- === TEST 7 — a delivered class cannot be rescheduled =======================
select throws_ok(
  $$ select public.reschedule_class('00000000-0000-0000-0000-00000000c103',
        date_trunc('day', now()) + interval '2 days 16 hours') $$,
  null, null,
  'a delivered class cannot be rescheduled (only published is movable)'
);
reset role;

select * from finish();
rollback;
