-- =============================================================================
-- Edit the class count (an enrolment's total_sessions).
--
-- This is a forward-looking package cap, NOT a delivered/verified fact — so it's
-- outside the anti-fraud rules and safe for an admin to correct. Guardrails keep
-- the count honest and the calendar in sync:
--   * admin-only, reason REQUIRED, audited (append-only history);
--   * can never drop below sessions already delivered (legacy + in-app);
--   * INCREASE regenerates the extra future classes;
--   * DECREASE cancels the surplus upcoming classes (latest first) — it never
--     touches a delivered/verified class.
-- =============================================================================

-- --- enrolment_sessions_history (append-only audit) --------------------------
create table public.enrolment_sessions_history (
  id             uuid primary key default extensions.gen_random_uuid(),
  enrolment_id   uuid not null references public.enrolments (id),
  previous_total integer,
  new_total      integer,
  changed_by     uuid references public.profiles (id),
  changed_at     timestamptz not null default now(),
  reason         text
);
create index enrolment_sessions_history_enrolment on public.enrolment_sessions_history (enrolment_id);

alter table public.enrolment_sessions_history enable row level security;
grant select on public.enrolment_sessions_history to authenticated;   -- no insert: fn writes it

create policy esesh_admin_select on public.enrolment_sessions_history
  for select to authenticated using (public.is_admin() and public.can_act());

create or replace function public.esesh_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'enrolment_sessions_history is append-only' using errcode = 'restrict_violation';
end $$;
create trigger esesh_no_update before update on public.enrolment_sessions_history
  for each row execute function public.esesh_block_mutation();
create trigger esesh_no_delete before delete on public.enrolment_sessions_history
  for each row execute function public.esesh_block_mutation();

-- --- set_enrolment_sessions --------------------------------------------------
create or replace function public.set_enrolment_sessions(
  p_enrolment uuid, p_total integer, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  enr             public.enrolments;
  legacy          int;
  delivered_here  int;
  total_delivered int;
  target_rows     int;   -- how many non-missed class rows should exist
  current_nonmissed int;
  surplus         int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can change the class count' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'the class count must be a positive number' using errcode = 'check_violation';
  end if;

  select * into enr from public.enrolments where id = p_enrolment for update;
  if not found then
    raise exception 'enrolment not found';
  end if;
  if enr.status not in ('active', 'paused') then
    raise exception 'only an active or paused enrolment''s class count can be edited (status is %)', enr.status
      using errcode = 'check_violation';
  end if;

  legacy := coalesce(enr.sessions_already_delivered, 0);
  select count(*)::int into delivered_here
  from public.classes
  where enrolment_id = p_enrolment and status in ('delivered', 'verified');
  total_delivered := legacy + delivered_here;

  if p_total < total_delivered then
    raise exception 'cannot set the count below sessions already delivered (%)', total_delivered
      using errcode = 'check_violation';
  end if;

  if p_total = enr.total_sessions then
    return;                                    -- no-op
  end if;

  insert into public.enrolment_sessions_history (enrolment_id, previous_total, new_total, changed_by, reason)
  values (p_enrolment, enr.total_sessions, p_total, auth.uid(), p_reason);

  update public.enrolments set total_sessions = p_total where id = p_enrolment;

  -- Reconcile the calendar with the new cap.
  target_rows := p_total - legacy;             -- intended non-missed class rows
  select count(*)::int into current_nonmissed
  from public.classes where enrolment_id = p_enrolment and status <> 'missed';
  surplus := current_nonmissed - target_rows;

  if surplus > 0 then
    -- Cancel the surplus — the LATEST published classes (never a delivered one).
    update public.classes
       set status = 'missed'
     where id in (
       select id from public.classes
       where enrolment_id = p_enrolment and status = 'published'
       order by scheduled_start desc
       limit surplus
     );
  elsif surplus < 0 then
    perform public.generate_classes();         -- add the newly-allowed classes
  end if;
end;
$$;

revoke all on function public.set_enrolment_sessions(uuid, integer, text) from public;
grant execute on function public.set_enrolment_sessions(uuid, integer, text) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
