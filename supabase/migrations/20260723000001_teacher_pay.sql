-- =============================================================================
-- Teacher pay calculation.
--
-- Pay is on VERIFIED classes only (verification is the gate — a delivered but
-- unverified class pays nothing). The rate lives on the teacher profile
-- (per-teacher, no code change) and duration matters: pay counts 30-min ATOMS
-- (duration_minutes / 30), so a 60-min class pays 2×. Admin-only everywhere —
-- teachers never see the pay CALCULATION, including their own, in v1.
--
-- v1 limitation (surfaced in the UI): teacher_pay uses the CURRENT rate, not the
-- rate in force when a class was verified. Snapshotting rate per class at verify
-- time is deferred.
-- =============================================================================

-- --- profiles.rate_per_30min --------------------------------------------------
alter table public.profiles
  add column rate_per_30min numeric not null default 50;

comment on column public.profiles.rate_per_30min is
  'Teacher pay rate per 30-min atom. Admin-only to change (see the self-update '
  'guard + rate_history). A 60-min class pays 2× this.';

-- The self-update guard is a denylist of columns a non-admin may not change on
-- their own row. Add rate_per_30min so a teacher cannot set their own pay rate.
create or replace function public.profiles_self_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  if new.id             is distinct from old.id
     or new.role        is distinct from old.role
     or new.name        is distinct from old.name
     or new.email       is distinct from old.email
     or new.active      is distinct from old.active
     or new.created_at  is distinct from old.created_at
     or new.rate_per_30min is distinct from old.rate_per_30min then
    raise exception 'you may only change your own password state'
      using errcode = 'insufficient_privilege';
  end if;

  if old.must_change_password = false and new.must_change_password = true then
    raise exception 'cannot re-arm the password-change flag'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- --- rate_history (append-only audit of rate changes) ------------------------
create table public.rate_history (
  id            uuid primary key default extensions.gen_random_uuid(),
  teacher_id    uuid not null references public.profiles (id),
  previous_rate numeric,
  new_rate      numeric,
  changed_by    uuid references public.profiles (id),
  changed_at    timestamptz not null default now(),
  reason        text
);
create index rate_history_teacher on public.rate_history (teacher_id);

alter table public.rate_history enable row level security;
grant select on public.rate_history to authenticated;   -- no insert: trigger writes it

create policy rate_history_admin_select on public.rate_history
  for select to authenticated using (public.is_admin() and public.can_act());

create or replace function public.rate_history_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'rate_history is append-only' using errcode = 'restrict_violation';
end $$;
create trigger rate_history_no_update before update on public.rate_history
  for each row execute function public.rate_history_block_mutation();
create trigger rate_history_no_delete before delete on public.rate_history
  for each row execute function public.rate_history_block_mutation();

-- Log every rate change (SECURITY DEFINER writes the no-direct-insert table).
-- Reason rides a session GUC set by set_teacher_rate.
create or replace function public.profiles_log_rate_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.rate_history (teacher_id, previous_rate, new_rate, changed_by, reason)
  values (new.id, old.rate_per_30min, new.rate_per_30min, auth.uid(),
          nullif(current_setting('app.rate_reason', true), ''));
  return new;
end $$;
create trigger profiles_rate_change
  after update on public.profiles
  for each row when (old.rate_per_30min is distinct from new.rate_per_30min)
  execute function public.profiles_log_rate_change();

-- --- set_teacher_rate: admin-only rate change carrying the reason ------------
create or replace function public.set_teacher_rate(p_teacher uuid, p_rate numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can change a teacher rate' using errcode = 'insufficient_privilege';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'rate must be a non-negative number' using errcode = 'check_violation';
  end if;
  perform set_config('app.rate_reason', coalesce(p_reason, ''), true);
  update public.profiles set rate_per_30min = p_rate where id = p_teacher and role = 'teacher';
  perform set_config('app.rate_reason', '', true);
end $$;
revoke all on function public.set_teacher_rate(uuid, numeric, text) from public;
grant execute on function public.set_teacher_rate(uuid, numeric, text) to authenticated;

-- --- teacher_pay: what one teacher is owed for a range ----------------------
-- Verified classes only. atoms = SUM(duration_minutes/30); gross = atoms × rate.
-- Admin-guarded (a teacher gets zero rows — no pay figures, even their own).
create or replace function public.teacher_pay(p_teacher uuid, p_from date, p_to date)
returns table (verified_atoms numeric, verified_classes int, rate_per_30min numeric, gross_pay numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  with v as (
    select coalesce(sum(c.duration_minutes / 30.0), 0) as atoms,
           count(*)::int as cnt
    from public.classes c
    where c.teacher_id = p_teacher
      and c.status = 'verified'
      and c.scheduled_start >= p_from and c.scheduled_start < (p_to + 1)
  ),
  r as (select p.rate_per_30min as rate from public.profiles p where p.id = p_teacher)
  select v.atoms, v.cnt, r.rate, round(v.atoms * r.rate, 2)
  from v cross join r;
end $$;
grant execute on function public.teacher_pay(uuid, date, date) to authenticated;

-- --- teacher_pay_all: one row per active teacher (table + totals) ------------
create or replace function public.teacher_pay_all(p_from date, p_to date)
returns table (
  teacher_id uuid, teacher_name text,
  verified_atoms numeric, verified_classes int, rate_per_30min numeric, gross_pay numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  select p.id, p.name,
         coalesce(v.atoms, 0),
         coalesce(v.cnt, 0),
         p.rate_per_30min,
         round(coalesce(v.atoms, 0) * p.rate_per_30min, 2)
  from public.profiles p
  left join lateral (
    select coalesce(sum(c.duration_minutes / 30.0), 0) as atoms, count(*)::int as cnt
    from public.classes c
    where c.teacher_id = p.id
      and c.status = 'verified'
      and c.scheduled_start >= p_from and c.scheduled_start < (p_to + 1)
  ) v on true
  where p.role = 'teacher' and p.active
  order by p.name;
end $$;
grant execute on function public.teacher_pay_all(date, date) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
