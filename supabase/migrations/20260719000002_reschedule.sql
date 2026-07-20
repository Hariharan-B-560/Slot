-- =============================================================================
-- Reschedule requests.
--
-- A teacher can NEVER move their own class. They file a request; an admin
-- decides. Approval MOVES the original class row (updates scheduled_start/end)
-- — it does not create a duplicate — so total_sessions and every anti-fraud
-- rule stay intact. The move is:
--   * admin-only and audited (class_reschedule_history, append-only),
--   * blocked unless the class is still 'published' (delivered+ is immovable),
--   * overlap-checked like placement (a partial EXCLUDE on published classes).
--
-- scheduled_start/end are immutable via classes_append_only; we open a narrow,
-- admin-only, flag-gated exception used ONLY by reschedule_class().
-- =============================================================================

-- --- reschedule_requests -----------------------------------------------------
create table public.reschedule_requests (
  id             uuid primary key default extensions.gen_random_uuid(),
  class_id       uuid not null references public.classes (id),
  requested_by   uuid not null references public.profiles (id),
  requested_at   timestamptz not null default now(),
  reason         text not null,
  proposed_start timestamptz,                    -- teacher's suggestion (optional)
  status         text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by     uuid references public.profiles (id),
  decided_at     timestamptz,
  decision_note  text
);
create index reschedule_requests_status on public.reschedule_requests (status);
create index reschedule_requests_class on public.reschedule_requests (class_id);

alter table public.reschedule_requests enable row level security;
grant select, insert, update on public.reschedule_requests to authenticated;

-- Teacher: may file a request for their OWN class, and read their own requests.
create policy rr_teacher_insert on public.reschedule_requests
  for insert to authenticated
  with check (
    public.can_act()
    and requested_by = auth.uid()
    and exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );
create policy rr_teacher_select on public.reschedule_requests
  for select to authenticated
  using (requested_by = auth.uid() and public.can_act());
-- Admin: read every request and decide (update status/decision).
create policy rr_admin_all on public.reschedule_requests
  for all to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());

-- --- class_reschedule_history (append-only audit) ----------------------------
create table public.class_reschedule_history (
  id             uuid primary key default extensions.gen_random_uuid(),
  class_id       uuid not null references public.classes (id),
  previous_start timestamptz not null,
  new_start      timestamptz not null,
  moved_by       uuid not null references public.profiles (id),
  moved_at       timestamptz not null default now(),
  request_id     uuid references public.reschedule_requests (id),
  note           text
);
create index class_reschedule_history_class on public.class_reschedule_history (class_id);

alter table public.class_reschedule_history enable row level security;
grant select, insert on public.class_reschedule_history to authenticated;

-- Admin reads all; a teacher reads history for their own classes. Rows are only
-- ever written by reschedule_class() (SECURITY DEFINER), so no INSERT policy for
-- normal roles — and append-only: no UPDATE/DELETE grant, plus a delete block.
create policy crh_admin_select on public.class_reschedule_history
  for select to authenticated using (public.is_admin() and public.can_act());
create policy crh_teacher_select on public.class_reschedule_history
  for select to authenticated
  using (public.can_act() and exists (
    select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid()));

create or replace function public.crh_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'class_reschedule_history is append-only' using errcode = 'restrict_violation';
end;
$$;
create trigger crh_no_update before update on public.class_reschedule_history
  for each row execute function public.crh_block_mutation();
create trigger crh_no_delete before delete on public.class_reschedule_history
  for each row execute function public.crh_block_mutation();

-- Note on overlap: a table-wide EXCLUDE is NOT usable here — the seed and
-- several test fixtures intentionally hold overlapping same-teacher classes
-- across statuses (a verified + a live published one, etc.). Rule-7-style
-- overlap for a MOVE is therefore enforced inside reschedule_class() against a
-- teacher's other live classes — the only path that moves a class.

-- --- append-only: allow start/end to move ONLY under an admin reschedule ------
-- Narrow exception: scheduled_start/end may change when the reschedule flag is
-- set AND the caller is an admin. Everything else stays immutable for all roles.
create or replace function public.classes_append_only()
returns trigger
language plpgsql
as $$
declare
  rescheduling boolean := coalesce(current_setting('app.rescheduling', true), '') = '1'
                          and public.is_admin(auth.uid());
begin
  if new.id <> old.id
     or new.slot_type    is distinct from old.slot_type
     or new.teacher_id   is distinct from old.teacher_id
     or new.student_id   is distinct from old.student_id
     or new.enrolment_id is distinct from old.enrolment_id
     or new.published_at is distinct from old.published_at
     or new.created_at   is distinct from old.created_at
     or (not rescheduling and new.scheduled_start is distinct from old.scheduled_start)
     or (not rescheduling and new.scheduled_end   is distinct from old.scheduled_end)
  then
    raise exception
      'RULE 3 append-only: historical class columns are immutable; record a correction as a new row'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- --- reschedule_class: the ONLY sanctioned path to move a class --------------
create or replace function public.reschedule_class(
  p_class_id uuid, p_new_start timestamptz, p_request_id uuid default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cls        public.classes;
  new_end    timestamptz;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can reschedule a class' using errcode = 'insufficient_privilege';
  end if;

  select * into cls from public.classes where id = p_class_id for update;
  if not found then
    raise exception 'class not found';
  end if;
  -- Only upcoming, still-published classes are movable (rule: delivered+ frozen).
  if cls.status <> 'published' then
    raise exception 'only a published class can be rescheduled (status is %)', cls.status
      using errcode = 'check_violation';
  end if;

  new_end := p_new_start + make_interval(mins => cls.duration_minutes);

  -- Rule 7 (overlap) for the move: the target must not collide with another
  -- LIVE class for the same teacher (published/delivered/verified/flagged).
  if exists (
    select 1 from public.classes k
    where k.teacher_id = cls.teacher_id
      and k.id <> p_class_id
      and k.status in ('published', 'delivered', 'verified', 'flagged')
      and tstzrange(k.scheduled_start, k.scheduled_end) && tstzrange(p_new_start, new_end)
  ) then
    raise exception 'rule 7: the target slot overlaps another class for this teacher'
      using errcode = 'exclusion_violation';
  end if;

  perform set_config('app.rescheduling', '1', true);

  insert into public.class_reschedule_history (class_id, previous_start, new_start, moved_by, request_id, note)
  values (p_class_id, cls.scheduled_start, p_new_start, auth.uid(), p_request_id, p_note);

  -- The move: append-only now permits start/end; the partial EXCLUDE rejects a
  -- collision with another published class for this teacher (rule 7).
  update public.classes
     set scheduled_start = p_new_start,
         scheduled_end   = new_end
   where id = p_class_id;

  if p_request_id is not null then
    update public.reschedule_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
     where id = p_request_id;
  end if;

  perform set_config('app.rescheduling', '', true);
end;
$$;

revoke all on function public.reschedule_class(uuid, timestamptz, uuid, text) from public;
grant execute on function public.reschedule_class(uuid, timestamptz, uuid, text) to authenticated;

-- service_role (server-only, bypasses RLS) needs grants on the new objects from
-- BOTH migrations — the one-time grant in 20260709000005 predates them.
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
