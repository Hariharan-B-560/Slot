-- =============================================================================
-- batch2_evidence.sql — the evidence rules on session_reports:
--   * absent attendance requires an absent_reason
--   * a report can only be filed inside the class window (no early / backfill)
-- Rule 8 (no delivery without a report) and rule 5 (teacher can't verify) are
-- proven in anti_fraud.sql / phase15_rules.sql and still hold.
-- =============================================================================

begin;
select plan(3);

-- A class in its CURRENT window (Teacher One / Student One).
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-00000000ce01', 'DEMO',
        '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01',
        now() - interval '15 minutes', now() + interval '15 minutes', now() - interval '1 hour');

-- A class 2 hours in the FUTURE (window not open yet).
insert into public.classes (id, slot_type, teacher_id, student_id, scheduled_start, scheduled_end, published_at)
values ('00000000-0000-0000-0000-00000000ce02', 'DEMO',
        '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000c01',
        now() + interval '2 hours', now() + interval '2 hours' + interval '30 minutes', now());

-- TEST 1 — absent with no reason is rejected.
select throws_ok(
  $$ insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
     values ('00000000-0000-0000-0000-00000000ce01', 'absent', 'o.png', 'c.png',
             '00000000-0000-0000-0000-000000000b01') $$,
  '23514', null,
  'a report with attendance=absent and no absent_reason is rejected'
);

-- TEST 2 — a valid in-window report is accepted (positive control).
select lives_ok(
  $$ insert into public.session_reports (class_id, attendance, absent_reason, opening_screenshot, closing_screenshot, created_by)
     values ('00000000-0000-0000-0000-00000000ce01', 'absent', 'network outage', 'o.png', 'c.png',
             '00000000-0000-0000-0000-000000000b01') $$,
  'an in-window report with an absent_reason is accepted'
);

-- TEST 3 — a report filed before the class window is rejected (no early evidence).
select throws_ok(
  $$ insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, created_by)
     values ('00000000-0000-0000-0000-00000000ce02', 'present', 'o.png', 'c.png',
             '00000000-0000-0000-0000-000000000b01') $$,
  '23514', null,
  'RULE 8b: a session report filed outside the class window is rejected'
);

select * from finish();
rollback;
