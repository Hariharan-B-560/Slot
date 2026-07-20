-- =============================================================================
-- Phase 1.5 — 2/3 TRIGGERS & FUNCTIONS
--   * has_session_report() helper
--   * availability_blocks length must be a whole multiple of session_minutes
--   * classes_enforce_lifecycle: RULE 8 (report-before-delivered) + ASYMMETRIC
--     deliver window [scheduled_start, scheduled_end + grace] (no early delivery)
--   * generate_classes: respect BOTH caps (end_date and total_sessions)
-- =============================================================================

-- Reliable existence check for RULE 8, independent of session_reports RLS.
create or replace function public.has_session_report(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.session_reports where class_id = p_class) $$;

-- --- availability block length must be a whole multiple of session_minutes ----
create or replace function public.availability_block_multiple()
returns trigger
language plpgsql
as $$
declare
  sess int;
  mins numeric;
begin
  select coalesce(max(session_minutes), 30) into sess from public.app_config;
  sess := coalesce(sess, 30);
  mins := extract(epoch from (new.end_time - new.start_time)) / 60.0;

  if mins <= 0 or mins <> floor(mins) or (mins::int % sess) <> 0 then
    raise exception
      'availability block length (% min) must be a positive whole multiple of session_minutes (%)',
      mins, sess
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger availability_block_multiple
  before insert or update on public.availability_blocks
  for each row execute function public.availability_block_multiple();

-- --- classes lifecycle: + RULE 8, + asymmetric window ------------------------
create or replace function public.classes_enforce_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'published' then
      raise exception
        'classes must be created with status ''published'' (got %)', new.status
        using errcode = 'check_violation';
    end if;
    new.published_at := coalesce(new.published_at, now());
    new.delivered_at := null; new.delivered_by := null;
    new.verified_at  := null; new.verified_by  := null; new.verify_source := null;
    return new;
  end if;

  -- Transition into 'delivered'.
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    -- RULE 8 — no delivery without a session report.
    if not public.has_session_report(new.id) then
      raise exception
        'RULE 8 report-required: a session_reports row must exist before a class can be marked delivered'
        using errcode = 'check_violation';
    end if;

    -- RULE 1 — no backfilling, ASYMMETRIC window. Deliver only from
    -- scheduled_start (never early) until scheduled_end + grace.
    new.delivered_at := now();
    new.delivered_by := coalesce(auth.uid(), new.teacher_id);

    if now() < new.scheduled_start
       or now() > (new.scheduled_end + public.delivery_grace()) then
      raise exception
        'RULE 1 no-backfill: deliver only within [%, % + grace %]; no early delivery',
        new.scheduled_start, new.scheduled_end, public.delivery_grace()
        using errcode = 'check_violation';
    end if;
  end if;

  -- RULE 5 — no self-verify (unchanged).
  if new.status = 'verified' and old.status is distinct from 'verified' then
    if not public.is_admin(auth.uid())
       and coalesce(new.verify_source, 'admin') not in ('join_log', 'student') then
      raise exception
        'RULE 5 no-self-verify: only an admin or an auto-verify source may verify a class'
        using errcode = 'insufficient_privilege';
    end if;

    new.verified_at := now();
    if public.is_admin(auth.uid()) then
      new.verified_by   := auth.uid();
      new.verify_source := coalesce(new.verify_source, 'admin');
    end if;

    if new.verified_by is not null and new.verified_by = new.delivered_by then
      raise exception
        'RULE 5 no-self-verify: the delivering teacher cannot verify their own class'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;
-- (trigger binding from 0004 still applies; only the function body changed.)

-- --- generation: respect BOTH caps (end_date and total_sessions) -------------
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
    -- Number occurrences over the enrolment's life (from start_date) so
    -- total_sessions is a lifetime cap, not a per-window one. The series upper
    -- bound is the horizon, further capped by end_date when present.
    select e.id as enrolment_id, e.teacher_id, e.student_id, e.slot_start,
           e.total_sessions,
           d::date as occ_date,
           row_number() over (partition by e.id order by d) as seq
    from public.enrolments e
    cross join generate_series(
      e.start_date,
      least(coalesce(e.end_date, current_date + horizon_days), current_date + horizon_days),
      interval '1 day'
    ) d
    where e.status = 'active'
      and extract(dow from d)::int = any (e.weekdays)
  ),
  planned as (
    select enrolment_id, teacher_id, student_id,
           ((occ_date + slot_start) at time zone 'Asia/Kolkata') as sstart
    from occ
    where total_sessions is null or seq <= total_sessions   -- count cap
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
