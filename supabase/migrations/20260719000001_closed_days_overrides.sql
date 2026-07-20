-- =============================================================================
-- Closed days + Saturday overrides.
--
-- Sundays are permanently closed; Saturdays are closed by default but an admin
-- can open a specific date for a specific teacher (make-ups / on-demand demos).
-- The generator never emits a class on a closed day unless an open-override
-- exists, and NEVER on a Sunday (hard rule, defended in the generator AND a
-- table CHECK). Utilisation denominators count only open days.
--
-- Weekday convention (this repo): extract(dow) = 0=Sun … 6=Sat.
-- =============================================================================

-- --- app_config: which weekdays are closed by default ------------------------
alter table public.app_config
  add column closed_weekdays smallint[] not null default '{0,6}';  -- Sun, Sat

comment on column public.app_config.closed_weekdays is
  'Weekdays (0=Sun..6=Sat) the institute is closed by default. Sunday is also '
  'hard-closed in the generator/override CHECK; Saturday is openable per-date.';

-- --- availability_overrides: one-off unlocks / closures for a specific date ---
create table public.availability_overrides (
  id         uuid primary key default extensions.gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id),
  date       date not null,
  kind       text not null check (kind in ('open', 'close')),
  start_time time,                    -- null = full day
  end_time   time,
  created_by uuid not null references public.profiles (id),
  reason     text,
  created_at timestamptz not null default now(),
  -- Sundays are NEVER openable — not even by an explicit override.
  constraint overrides_no_open_sunday
    check (not (kind = 'open' and extract(dow from date) = 0)),
  -- A partial window needs both ends; a full-day override leaves both null.
  constraint overrides_window_paired
    check ((start_time is null) = (end_time is null)),
  constraint overrides_window_order
    check (start_time is null or start_time < end_time)
);
create index availability_overrides_teacher_date on public.availability_overrides (teacher_id, date);

alter table public.availability_overrides enable row level security;
grant select, insert, update, delete on public.availability_overrides to authenticated;

-- Only admins write overrides; teachers may read their own.
create policy overrides_admin_write on public.availability_overrides
  for all to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());
create policy overrides_teacher_read on public.availability_overrides
  for select to authenticated
  using (teacher_id = auth.uid() and public.can_act());

