-- =============================================================================
-- 0003 — Helper functions
-- Role lookups used by triggers (0004) and RLS policies (0005). SECURITY DEFINER
-- so they read public.profiles without tripping that table's own RLS, and so a
-- role check can't be recursively re-evaluated during policy checks.
-- =============================================================================

-- Grace window (minutes) for RULE 1 — how far outside the scheduled window a
-- teacher may still mark a class delivered. Not specified in decision-v1.md;
-- 15 minutes chosen as the v1 default. Change here to adjust globally.
create or replace function public.delivery_grace()
returns interval
language sql immutable
as $$ select interval '15 minutes' $$;

-- Role of an arbitrary profile id.
create or replace function public.role_of(uid uuid)
returns public.user_role
language sql stable security definer
set search_path = public
as $$ select role from public.profiles where id = uid $$;

-- Is the given id (defaults to the current JWT user) an admin?
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = uid and role = 'admin') $$;

-- Is the given id (defaults to the current JWT user) a teacher?
create or replace function public.is_teacher(uid uuid default auth.uid())
returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = uid and role = 'teacher') $$;
