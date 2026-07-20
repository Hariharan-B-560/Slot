-- =============================================================================
-- 0006 — Phase 2: instance generation
-- A daily pg_cron job expands active enrolments into 'published' class rows for
-- the coming window, and a sweep job advances the state machine
-- (published -> missed, delivered -> flagged). All generated rows still pass the
-- Phase 1 triggers/RLS — nothing here bypasses the anti-fraud layer.
--
-- NOTE: the enrolment `schedule` is a simple weekly JSON spec
-- ({"weekday":1,"start_time":"18:00","duration_min":60}), so expansion is done
-- in SQL here rather than with the rrule JS lib. Move to an Edge Function with
-- rrule if complex recurrence (multiple days / exceptions) is ever needed.
-- =============================================================================

-- Prevent duplicate instances for the same enrolment + start. NULLs are
-- distinct, so DEMO rows (enrolment_id IS NULL) are unaffected.
create unique index if not exists classes_enrolment_start_uk
  on public.classes (enrolment_id, scheduled_start);

-- --- Generate upcoming class instances ---------------------------------------
-- Idempotent: re-running only inserts occurrences that don't already exist.
-- Only future occurrences are created, so RULE 2 (published_at < scheduled_start)
-- always holds. Window math is done in Asia/Kolkata.
create or replace function public.generate_classes(horizon_days int default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  with occ as (
    select
      e.id                                   as enrolment_id,
      e.teacher_id,
      e.student_id,
      (e.schedule::jsonb->>'weekday')::int    as wd,
      (e.schedule::jsonb->>'start_time')::time as st,
      (e.schedule::jsonb->>'duration_min')::int as dur,
      d::date                                 as occ_date
    from public.enrolments e
    cross join generate_series(current_date, current_date + horizon_days, interval '1 day') d
    where e.status = 'active'
      and e.schedule ~ '^\s*\{'                         -- looks like JSON
      and d::date >= e.start_date
      and (e.end_date is null or d::date <= e.end_date)
  ),
  planned as (
    select
      enrolment_id, teacher_id, student_id, dur,
      ((occ_date + st) at time zone 'Asia/Kolkata') as sstart
    from occ
    where extract(dow from occ_date)::int = wd            -- 0=Sun .. 6=Sat
  ),
  ins as (
    insert into public.classes
      (slot_type, teacher_id, student_id, enrolment_id, scheduled_start, scheduled_end)
    select
      'ENROLLED', teacher_id, student_id, enrolment_id,
      sstart, sstart + make_interval(mins => dur)
    from planned
    where sstart > now()                                  -- future only (RULE 2)
    on conflict (enrolment_id, scheduled_start) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

-- --- Advance the state machine (missed / flagged) ----------------------------
create or replace function public.sweep_class_states(flag_after_days int default 3)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- published, window fully passed (incl. grace), never delivered -> missed
  update public.classes
     set status = 'missed'
   where status = 'published'
     and scheduled_end + public.delivery_grace() < now();

  -- delivered but unverified beyond the threshold -> flagged for admin review
  update public.classes
     set status = 'flagged',
         flag_reason = 'unverified for more than ' || flag_after_days || ' days'
   where status = 'delivered'
     and delivered_at < now() - make_interval(days => flag_after_days);
end;
$$;

-- --- Schedule via pg_cron -----------------------------------------------------
create extension if not exists pg_cron;

-- Generate instances daily at 01:00; sweep states every 30 minutes.
select cron.schedule('generate-classes',    '0 1 * * *',   $$ select public.generate_classes(); $$);
select cron.schedule('sweep-class-states',  '*/30 * * * *', $$ select public.sweep_class_states(); $$);
