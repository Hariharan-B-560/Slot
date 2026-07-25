-- =============================================================================
-- Pause / Resume enrolments — "hold the slot".
--
-- A paused enrolment keeps its slot reserved (rule 7 still applies), stops
-- generating classes, and leaves total_sessions untouched — paid sessions are
-- delivered later. Open-ended: no resume date; admin resumes manually.
--
-- Two joined decisions drive the generator here:
--   * pausing does NOT delete already-generated future classes — they simply go
--     'missed' via the sweep (append-only rule untouched);
--   * total_sessions is honoured across the gap (sessions delivered later).
-- The only cap that satisfies both is a COUNT of *non-missed* classes: a missed
-- class no longer consumes a paid session, so the pause-era misses regenerate as
-- make-ups after resume. (Consequence, system-wide: any no-show regenerates too,
-- until total_sessions are actually delivered.)
-- =============================================================================

-- --- status: active | paused | ended -----------------------------------------
update public.enrolments set status = 'ended'
  where status not in ('active', 'ended');   -- fold any legacy inactive/cancelled

alter table public.enrolments
  add constraint enrolments_status_allowed check (status in ('active', 'paused', 'ended'));

alter table public.enrolments
  add column paused_at    timestamptz,
  add column pause_reason text;

-- The biconditional: paused_at is set exactly when status = 'paused'.
alter table public.enrolments
  add constraint enrolments_pause_paired
  check ((status = 'paused') = (paused_at is not null));

-- Keep the pair honest no matter how status changes (end/resume auto-clear it).
create or replace function public.enrolments_normalise_pause()
returns trigger language plpgsql as $$
begin
  if new.status <> 'paused' then
    new.paused_at := null;
    new.pause_reason := null;
  end if;
  return new;
end $$;
create trigger enrolments_normalise_pause before update on public.enrolments
  for each row execute function public.enrolments_normalise_pause();

-- --- enrolment_status_history (append-only audit) ----------------------------
create table public.enrolment_status_history (
  id              uuid primary key default extensions.gen_random_uuid(),
  enrolment_id    uuid not null references public.enrolments (id),
  previous_status text,
  new_status      text not null,
  changed_by      uuid references public.profiles (id),
  changed_at      timestamptz not null default now(),
  reason          text
);
create index enrolment_status_history_enrolment on public.enrolment_status_history (enrolment_id);

alter table public.enrolment_status_history enable row level security;
grant select on public.enrolment_status_history to authenticated;   -- no insert: trigger writes it

create policy esh_admin_select on public.enrolment_status_history
  for select to authenticated using (public.is_admin() and public.can_act());

create or replace function public.esh_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'enrolment_status_history is append-only' using errcode = 'restrict_violation';
end $$;
create trigger esh_no_update before update on public.enrolment_status_history
  for each row execute function public.esh_block_mutation();
create trigger esh_no_delete before delete on public.enrolment_status_history
  for each row execute function public.esh_block_mutation();

-- Log every status change. SECURITY DEFINER so it can write the no-direct-insert
-- table; the reason (optional) rides a session GUC set by the pause/resume fns.
create or replace function public.enrolments_log_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.enrolment_status_history (enrolment_id, previous_status, new_status, changed_by, reason)
  values (new.id, old.status, new.status, auth.uid(),
          nullif(current_setting('app.status_reason', true), ''));
  return new;
end $$;
create trigger enrolments_status_change
  after update on public.enrolments
  for each row when (old.status is distinct from new.status)
  execute function public.enrolments_log_status_change();

-- --- rule 7: the slot is held while PAUSED too --------------------------------
alter table public.enrolments drop constraint enrolments_no_overlap;
alter table public.enrolments
  add constraint enrolments_no_overlap
  exclude using gist (
    teacher_id with =,
    public.enrolment_range(slot_start, duration_minutes) with &&
  ) where (status in ('active', 'paused'));

-- --- a class can never be delivered under a paused enrolment ------------------
create or replace function public.classes_block_paused_delivery()
returns trigger language plpgsql as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered'
     and new.enrolment_id is not null
     and exists (select 1 from public.enrolments e where e.id = new.enrolment_id and e.status = 'paused')
  then
    raise exception 'cannot deliver a class while its enrolment is paused'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger classes_block_paused_delivery before update on public.classes
  for each row execute function public.classes_block_paused_delivery();

