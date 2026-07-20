-- =============================================================================
-- Mixed durations — 2/3: duration columns + the overlap rule (RULE 7 replaced)
-- A session is 30 or 60 min. 60 = two consecutive atoms held by one enrolment.
-- The old point unique index on (teacher, slot_start) can't see the second atom
-- of a 60, so it is replaced by a range EXCLUDE: for a teacher, no two active
-- enrolments' [slot_start, slot_start + duration) ranges may overlap.
-- =============================================================================

-- Minutes-of-day + the enrolment's time range, as IMMUTABLE functions so they
-- can be used in the exclusion index expression.
create or replace function public.time_minutes(t time)
returns int language sql immutable
as $$ select (extract(hour from t) * 60 + extract(minute from t))::int $$;

create or replace function public.enrolment_range(p_start time, p_dur int)
returns int4range language sql immutable
as $$ select int4range(public.time_minutes(p_start), public.time_minutes(p_start) + p_dur) $$;

-- --- enrolments.duration_minutes --------------------------------------------
alter table public.enrolments add column duration_minutes int not null default 30;
alter table public.enrolments
  add constraint enrolments_duration_allowed check (duration_minutes in (30, 60));

-- "Multiple of slot_minutes" can't be a bare CHECK (needs app_config); trigger it.
create or replace function public.enrolment_duration_multiple()
returns trigger language plpgsql
as $$
declare slot int;
begin
  select coalesce(max(slot_minutes), 30) into slot from public.app_config;
  if new.duration_minutes % coalesce(slot, 30) <> 0 then
    raise exception 'duration_minutes (%) must be a multiple of slot_minutes (%)',
      new.duration_minutes, slot using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger enrolment_duration_multiple
  before insert or update on public.enrolments
  for each row execute function public.enrolment_duration_multiple();

-- --- RULE 7 (replaced): no overlapping active enrolments per teacher ---------
drop index if exists public.enrolments_no_double_book;

alter table public.enrolments
  add constraint enrolments_no_overlap
  exclude using gist (
    teacher_id with =,
    public.enrolment_range(slot_start, duration_minutes) with &&
  ) where (status = 'active');

-- --- classes.duration_minutes ------------------------------------------------
alter table public.classes add column duration_minutes int;
-- Backfill any existing rows from their window (empty at reset; prod-safe).
update public.classes
   set duration_minutes = greatest(30, round(extract(epoch from (scheduled_end - scheduled_start)) / 60.0)::int)
 where duration_minutes is null;
alter table public.classes alter column duration_minutes set default 30;
alter table public.classes alter column duration_minutes set not null;
