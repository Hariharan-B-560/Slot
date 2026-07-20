-- =============================================================================
-- Real auth — 2/3: can_act() + self-update guard
-- can_act() is the single gate ANDed into every data policy: a caller may act
-- only if their profile exists, is active, and is NOT pending a password change.
-- The anon key is public, so a holder of a valid JWT can call PostgREST
-- directly — middleware alone cannot make "cannot act" true. This can.
-- =============================================================================

create or replace function public.can_act(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid
      and p.active
      and p.must_change_password = false
  );
$$;

-- --- Self-update guard -------------------------------------------------------
-- A carve-out policy (0003) lets a user UPDATE their own profile row so a
-- forced user can clear must_change_password. Without a guard that policy would
-- be privilege escalation (set your own role to admin). This trigger restricts a
-- NON-admin self-update to flipping ONLY must_change_password, and only
-- true -> false. Everything else on their own row is immutable to them.
create or replace function public.profiles_self_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Admins (and service_role, which has auth.uid() = null) are unrestricted here.
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;

  -- A non-admin may only touch their OWN row (RLS already enforces this) and may
  -- change nothing except must_change_password, one-way true -> false.
  if new.id            is distinct from old.id
     or new.role       is distinct from old.role
     or new.name       is distinct from old.name
     or new.email      is distinct from old.email
     or new.active     is distinct from old.active
     or new.created_at is distinct from old.created_at then
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

create trigger profiles_self_update_guard
  before update on public.profiles
  for each row execute function public.profiles_self_update_guard();
