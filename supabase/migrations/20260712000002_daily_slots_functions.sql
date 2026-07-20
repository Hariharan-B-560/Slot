-- =============================================================================
-- DAILY SLOTS — 2/2 FUNCTIONS
--   * available_slots(teacher)  — the #1 view: every published 30-min TIME with
--     free/taken + the occupying student. No date range: it's a daily pattern.
--   * generate_classes()        — one class per DAY from start_date at slot_start,
--     until the first cap binds (total_sessions or end_date).
--   * dashboard_utilisation()   — availability is now DAILY, so available hours
--     are daily_hours x days_in_period.
-- =============================================================================

-- The dated slot functions are gone with the weekday model.
drop function if exists public.session_slots(uuid, date, date);
drop function if exists public.available_slots(uuid, date, date);

-- --- available_slots: the teacher's daily slot list --------------------------
-- SECURITY INVOKER: RLS applies (a teacher sees only their own blocks/enrolments).
create or replace function public.available_slots(p_teacher uuid)
returns table (
  slot_start   time,
  slot_end     time,
  is_free      boolean,
  student_id   uuid,
  student_name text,
  enrolment_id uuid
)
language sql
stable
as $$
  with cfg as (select coalesce(max(session_minutes), 30) as sess from public.app_config),
  times as (
    -- Slice every active block into session-length times; DISTINCT so overlapping
    -- blocks can't produce duplicate rows.
    select distinct gs::time as t
    from public.availability_blocks ab
    cross join lateral generate_series(
      (current_date + ab.start_time)::timestamp,
      (current_date + ab.end_time)::timestamp - make_interval(mins => (select sess from cfg)),
      make_interval(mins => (select sess from cfg))
    ) gs
    where ab.teacher_id = p_teacher
      and ab.active
  )
  select
    t.t                                                        as slot_start,
    (t.t + make_interval(mins => (select sess from cfg)))::time as slot_end,
    (e.id is null)                                             as is_free,
    e.student_id,
    s.name                                                     as student_name,
    e.id                                                       as enrolment_id
  from times t
  left join public.enrolments e
    on e.teacher_id = p_teacher
   and e.status = 'active'
   and e.slot_start = t.t
  left join public.students s on s.id = e.student_id
  order by t.t;
$$;

-- --- generation: one class per DAY, until the first cap binds ----------------
create or replace function public.generate_classes(horizon_days int default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
  sess     int;
begin
  select coalesce(max(session_minutes), 30) into sess from public.app_config;
  sess := coalesce(sess, 30);

  with occ as (
    -- Daily: seq is simply the day number since start_date, so total_sessions is
    -- a lifetime count cap. end_date bounds the series; the horizon bounds it too.
    select e.id as enrolment_id, e.teacher_id, e.student_id, e.slot_start,
           e.total_sessions,
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
    select enrolment_id, teacher_id, student_id,
           ((occ_date + slot_start) at time zone 'Asia/Kolkata') as sstart
    from occ
    where total_sessions is null or seq <= total_sessions
  ),
  ins as (
    insert into public.classes
      (slot_type, teacher_id, student_id, enrolment_id, scheduled_start, scheduled_end)
    select 'ENROLLED', teacher_id, student_id, enrolment_id,
           sstart, sstart + make_interval(mins => sess)
    from planned
    where sstart > now()                                   -- future only (RULE 2)
    on conflict (enrolment_id, scheduled_start) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

-- --- dashboard: availability is DAILY now -----------------------------------
drop function if exists public.dashboard_utilisation(date, date);

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
  order by p.name;
$$;
