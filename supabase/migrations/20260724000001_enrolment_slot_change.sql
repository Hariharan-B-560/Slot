-- =============================================================================
-- Permanent slot change — move a student's ongoing daily time.
--
-- Changes an ACTIVE enrolment's slot_start (time-of-day) so all FUTURE classes
-- follow. The anti-fraud ledger forbids deleting classes or repointing their
-- teacher/time directly, so this reuses the ONLY sanctioned path that moves a
-- class — reschedule_class() — once per future published class, then tops up any
-- gaps via generate_classes(). Admin-only; every moved class is audited in
-- class_reschedule_history.
--
-- Scope: time-of-day only. Changing the TEACHER is a separate change (a class's
-- teacher_id is immutable — that is modelled as re-enrolment, not here).
-- =============================================================================

create or replace function public.set_enrolment_slot(
  p_enrolment uuid, p_new_slot time, p_reason text default null
)
returns integer                                   -- number of classes moved
language plpgsql
security definer
set search_path = public
as $$
declare
  enr       public.enrolments;
  c         record;
  new_start timestamptz;
  note      text;
  moved     int := 0;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can change an enrolment slot'
      using errcode = 'insufficient_privilege';
  end if;

  select * into enr from public.enrolments where id = p_enrolment for update;
  if not found then
    raise exception 'enrolment not found';
  end if;
  -- Only a live, active enrolment is rescheduled (paused/ended are left alone).
  if enr.status <> 'active' then
    raise exception 'only an active enrolment can be rescheduled (status is %)', enr.status
      using errcode = 'check_violation';
  end if;
  if p_new_slot = enr.slot_start then
    return 0;                                     -- no-op
  end if;

  note := format('slot change %s→%s', enr.slot_start, p_new_slot)
          || coalesce(': ' || nullif(p_reason, ''), '');

  -- 1) Move the recurring slot. The enrolments EXCLUDE constraint auto-rejects a
  --    collision with another active/paused enrolment for this teacher.
  update public.enrolments set slot_start = p_new_slot where id = p_enrolment;

  -- 2) Move every FUTURE published class to the new time on its own IST date via
  --    the sanctioned reschedule path (admin-gated, rule-7 overlap-checked,
  --    audited). Delivered/verified/flagged/missed classes are frozen and skipped.
  for c in
    select id, scheduled_start
    from public.classes
    where enrolment_id = p_enrolment
      and status = 'published'
      and scheduled_start > now()
    order by scheduled_start
  loop
    new_start := ((c.scheduled_start at time zone 'Asia/Kolkata')::date + p_new_slot)
                 at time zone 'Asia/Kolkata';
    -- Don't move a class into the past (e.g. today's slot already passed); leave
    -- it at its old time — the new slot still applies from the next day on.
    if new_start <> c.scheduled_start and new_start > now() then
      perform public.reschedule_class(c.id, new_start, null, note);
      moved := moved + 1;
    end if;
  end loop;

  -- 3) Fill any newly-opened future gaps at the new slot.
  perform public.generate_classes();
  return moved;
end;
$$;

revoke all on function public.set_enrolment_slot(uuid, time, text) from public;
grant execute on function public.set_enrolment_slot(uuid, time, text) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
