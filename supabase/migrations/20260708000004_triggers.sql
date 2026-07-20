-- =============================================================================
-- 0004 — Triggers (the anti-fraud teeth)
-- Enforces rules 1, 2, 3, 4, 5 in the database. Rule 6 (row ownership) is RLS
-- only and lives in 0005. All rules are enforced here, never in app code.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- classes: born published, lawful state transitions, RULES 1 & 2 & 5.
-- -----------------------------------------------------------------------------
create or replace function public.classes_enforce_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- Classes are always born 'published' (state machine). This stops inserting
    -- an already-'delivered'/'verified' row to skip the deliver/verify guards.
    if new.status <> 'published' then
      raise exception
        'classes must be created with status ''published'' (got %)', new.status
        using errcode = 'check_violation';
    end if;

    -- RULE 2 — publish-before-happen. Default the timestamp; the CHECK
    -- constraint (0002) guarantees published_at < scheduled_start.
    new.published_at := coalesce(new.published_at, now());

    -- A freshly published class carries no delivery/verify facts.
    new.delivered_at := null; new.delivered_by := null;
    new.verified_at  := null; new.verified_by  := null; new.verify_source := null;
    return new;
  end if;

  -- tg_op = 'UPDATE' below. Immutability is enforced separately (append_only).

  -- RULE 1 — no backfilling. On the transition into 'delivered', stamp the
  -- delivery with server time (a teacher cannot supply an arbitrary past/future
  -- delivered_at) and reject if now() falls outside the class window + grace.
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := now();
    new.delivered_by := coalesce(auth.uid(), new.teacher_id);

    if now() < (new.scheduled_start - public.delivery_grace())
       or now() > (new.scheduled_end + public.delivery_grace()) then
      raise exception
        'RULE 1 no-backfill: cannot mark delivered outside the class window [% .. %] (grace %)',
        new.scheduled_start, new.scheduled_end, public.delivery_grace()
        using errcode = 'check_violation';
    end if;
  end if;

  -- RULE 5 — no self-verify. Only an admin (or a future auto-verify source)
  -- may move a class to 'verified'; never the delivering teacher.
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

    -- Belt-and-suspenders: the delivering teacher can never be the verifier.
    if new.verified_by is not null and new.verified_by = new.delivered_by then
      raise exception
        'RULE 5 no-self-verify: the delivering teacher cannot verify their own class'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger classes_enforce_lifecycle
  before insert or update on public.classes
  for each row execute function public.classes_enforce_lifecycle();

-- -----------------------------------------------------------------------------
-- classes: RULE 3 — append-only ledger. Historical facts are immutable; only
-- lifecycle columns may change. DELETE is forbidden outright (corrections are
-- new rows). Enforced for every role, including service_role.
-- -----------------------------------------------------------------------------
create or replace function public.classes_append_only()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.slot_type       is distinct from old.slot_type
     or new.teacher_id      is distinct from old.teacher_id
     or new.student_id      is distinct from old.student_id
     or new.enrolment_id    is distinct from old.enrolment_id
     or new.scheduled_start is distinct from old.scheduled_start
     or new.scheduled_end   is distinct from old.scheduled_end
     or new.published_at    is distinct from old.published_at
     or new.created_at      is distinct from old.created_at then
    raise exception
      'RULE 3 append-only: historical class columns are immutable; record a correction as a new row'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger classes_append_only
  before update on public.classes
  for each row execute function public.classes_append_only();

create or replace function public.classes_block_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'RULE 3 append-only: classes rows cannot be deleted; record a correction as a new row'
    using errcode = 'restrict_violation';
end;
$$;

create trigger classes_block_delete
  before delete on public.classes
  for each row execute function public.classes_block_delete();

-- -----------------------------------------------------------------------------
-- conversion_events: RULE 4 — no self-conversion. The recorder must be an
-- admin. Since admin and teacher roles are disjoint, an admin recorder is by
-- definition never the demo teacher. (Teachers also have no INSERT via RLS.)
-- -----------------------------------------------------------------------------
create or replace function public.conversion_recorder_is_admin()
returns trigger
language plpgsql
as $$
begin
  if not public.is_admin(new.recorded_by) then
    raise exception
      'RULE 4 no-self-conversion: conversion_events.recorded_by must be an admin (got role %)',
      public.role_of(new.recorded_by)
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger conversion_recorder_is_admin
  before insert or update on public.conversion_events
  for each row execute function public.conversion_recorder_is_admin();
