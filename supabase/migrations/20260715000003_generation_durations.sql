-- =============================================================================
-- Mixed durations — 3/3: generation + duration-aware available_slots
--  * generate_classes stamps the enrolment's duration onto each class and sets
--    scheduled_end = scheduled_start + duration_minutes.
--  * available_slots(teacher, duration) answers "where can a session of this
--    duration START?" — a start atom is valid only if `duration` worth of
--    consecutive atoms are free AND inside one published block. It also reports
--    occupancy so the strip can render a 60 as one two-atom span.
-- =============================================================================

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
           e.duration_minutes, e.total_sessions,
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
    where total_sessions is null or seq <= total_sessions
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

-- --- available_slots(teacher, duration) -------------------------------------
drop function if exists public.available_slots(uuid);

create or replace function public.available_slots(p_teacher uuid, p_duration int default 30)
returns table (
  slot_start        time,
  slot_end          time,          -- this atom's end (start + one atom)
  is_free           boolean,       -- is THIS atom free?
  fits              boolean,       -- can a p_duration session START at this atom?
  is_occupant_start boolean,       -- is this atom the start of the covering enrolment?
  occupant_duration int,           -- covering enrolment's duration (for span rendering)
  student_id        uuid,
  student_name      text,
  enrolment_id      uuid
)
language sql
stable
as $$
  with cfg as (select coalesce(max(slot_minutes), 30) as slot from public.app_config),
  raw as (
    select ab.start_time as blk_start, ab.end_time as blk_end, gs::time as t
    from public.availability_blocks ab
    cross join lateral generate_series(
      (current_date + ab.start_time)::timestamp,
      (current_date + ab.end_time)::timestamp - make_interval(mins => (select slot from cfg)),
      make_interval(mins => (select slot from cfg))
    ) gs
    where ab.teacher_id = p_teacher and ab.active
  ),
  atoms as (
    -- One row per atom; keep the widest containing block end (overlapping blocks).
    select t, max(blk_end) as blk_end from raw group by t
  )
  select
    a.t as slot_start,
    (a.t + make_interval(mins => (select slot from cfg)))::time as slot_end,
    (e.id is null) as is_free,
    -- fits: the whole p_duration span sits inside this block and overlaps no
    -- active enrolment.
    (
      public.time_minutes(a.t) + p_duration <= public.time_minutes(a.blk_end)
      and not exists (
        select 1 from public.enrolments x
        where x.teacher_id = p_teacher and x.status = 'active'
          and public.enrolment_range(x.slot_start, x.duration_minutes)
              && public.enrolment_range(a.t, p_duration)
      )
    ) as fits,
    (e.id is not null and e.slot_start = a.t) as is_occupant_start,
    e.duration_minutes as occupant_duration,
    e.student_id,
    s.name as student_name,
    e.id as enrolment_id
  from atoms a
  left join lateral (
    select en.* from public.enrolments en
    where en.teacher_id = p_teacher and en.status = 'active'
      and public.enrolment_range(en.slot_start, en.duration_minutes)
          && public.enrolment_range(a.t, (select slot from cfg))
    limit 1
  ) e on true
  left join public.students s on s.id = e.student_id
  order by a.t;
$$;
