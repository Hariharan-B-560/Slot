-- =============================================================================
-- 0007 — Phase 4: dashboard metrics
-- One function the admin dashboard calls. Runs as the caller (SECURITY INVOKER),
-- so RLS still applies — the admin can read all classes; a teacher could only
-- ever see their own numbers.
--
--   Utilisation = verified ENROLLED class-hours ÷ published availability-hours,
--   per teacher, over the chosen period. Availability is weekly (each active
--   block recurs once/week), scaled by the number of weeks in the period.
-- =============================================================================

create or replace function public.dashboard_utilisation(p_start date, p_end date)
returns table (
  teacher_id         uuid,
  teacher_name       text,
  weekly_avail_hours numeric,
  available_hours    numeric,
  verified_hours     numeric,
  utilisation        numeric,   -- 0..1 (verified ÷ available)
  delivered_cnt      integer,   -- delivered, awaiting verification
  verified_cnt       integer,
  flagged_cnt        integer,
  missed_cnt         integer
)
language sql
stable
as $$
  with weeks as (
    select greatest(1, (p_end - p_start)::numeric / 7.0) as w
  ),
  avail as (
    select teacher_id,
           coalesce(sum(extract(epoch from (end_time - start_time)) / 3600.0), 0) as weekly_hours
    from public.availability_blocks
    where active
    group by teacher_id
  ),
  cls as (
    select teacher_id,
           coalesce(sum(extract(epoch from (scheduled_end - scheduled_start)) / 3600.0)
                    filter (where status = 'verified' and slot_type = 'ENROLLED'), 0) as verified_hours,
           count(*) filter (where status = 'delivered') as delivered_cnt,
           count(*) filter (where status = 'verified')  as verified_cnt,
           count(*) filter (where status = 'flagged')   as flagged_cnt,
           count(*) filter (where status = 'missed')    as missed_cnt
    from public.classes
    where scheduled_start >= p_start
      and scheduled_start < (p_end + 1)
    group by teacher_id
  )
  select
    p.id,
    p.name,
    round(coalesce(a.weekly_hours, 0), 2),
    round(coalesce(a.weekly_hours, 0) * (select w from weeks), 2),
    round(coalesce(c.verified_hours, 0), 2),
    case
      when coalesce(a.weekly_hours, 0) * (select w from weeks) > 0
      then round(coalesce(c.verified_hours, 0) / (a.weekly_hours * (select w from weeks)), 3)
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
  order by p.name;
$$;