-- --- open-day predicate (the single source of truth) -------------------------
-- A date is "open" for a teacher iff it is not Sunday AND either (a) it is a
-- normally-open weekday with no full-day close-override, or (b) an open-override
-- exists for that (teacher, date).
create or replace function public.is_open_day(p_teacher uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when extract(dow from p_date)::int = 0 then false                         -- Sunday: hard closed
    when exists (select 1 from public.availability_overrides o
                 where o.teacher_id = p_teacher and o.date = p_date and o.kind = 'open')
      then true                                                               -- explicitly opened
    when extract(dow from p_date)::int = any(c.closed) then false             -- closed weekday
    when exists (select 1 from public.availability_overrides o
                 where o.teacher_id = p_teacher and o.date = p_date
                   and o.kind = 'close' and o.start_time is null)
      then false                                                              -- full-day closed
    else true
  end
  from (select coalesce(max(closed_weekdays), '{0,6}'::smallint[]) as closed from public.app_config) c;
$$;

create or replace function public.open_days_count(p_teacher uuid, p_start date, p_end date)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') d
  where public.is_open_day(p_teacher, d::date);
$$;

-- --- generator: skip closed days (open-override lets a Saturday through) ------
-- Verbatim from 20260718000001 except the added is_open_day filter in `occ`.
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
           d::date as occ_date
    from public.enrolments e
    cross join generate_series(
      e.start_date,
      least(coalesce(e.end_date, current_date + horizon_days), current_date + horizon_days),
      interval '1 day'
    ) d
    where e.status = 'active'
      and public.is_open_day(e.teacher_id, d::date)   -- no Sunday ever; Saturday only if opened
  ),
  -- The Nth SESSION is the Nth OPEN day — closed days don't consume the cap.
  seqd as (
    select occ.*, row_number() over (partition by enrolment_id order by occ_date) as seq
    from occ
  ),
  planned as (
    select enrolment_id, teacher_id, student_id, duration_minutes,
           ((occ_date + slot_start) at time zone 'Asia/Kolkata') as sstart
    from seqd
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

-- --- utilisation: denominator counts OPEN days only --------------------------
-- Same 3-arg signature/columns; available_hours = daily_hours × open days
-- (excludes Sundays and Saturdays without an override).
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
  with avail as (
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
    round(coalesce(a.daily_hours, 0) * public.open_days_count(p.id, p_start, p_end), 2),
    round(coalesce(c.verified_hours, 0), 2),
    case
      when coalesce(a.daily_hours, 0) * public.open_days_count(p.id, p_start, p_end) > 0
      then round(coalesce(c.verified_hours, 0)
                 / (a.daily_hours * public.open_days_count(p.id, p_start, p_end)), 3)
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

-- --- available_slots: optional date folds in overrides + closed-day rules -----
-- p_date null → identical to the day-agnostic placement view (regression-safe).
-- p_date given → the day's slots come from availability_blocks UNLESS a close-
-- override subtracts, or the date is a closed weekday (empty unless an open-
-- override supplies its own window). Sunday is always empty.
-- Drop the old 2-arg form so the new 3-arg (date-defaulted) one owns every call.
drop function if exists public.available_slots(uuid, int);

create or replace function public.available_slots(
  p_teacher uuid, p_duration int default 30, p_date date default null
)
returns table (
  slot_start        time,
  slot_end          time,
  is_free           boolean,
  fits              boolean,
  is_occupant_start boolean,
  occupant_duration int,
  student_id        uuid,
  student_name      text,
  enrolment_id      uuid
)
language sql
stable
as $$
  with cfg as (
    select coalesce(max(slot_minutes), 30) as slot,
           coalesce(max(closed_weekdays), '{0,6}'::smallint[]) as closed
    from public.app_config
  ),
  oo as (  -- an open-override for this exact date, if any
    select * from public.availability_overrides o
    where p_date is not null and o.teacher_id = p_teacher and o.date = p_date and o.kind = 'open'
    limit 1
  ),
  day_open as (
    select case
      when p_date is null then true                                          -- placement view
      when extract(dow from p_date)::int = 0 then false                      -- Sunday
      when exists (select 1 from oo) then true                               -- opened by override
      when extract(dow from p_date)::int = any(cfg.closed) then false
      when exists (select 1 from public.availability_overrides o
                   where o.teacher_id = p_teacher and o.date = p_date
                     and o.kind = 'close' and o.start_time is null) then false
      else true
    end as ok
    from cfg
  ),
  src as (  -- the time windows the day's availability is sliced from
    -- a timed open-override REPLACES the teacher's blocks for that date
    select o.start_time as s, o.end_time as e
    from oo o where o.start_time is not null and (select ok from day_open)
    union all
    -- otherwise the teacher's normal blocks (open weekday, or override w/ null times)
    select ab.start_time, ab.end_time
    from public.availability_blocks ab
    where ab.teacher_id = p_teacher and ab.active and (select ok from day_open)
      and not exists (select 1 from oo o where o.start_time is not null)
  ),
  raw as (
    select gs::time as t
    from src
    cross join lateral generate_series(
      (current_date + s)::timestamp,
      (current_date + e)::timestamp - make_interval(mins => (select slot from cfg)),
      make_interval(mins => (select slot from cfg))
    ) gs
  ),
  atoms0 as (select distinct t from raw),
  -- a timed close-override on an open day subtracts its atoms
  atoms as (
    select t from atoms0 a
    where not exists (
      select 1 from public.availability_overrides o
      where p_date is not null and o.teacher_id = p_teacher and o.date = p_date
        and o.kind = 'close' and o.start_time is not null
        and a.t >= o.start_time and a.t < o.end_time
    )
  ),
  freeset as (
    select a.t,
           not exists (
             select 1 from public.enrolments x
             where x.teacher_id = p_teacher and x.status = 'active'
               and public.enrolment_range(x.slot_start, x.duration_minutes)
                   && public.enrolment_range(a.t, (select slot from cfg))
           ) as free
    from atoms a
  )
  select
    f.t as slot_start,
    (f.t + make_interval(mins => (select slot from cfg)))::time as slot_end,
    f.free as is_free,
    (
      (select count(*) from freeset b
        where b.free
          and public.time_minutes(b.t) >= public.time_minutes(f.t)
          and public.time_minutes(b.t) <  public.time_minutes(f.t) + p_duration)
      = p_duration / (select slot from cfg)
    ) as fits,
    (e.id is not null and e.slot_start = f.t) as is_occupant_start,
    e.duration_minutes as occupant_duration,
    e.student_id,
    s.name as student_name,
    e.id as enrolment_id
  from freeset f
  left join lateral (
    select en.* from public.enrolments en
    where en.teacher_id = p_teacher and en.status = 'active'
      and public.enrolment_range(en.slot_start, en.duration_minutes)
          && public.enrolment_range(f.t, (select slot from cfg))
    limit 1
  ) e on true
  left join public.students s on s.id = e.student_id
  order by f.t;
$$;
