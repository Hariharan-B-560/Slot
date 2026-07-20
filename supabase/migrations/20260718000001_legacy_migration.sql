-- =============================================================================
-- Legacy-student migration path.
--
-- Existing students are mid-package on the old Google Form system. We carry the
-- state they already have (already-delivered count + true historical start)
-- WITHOUT backfilling past classes — rule 1 (no backfill) has no migration
-- exception, and rule 2 (publish_before_happen) already rejects any class whose
-- scheduled_start is in the past, so the historical period can never enter the
-- ledger. See decision-v1.md ("Legacy migration").
--
-- This migration is schema + two function redefinitions only. No trigger/RLS
-- change: the admin migration screen goes through the same DB path as a normal
-- placement, so rule 4, rule 7 overlap, and the dual-cap all still fire.
-- =============================================================================

-- --- enrolments: three admin-set, migration-only columns ---------------------
alter table public.enrolments
  add column sessions_already_delivered int  not null default 0,
  add column historical_start_date      date,
  add column migrated_from_legacy       boolean not null default false;

comment on column public.enrolments.sessions_already_delivered is
  'Sessions completed on the legacy (Google Form) system before app cutover. '
  'Counts against total_sessions so "remaining" reads correctly from day one. '
  'NOT backfilled as classes.';
comment on column public.enrolments.historical_start_date is
  'When the student actually began, pre-app. start_date still marks where the '
  'app takes over generation.';
comment on column public.enrolments.migrated_from_legacy is
  'True only for enrolments created via the one-time migration path.';

-- Can't have delivered a negative number, nor more than the whole package.
alter table public.enrolments
  add constraint enrolments_already_delivered_nonneg
  check (sessions_already_delivered >= 0);
alter table public.enrolments
  add constraint enrolments_already_delivered_le_total
  check (sessions_already_delivered <= coalesce(total_sessions, sessions_already_delivered));
-- The pre-app start can't be after the app takes over.
alter table public.enrolments
  add constraint enrolments_historical_before_start
  check (historical_start_date is null or historical_start_date <= start_date);

-- --- generation cap: historical count binds REAL generation, not just display
-- Only the `planned` filter changes: an enrolment gets total_sessions minus the
-- sessions already delivered on the legacy system. Everything else is verbatim
-- from 20260715000003_generation_durations.sql.
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
    select e.id as enrolment_id, e.teacher_id, e.student_id, e.slot_start,
           e.duration_minutes, e.total_sessions, e.sessions_already_delivered,
           d::date as occ_date,
           (d::date - e.start_date) + 1 as seq
    from public.enrolments e
    cross join generate_series(
      e.start_date,
      least(coalesce(e.end_date, current_date + horizon_days), current_date + horizon_days),
      interval '1 day'
    ) d
    where e.status = 'active'
  ),
  planned as (
    select enrolment_id, teacher_id, student_id, duration_minutes,
           ((occ_date + slot_start) at time zone 'Asia/Kolkata') as sstart
    from occ
    -- Combined cap: historical (already delivered) + app-generated may not
    -- exceed total_sessions. seq counts app days from start_date.
    where total_sessions is null
       or seq <= total_sessions - coalesce(sessions_already_delivered, 0)
  ),
  ins as (
    insert into public.classes
      (slot_type, teacher_id, student_id, enrolment_id, scheduled_start, scheduled_end, duration_minutes)
    select 'ENROLLED', teacher_id, student_id, enrolment_id,
           sstart, sstart + make_interval(mins => duration_minutes), duration_minutes
    from planned
    where sstart > now()
    on conflict (enrolment_id, scheduled_start) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

-- --- dashboard: optional exclusion of carried-over (legacy) students ---------
-- New third arg (defaults true, so the existing 2-arg RPC call is unchanged).
-- When false, classes belonging to a migrated enrolment are dropped so early-
-- weeks utilisation isn't distorted by students who haven't yet accumulated
-- app-side delivered classes. DEMO classes (null enrolment_id) are never legacy.
drop function if exists public.dashboard_utilisation(date, date);

create or replace function public.dashboard_utilisation(
  p_start date, p_end date, p_include_legacy boolean default true
)
returns table (
  teacher_id        uuid,
  teacher_name      text,
  daily_avail_hours numeric,
  available_hours   numeric,
  verified_hours    numeric,
  utilisation       numeric,
  delivered_cnt     integer,
  verified_cnt      integer,
  flagged_cnt       integer,
  missed_cnt        integer
)
language sql
stable
as $$
  with days as (
    select greatest(1, (p_end - p_start) + 1)::numeric as d
  ),
  avail as (
    select teacher_id,
           coalesce(sum(extract(epoch from (end_time - start_time)) / 3600.0), 0) as daily_hours
    from public.availability_blocks
    where active
    group by teacher_id
  ),
  cls as (
    select k.teacher_id,
           coalesce(sum(extract(epoch from (k.scheduled_end - k.scheduled_start)) / 3600.0)
                    filter (where k.status = 'verified' and k.slot_type = 'ENROLLED'), 0) as verified_hours,
           count(*) filter (where k.status = 'delivered') as delivered_cnt,
           count(*) filter (where k.status = 'verified')  as verified_cnt,
           count(*) filter (where k.status = 'flagged')   as flagged_cnt,
           count(*) filter (where k.status = 'missed')    as missed_cnt
    from public.classes k
    left join public.enrolments e on e.id = k.enrolment_id
    where k.scheduled_start >= p_start
      and k.scheduled_start < (p_end + 1)
      and (p_include_legacy or e.migrated_from_legacy is not true)
    group by k.teacher_id
  )
  select
    p.id,
    p.name,
    round(coalesce(a.daily_hours, 0), 2),
    round(coalesce(a.daily_hours, 0) * (select d from days), 2),
    round(coalesce(c.verified_hours, 0), 2),
    case
      when coalesce(a.daily_hours, 0) * (select d from days) > 0
      then round(coalesce(c.verified_hours, 0) / (a.daily_hours * (select d from days)), 3)
      else 0
    end,
    coalesce(c.delivered_cnt, 0),
    coalesce(c.verified_cnt, 0),
    coalesce(c.flagged_cnt, 0),
    coalesce(c.missed_cnt, 0)
  from public.profiles p
  left join avail a on a.teacher_id = p.id
  left join cls   c on c.teacher_id = p.id
  where p.role = 'teacher'
    and p.active
  order by p.name;
$$;
