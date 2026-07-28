-- =============================================================================
-- Admin retro-close — a fenced exception for "the teacher taught it but forgot
-- to mark it delivered in the window."
--
-- The anti-fraud spine normally makes a forgotten class unrecoverable (Rule 1
-- no-backfill + the evidence-window). This adds ONE sanctioned way back, gated
-- hard so it can't become a fabrication tool:
--   * ADMIN ONLY (never the delivering teacher) — no-self-verify stays intact.
--   * evidence + reason REQUIRED (the teacher's screenshots; Rule 8 upheld).
--   * only a PAST, never-delivered class WITHIN 3 DAYS (not old backfilling).
--   * LOUDLY AUDITED in retro_close_events → surfaced in Integrity as exceptions.
--
-- The window bypass is a narrow, admin + flag-gated carve-out inside the two
-- window triggers — the same pattern reschedule_class uses for append-only. It
-- also CLOSES a latent side door: verified may now only come from delivered.
-- =============================================================================

-- --- 1) evidence-window: allow a late report under an admin retro-close -------
create or replace function public.session_report_in_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cs    timestamptz;
  ce    timestamptz;
  retro boolean := coalesce(current_setting('app.retro_close', true), '') = '1'
                   and public.is_admin(auth.uid());
begin
  -- The report is stamped server-side; a teacher can't supply a fake time.
  new.created_at := now();

  select scheduled_start, scheduled_end into cs, ce
  from public.classes where id = new.class_id;
  if cs is null then
    raise exception 'session report references an unknown class'
      using errcode = 'foreign_key_violation';
  end if;

  if not retro and (now() < cs or now() > ce + public.delivery_grace()) then
    raise exception
      'RULE 8b evidence-window: a session report can only be filed within the class window [%, % + grace %]',
      cs, ce, public.delivery_grace()
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- --- 2) lifecycle: retro carve-out in deliver + close the verify side door ----
create or replace function public.classes_enforce_lifecycle()
returns trigger
language plpgsql
as $$
declare
  retro boolean := coalesce(current_setting('app.retro_close', true), '') = '1'
                   and public.is_admin(auth.uid());
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
    -- RULE 8 — no delivery without a session report (holds for retro too).
    if not public.has_session_report(new.id) then
      raise exception
        'RULE 8 report-required: a session_reports row must exist before a class can be marked delivered'
        using errcode = 'check_violation';
    end if;

    if retro then
      -- Admin retro-close: the class ran at its scheduled time; stamp the
      -- historical window and credit the TEACHER (not the acting admin).
      new.delivered_at := new.scheduled_end;
      new.delivered_by := new.teacher_id;
    else
      -- RULE 1 — no backfilling, ASYMMETRIC window (no early delivery).
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
  end if;

  -- Transition into 'verified'.
  if new.status = 'verified' and old.status is distinct from 'verified' then
    -- A class must be DELIVERED (or flagged = delivered-but-unverified) before it
    -- can be verified. Closes the published/missed -> verified side door, so the
    -- ONLY way past the window is the audited admin_retro_close path.
    if old.status not in ('delivered', 'flagged') then
      raise exception
        'a class must be delivered before it can be verified (was %)', old.status
        using errcode = 'check_violation';
    end if;

    -- RULE 5 — no self-verify.
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

-- --- 3) retro_close_events (append-only audit) -------------------------------
create table public.retro_close_events (
  id         uuid primary key default extensions.gen_random_uuid(),
  class_id   uuid not null references public.classes (id),
  closed_by  uuid not null references public.profiles (id),
  reason     text not null,
  closed_at  timestamptz not null default now()
);
create index retro_close_events_class on public.retro_close_events (class_id);

alter table public.retro_close_events enable row level security;
grant select on public.retro_close_events to authenticated;   -- no insert: fn writes it

create policy retro_close_admin_select on public.retro_close_events
  for select to authenticated using (public.is_admin() and public.can_act());

create or replace function public.retro_close_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'retro_close_events is append-only' using errcode = 'restrict_violation';
end $$;
create trigger retro_close_no_update before update on public.retro_close_events
  for each row execute function public.retro_close_block_mutation();
create trigger retro_close_no_delete before delete on public.retro_close_events
  for each row execute function public.retro_close_block_mutation();

-- --- 4) admin_retro_close: the one sanctioned path ---------------------------
create or replace function public.admin_retro_close(
  p_class         uuid,
  p_reason        text,
  p_opening       text,
  p_closing       text,
  p_attendance    public.attendance default 'present',
  p_absent_reason text default null,
  p_recording     text default null,
  p_notes         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cls public.classes;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can retro-close a class' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  if p_opening is null or p_closing is null then
    raise exception 'opening and closing evidence are required' using errcode = 'check_violation';
  end if;

  select * into cls from public.classes where id = p_class for update;
  if not found then
    raise exception 'class not found';
  end if;
  -- Only a never-delivered class (published, or already swept to missed).
  if cls.status not in ('published', 'missed') then
    raise exception 'only a never-delivered class can be retro-closed (status is %)', cls.status
      using errcode = 'check_violation';
  end if;
  -- Must be PAST its delivery window (else deliver it the normal way) ...
  if cls.scheduled_end + public.delivery_grace() >= now() then
    raise exception 'this class is still within its delivery window — deliver it normally'
      using errcode = 'check_violation';
  end if;
  -- ... and WITHIN the 3-day cap (this is for "forgot to click", not backfilling).
  if cls.scheduled_start < now() - interval '3 days' then
    raise exception 'too old to retro-close (more than 3 days ago)'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.retro_close', '1', true);

  -- Evidence first (Rule 8). created_by = the acting admin (filed on behalf).
  insert into public.session_reports
    (class_id, attendance, absent_reason, opening_screenshot, closing_screenshot, recording, notes, created_by)
  values
    (p_class, p_attendance, p_absent_reason, p_opening, p_closing, p_recording, p_notes, auth.uid());

  -- Two steps so both lifecycle branches run (single-step would skip deliver).
  update public.classes set status = 'delivered' where id = p_class;
  update public.classes set status = 'verified'  where id = p_class;

  insert into public.retro_close_events (class_id, closed_by, reason)
  values (p_class, auth.uid(), p_reason);

  perform set_config('app.retro_close', '', true);
end;
$$;

revoke all on function public.admin_retro_close(uuid, text, text, text, public.attendance, text, text, text) from public;
grant execute on function public.admin_retro_close(uuid, text, text, text, public.attendance, text, text, text) to authenticated;

-- --- 5) storage: an admin may upload evidence for any class ------------------
-- The existing bucket policies only let a teacher upload under their own class.
-- Retro-close files the teacher's screenshots on their behalf, so an admin needs
-- upload rights too. Additive; the teacher/admin-read policies are untouched.
create policy "evidence_admin_insert_any_class"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'session-evidence' and public.is_admin());

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
