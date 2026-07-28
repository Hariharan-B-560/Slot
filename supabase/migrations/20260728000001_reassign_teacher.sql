-- =============================================================================
-- Reassign a student to another teacher — modelled as RE-ENROLMENT.
--
-- A class's teacher_id is immutable and classes can't be deleted (append-only
-- ledger), so we can't repoint the existing classes. Instead:
--   1. cancel the old enrolment's FUTURE published classes (-> missed),
--   2. END the old enrolment (audited),
--   3. open a NEW enrolment under the new teacher, CONTINUING the package
--      (same total_sessions; sessions delivered so far count toward it),
--   4. regenerate classes under the new teacher.
-- The old teacher keeps every class they actually delivered; pay/utilisation
-- attribution stays correct. Admin-only. The (teacher, slot) exclusion rejects a
-- clash with another active/paused enrolment for the new teacher.
-- =============================================================================

create or replace function public.reassign_teacher(
  p_enrolment   uuid,
  p_new_teacher uuid,
  p_new_slot    time,
  p_reason      text default null
)
returns uuid                                      -- the new enrolment's id
language plpgsql
security definer
set search_path = public
as $$
declare
  old            public.enrolments;
  delivered_here int;
  new_already    int;
  new_id         uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can reassign a student' using errcode = 'insufficient_privilege';
  end if;

  select * into old from public.enrolments where id = p_enrolment for update;
  if not found then
    raise exception 'enrolment not found';
  end if;
  if old.status not in ('active', 'paused') then
    raise exception 'only an active or paused enrolment can be reassigned (status is %)', old.status
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.profiles
                 where id = p_new_teacher and role = 'teacher' and active) then
    raise exception 'the new teacher must be an active teacher' using errcode = 'check_violation';
  end if;
  if p_new_teacher = old.teacher_id then
    raise exception 'that is already the student''s teacher' using errcode = 'check_violation';
  end if;

  -- Sessions delivered so far on the old enrolment — credited to the package.
  select count(*)::int into delivered_here
  from public.classes
  where enrolment_id = p_enrolment and status in ('delivered', 'verified');

  new_already := coalesce(old.sessions_already_delivered, 0) + delivered_here;

  if old.total_sessions is not null and new_already >= old.total_sessions then
    raise exception 'this package has no sessions left to reassign'
      using errcode = 'check_violation';
  end if;

  -- 1) Cancel the old enrolment's FUTURE published classes (clean handoff).
  update public.classes
     set status = 'missed'
   where enrolment_id = p_enrolment
     and status = 'published'
     and scheduled_start > now();

  -- 2) End the old enrolment (the status-change trigger logs it with the reason).
  perform set_config('app.status_reason',
    'reassigned to another teacher' ||
      coalesce(nullif(': ' || nullif(p_reason, ''), ': '), ''),
    true);
  update public.enrolments set status = 'ended' where id = p_enrolment;
  perform set_config('app.status_reason', '', true);

  -- 3) Open the new enrolment under the new teacher, continuing the package.
  insert into public.enrolments
    (student_id, teacher_id, conversion_event_id, slot_start, duration_minutes,
     start_date, end_date, total_sessions, sessions_already_delivered, course, status)
  values
    (old.student_id, p_new_teacher, old.conversion_event_id, p_new_slot, old.duration_minutes,
     current_date, old.end_date, old.total_sessions, new_already, old.course, 'active')
  returning id into new_id;

  -- 4) Generate classes for the new enrolment.
  perform public.generate_classes();
  return new_id;
end;
$$;

revoke all on function public.reassign_teacher(uuid, uuid, time, text) from public;
grant execute on function public.reassign_teacher(uuid, uuid, time, text) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
