-- =============================================================================
-- closed_days.sql — Sundays hard-closed, Saturdays openable per-date.
--   * the generator never emits a class on a closed day (Sat w/o override, Sun)
--   * an open-override lets a Saturday through
--   * even a forced Sunday open-override cannot produce a Sunday class
--   * open_days_count (the utilisation denominator) excludes Sun + Sat-w/o-override
-- Deterministic dates: date_trunc('week', current_date) is Monday 00:00.
--   next Mon = +7, next Sat = +12, next Sun = +13, Sat two weeks out = +19.
-- =============================================================================

begin;
select plan(7);

-- Fixtures: an active enrolment for Teacher Two, capacious cap so the cap never
-- binds within the horizon.
insert into public.students (id, name, status) values
  ('00000000-0000-0000-0000-0000000cd001', 'Closed Student', 'lead');
insert into public.conversion_events (id, student_id, type, recorded_by) values
  ('00000000-0000-0000-0000-0000000ce001', '00000000-0000-0000-0000-0000000cd001', 'admin_signoff', '00000000-0000-0000-0000-000000000a01');
insert into public.enrolments
  (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions)
values
  ('00000000-0000-0000-0000-0000000cf001', '00000000-0000-0000-0000-0000000cd001', '00000000-0000-0000-0000-000000000b02',
   '00000000-0000-0000-0000-0000000ce001', '11:00', 30, current_date, 60);

-- Handy date anchors.
create or replace function pg_temp.mon() returns date language sql as
  $$ select (date_trunc('week', current_date)::date + 7) $$;   -- next Monday

-- === TEST 1 — a Sunday open-override is rejected by the CHECK ================
select throws_ok(
  format($$ insert into public.availability_overrides (teacher_id, date, kind, created_by)
            values ('00000000-0000-0000-0000-000000000b02', '%s', 'open', '00000000-0000-0000-0000-000000000a01') $$,
         pg_temp.mon() + 6),                                    -- next Sunday
  '23514', null,
  'an open-override on a Sunday is rejected (Sundays are never openable)'
);

-- === TEST 2 — open_days_count: a default week has 5 open days (Mon–Fri) ======
select is(
  public.open_days_count('00000000-0000-0000-0000-000000000b02', pg_temp.mon(), pg_temp.mon() + 6),
  5,
  'open_days_count: a default week excludes Sat + Sun → 5 open days'
);

-- === TEST 3 — opening a Saturday makes that week 6 open days =================
insert into public.availability_overrides (teacher_id, date, kind, start_time, end_time, created_by)
values ('00000000-0000-0000-0000-000000000b02', pg_temp.mon() + 5, 'open', '10:00', '12:00',
        '00000000-0000-0000-0000-000000000a01');               -- next Saturday
select is(
  public.open_days_count('00000000-0000-0000-0000-000000000b02', pg_temp.mon(), pg_temp.mon() + 6),
  6,
  'open_days_count: an open Saturday raises the week to 6 open days'
);

-- === Generate, then inspect which dates got classes =========================
select public.generate_classes(40);

-- === TEST 4 — NO class on a Saturday WITHOUT an override (two weeks out) =====
select is(
  (select count(*)::int from public.classes
    where enrolment_id = '00000000-0000-0000-0000-0000000cf001'
      and (scheduled_start at time zone 'Asia/Kolkata')::date = pg_temp.mon() + 12),  -- Sat +2wk, no override
  0,
  'generator makes NO class on a Saturday without an override'
);

-- === TEST 5 — DOES make a class on the opened Saturday ======================
select is(
  (select count(*)::int from public.classes
    where enrolment_id = '00000000-0000-0000-0000-0000000cf001'
      and (scheduled_start at time zone 'Asia/Kolkata')::date = pg_temp.mon() + 5),   -- next Sat, opened
  1,
  'generator makes a class on a Saturday WITH a matching open-override'
);

-- === TEST 6 — a normal weekday DID generate (positive control) ==============
select is(
  (select count(*)::int from public.classes
    where enrolment_id = '00000000-0000-0000-0000-0000000cf001'
      and (scheduled_start at time zone 'Asia/Kolkata')::date = pg_temp.mon() + 1),    -- next Tuesday
  1,
  'generator DOES make a class on a normal open weekday'
);

-- === TEST 7 — NO Sunday class even with a (forced) Sunday open-override ======
-- The CHECK blocks Sunday open-overrides, so force one in past it to prove the
-- generator's OWN hard Sunday rule (belt-and-suspenders). Rolls back with the txn.
alter table public.availability_overrides drop constraint overrides_no_open_sunday;
insert into public.availability_overrides (teacher_id, date, kind, created_by)
values ('00000000-0000-0000-0000-000000000b02', pg_temp.mon() + 6, 'open',
        '00000000-0000-0000-0000-000000000a01');                -- next Sunday, forced
select public.generate_classes(40);
select is(
  (select count(*)::int from public.classes
    where enrolment_id = '00000000-0000-0000-0000-0000000cf001'
      and (scheduled_start at time zone 'Asia/Kolkata')::date = pg_temp.mon() + 6),
  0,
  'generator makes NO class on a Sunday even with an open-override (hard rule)'
);

select * from finish();
rollback;