-- --- generator: count-based cap (excludes 'missed' → make-ups + pause extend) -
-- Skips paused enrolments (status='active' only). The Nth session is the Nth
-- *non-missed* class, so a pause gap (or a no-show) regenerates later, honouring
-- total_sessions. Never backfills (sstart > now → rule 1 holds).
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
      and public.is_open_day(e.teacher_id, d::date)
  ),
  -- non-missed classes already materialised per enrolment "use up" sessions
  have as (
    select enrolment_id, count(*)::int as materialised
    from public.classes
    where status <> 'missed'
    group by enrolment_id
  ),
  -- rank the still-generatable FUTURE open-days
  ranked as (
    select o.*,
           ((o.occ_date + o.slot_start) at time zone 'Asia/Kolkata') as sstart,
           row_number() over (
             partition by o.enrolment_id
             order by o.occ_date
           ) as rnk
    from occ o
    where ((o.occ_date + o.slot_start) at time zone 'Asia/Kolkata') > now()
  ),
  planned as (
    select r.enrolment_id, r.teacher_id, r.student_id, r.duration_minutes, r.sstart
    from ranked r
    left join have h on h.enrolment_id = r.enrolment_id
    where r.total_sessions is null
       or r.rnk <= (r.total_sessions
                    - coalesce(r.sessions_already_delivered, 0)
                    - coalesce(h.materialised, 0))
  ),
  ins as (
    insert into public.classes
      (slot_type, teacher_id, student_id, enrolment_id, scheduled_start, scheduled_end, duration_minutes)
    select 'ENROLLED', teacher_id, student_id, enrolment_id,
           sstart, sstart + make_interval(mins => duration_minutes), duration_minutes
    from planned
    on conflict (enrolment_id, scheduled_start) do nothing
    returning 1
  )
  select count(*) into inserted from ins;
  return inserted;
end;
$$;

-- --- pause / resume (admin-only, audited) ------------------------------------
create or replace function public.pause_enrolment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can pause an enrolment' using errcode = 'insufficient_privilege';
  end if;
  select status into cur from public.enrolments where id = p_id for update;
  if cur is null then raise exception 'enrolment not found'; end if;
  if cur <> 'active' then
    raise exception 'only an active enrolment can be paused (status is %)', cur using errcode = 'check_violation';
  end if;
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.enrolments
     set status = 'paused', paused_at = now(), pause_reason = p_reason
   where id = p_id;
  perform set_config('app.status_reason', '', true);
end $$;

create or replace function public.resume_enrolment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can resume an enrolment' using errcode = 'insufficient_privilege';
  end if;
  select status into cur from public.enrolments where id = p_id for update;
  if cur is null then raise exception 'enrolment not found'; end if;
  if cur <> 'paused' then
    raise exception 'only a paused enrolment can be resumed (status is %)', cur using errcode = 'check_violation';
  end if;
  perform set_config('app.status_reason', 'resumed', true);
  update public.enrolments
     set status = 'active', paused_at = null, pause_reason = null
   where id = p_id;
  perform set_config('app.status_reason', '', true);
  perform public.generate_classes();   -- classes reappear immediately, today-forward
end $$;

revoke all on function public.pause_enrolment(uuid, text)  from public;
revoke all on function public.resume_enrolment(uuid)       from public;
grant execute on function public.pause_enrolment(uuid, text) to authenticated;
grant execute on function public.resume_enrolment(uuid)      to authenticated;

-- --- dashboard: long-paused (>30 days) attention list ------------------------
create or replace function public.dashboard_long_paused()
returns table (student_id uuid, student text, teacher text, days_paused int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;
  return query
  select e.student_id, st.name, p.name, (current_date - e.paused_at::date)::int
  from public.enrolments e
  join public.students st on st.id = e.student_id
  join public.profiles  p on p.id = e.teacher_id
  where e.status = 'paused' and e.paused_at < now() - interval '30 days'
  order by e.paused_at asc;
end $$;
grant execute on function public.dashboard_long_paused() to authenticated;

-- --- available_slots: a PAUSED enrolment still occupies its slot -------------
-- The slot is held (rule 7), so the strip must show it as taken, not free — and
-- flag it paused so the UI can render it muted/striped. Occupancy now counts
-- active + paused; a new `occupant_paused` column carries the flavour. (No
-- paused rows exist in the fits/slot tests, so their results are unchanged.)
-- Drop first: adding a return column is a return-type change, so create-or-
-- replace can't do it.
drop function if exists public.available_slots(uuid, int, date);
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
  enrolment_id      uuid,
  occupant_paused   boolean
)
language sql
stable
as $$
  with cfg as (
    select coalesce(max(slot_minutes), 30) as slot,
           coalesce(max(closed_weekdays), '{0,6}'::smallint[]) as closed
    from public.app_config
  ),
  oo as (
    select * from public.availability_overrides o
    where p_date is not null and o.teacher_id = p_teacher and o.date = p_date and o.kind = 'open'
    limit 1
  ),
  day_open as (
    select case
      when p_date is null then true
      when extract(dow from p_date)::int = 0 then false
      when exists (select 1 from oo) then true
      when extract(dow from p_date)::int = any(cfg.closed) then false
      when exists (select 1 from public.availability_overrides o
                   where o.teacher_id = p_teacher and o.date = p_date
                     and o.kind = 'close' and o.start_time is null) then false
      else true
    end as ok
    from cfg
  ),
  src as (
    select o.start_time as s, o.end_time as e
    from oo o where o.start_time is not null and (select ok from day_open)
    union all
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
             where x.teacher_id = p_teacher and x.status in ('active', 'paused')
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
    e.id as enrolment_id,
    (e.status = 'paused') as occupant_paused
  from freeset f
  left join lateral (
    select en.* from public.enrolments en
    where en.teacher_id = p_teacher and en.status in ('active', 'paused')
      and public.enrolment_range(en.slot_start, en.duration_minutes)
          && public.enrolment_range(f.t, (select slot from cfg))
    limit 1
  ) e on true
  left join public.students s on s.id = e.student_id
  order by f.t;
$$;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
