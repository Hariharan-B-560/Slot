-- =============================================================================
-- 0008 — 30-minute session / slot model + RULE 7 (no double-book)
-- Extends the recurring-series design: an enrolment is now weekdays[] + a
-- slot_start, and a session runs slot_start + app_config.session_minutes.
-- Rule 7 and the one-active-per-(student,teacher,weekday) rule are enforced as
-- Postgres EXCLUSION constraints (array-overlap on weekdays), so they stay in
-- the database like every other rule.
-- =============================================================================

-- Needed for the exclusion constraints: btree_gist gives '=' gist opclasses for
-- uuid/time; intarray gives the int[] '&&' (overlap) gist opclass.
create extension if not exists btree_gist with schema extensions;
create extension if not exists intarray  with schema extensions;

-- --- app_config (singleton) --------------------------------------------------
create table if not exists public.app_config (
  id              boolean primary key default true,
  session_minutes integer not null default 30,
  constraint app_config_singleton check (id)
);

-- --- enrolments: weekdays[] + slot_start, drop generic schedule --------------
alter table public.enrolments add column if not exists weekdays  integer[];
alter table public.enrolments add column if not exists slot_start time;

-- Backfill from the old JSON schedule so existing rows migrate cleanly.
update public.enrolments
   set weekdays   = array[(schedule::jsonb->>'weekday')::int],
       slot_start = (schedule::jsonb->>'start_time')::time
 where schedule is not null
   and schedule ~ '^\s*\{'
   and weekdays is null;

alter table public.enrolments alter column weekdays  set not null;
alter table public.enrolments alter column slot_start set not null;
alter table public.enrolments drop column if exists schedule;

-- weekdays must be non-empty and every element a valid 0..6.
alter table public.enrolments
  add constraint enrolments_weekdays_valid
  check (array_length(weekdays, 1) >= 1 and weekdays <@ array[0,1,2,3,4,5,6]);

-- --- RULE 7: no double-book --------------------------------------------------
-- No two ACTIVE enrolments may share the same (teacher, slot_start) on any
-- overlapping weekday.
-- NOTE: intarray's opclass AND its int[] '&&' operator are schema-qualified.
-- Locally `extensions` sits in the search_path so bare names resolve, but
-- Supabase Cloud runs migrations without it — leaving `gist__int_ops` unfound
-- and `&&` binding to the built-in anyarray operator instead. Qualifying both
-- is what makes this migration portable.
alter table public.enrolments
  add constraint enrolments_no_double_book
  exclude using gist (
    teacher_id with =,
    slot_start with =,
    weekdays extensions.gist__int_ops with operator(extensions.&&)
  ) where (status = 'active');

-- --- One active enrolment per (student, teacher, weekday) ---------------------
alter table public.enrolments
  add constraint enrolments_one_per_day
  exclude using gist (
    student_id with =,
    teacher_id with =,
    weekdays extensions.gist__int_ops with operator(extensions.&&)
  ) where (status = 'active');

-- --- Rewrite generation to the weekdays[] + session_minutes model ------------
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
  select coalesce(session_minutes, 30) into sess from public.app_config where id;
  sess := coalesce(sess, 30);

  with occ as (
    select e.id as enrolment_id, e.teacher_id, e.student_id, e.slot_start, d::date as occ_date
    from public.enrolments e
    cross join generate_series(current_date, current_date + horizon_days, interval '1 day') d
    where e.status = 'active'
      and extract(dow from d)::int = any (e.weekdays)
      and d::date >= e.start_date
      and (e.end_date is null or d::date <= e.end_date)
  ),
  planned as (
    select enrolment_id, teacher_id, student_id,
           ((occ_date + slot_start) at time zone 'Asia/Kolkata') as sstart
    from occ
  ),
  ins as (
    insert into public.classes
      (slot_type, teacher_id, student_id, enrolment_id, scheduled_start, scheduled_end)
    select 'ENROLLED', teacher_id, student_id, enrolment_id,
           sstart, sstart + make_interval(mins => sess)
    from planned
    where sstart > now()
    on conflict (enrolment_id, scheduled_start) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

-- --- session_slots: every candidate session, free or taken -------------------
-- Slices active availability_blocks into session_minutes slots over [from,to]
-- and marks each free (no active enrolment occupies that weekday+slot_start).
-- SECURITY INVOKER: RLS applies, so a teacher only ever sees their own data.
create or replace function public.session_slots(p_teacher uuid, p_from date, p_to date)
returns table (
  slot_date  date,
  slot_start time,
  slot_end   time,
  starts_at  timestamptz,
  is_free    boolean
)
language sql
stable
as $$
  with cfg as (select coalesce(max(session_minutes), 30) as sess from public.app_config),
  days as (select d::date as dt from generate_series(p_from, p_to, interval '1 day') d),
  cand as (
    select days.dt as slot_date,
           gs::time as s_start,
           (gs + make_interval(mins => (select sess from cfg)))::time as s_end,
           ((days.dt + gs::time) at time zone 'Asia/Kolkata') as starts_at
    from days
    join public.availability_blocks ab
      on ab.teacher_id = p_teacher
     and ab.active
     and ab.weekday = extract(dow from days.dt)::int
    cross join lateral generate_series(
      (days.dt + ab.start_time)::timestamp,
      (days.dt + ab.end_time)::timestamp - make_interval(mins => (select sess from cfg)),
      make_interval(mins => (select sess from cfg))
    ) gs
  )
  select c.slot_date, c.s_start, c.s_end, c.starts_at,
         not exists (
           select 1 from public.enrolments e
           where e.teacher_id = p_teacher
             and e.status = 'active'
             and extract(dow from c.slot_date)::int = any (e.weekdays)
             and e.slot_start = c.s_start
             and c.slot_date >= e.start_date
             and (e.end_date is null or c.slot_date <= e.end_date)
         ) as is_free
  from cand c
  order by c.slot_date, c.s_start;
$$;

-- --- available_slots: only the FREE sessions (anti-joined) -------------------
create or replace function public.available_slots(teacher_id uuid, date_from date, date_to date)
returns table (slot_date date, slot_start time, slot_end time, starts_at timestamptz)
language sql
stable
as $$
  select slot_date, slot_start, slot_end, starts_at
  from public.session_slots(teacher_id, date_from, date_to)
  where is_free;
$$;
