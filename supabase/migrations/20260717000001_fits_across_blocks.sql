-- =============================================================================
-- Fix: available_slots(duration) rejected valid start points.
--
-- The old `fits` checked the span end against the SINGLE availability block
-- containing the atom (a.blk_end). The app publishes runs as many TOUCHING
-- per-slot blocks (publish / split-on-unpublish), so for those atoms the test
-- degenerated to t+60 <= t+30 — always false. Long free runs offered no 60-min
-- starts while 30-min mode showed every atom free.
--
-- New definition (the one the strip's 30-min view already embodies):
--   atom A is a valid start for duration D iff EVERY atom in [A, A+D) exists
--   in the published-atom set and is free of active enrolments.
-- Derived from the SAME dedup'd free-atom set the 30-min view uses, so two
-- touching blocks 16–18 and 18–20 allow a 60 spanning 17:30–18:30. Half-open
-- everywhere: enrolment overlap via int4range [) (enrolment_range), span
-- membership via minute ints >= start and < start+D — a session ending 18:00
-- never blocks an 18:00 start. All span math in integer minutes
-- (public.time_minutes); no time+interval comparisons, no tz conversion.
-- =============================================================================

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
    select gs::time as t
    from public.availability_blocks ab
    cross join lateral generate_series(
      (current_date + ab.start_time)::timestamp,
      (current_date + ab.end_time)::timestamp - make_interval(mins => (select slot from cfg)),
      make_interval(mins => (select slot from cfg))
    ) gs
    where ab.teacher_id = p_teacher and ab.active
  ),
  -- One row per atom, whichever block(s) produced it (touching or overlapping
  -- blocks collapse here — block boundaries carry no meaning past this point).
  atoms as (select distinct t from raw),
  -- Per-atom freeness: the SAME truth the 30-min view renders.
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
    -- fits: every atom of [t, t+duration) is published AND free. Atoms are
    -- `slot` minutes apart, so the span holds duration/slot of them; atoms
    -- outside any published window simply don't exist and shrink the count.
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
