-- =============================================================================
-- Teacher management
-- Admin can add / edit / retire teachers. A teacher can never be hard-deleted:
-- their classes (append-only ledger), enrolments and availability reference
-- them. Retirement is a soft-disable via profiles.active.
-- `email` is mirrored onto profiles so the app can list users without reaching
-- into auth.users (the dev "act as" switcher reads it under normal RLS).
-- =============================================================================

alter table public.profiles add column active boolean not null default true;
alter table public.profiles add column email  text;

create unique index profiles_email_uk on public.profiles (email) where email is not null;

-- Utilisation should only report on teachers who are still active.
create or replace function public.dashboard_utilisation(p_start date, p_end date)
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
