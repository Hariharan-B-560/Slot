-- =============================================================================
-- Real auth — 1/3: forced password change
-- When an admin creates an account they set a temporary password, so the admin
-- KNOWS it — which would let them act AS that teacher and make rule 5 (no
-- self-verify) meaningless. must_change_password forces the teacher to set their
-- own before they can do anything. Default true, so every admin-created account
-- is forced; existing seeded accounts are backfilled to false.
-- =============================================================================

alter table public.profiles
  add column must_change_password boolean not null default true;

-- Accounts that already exist (seed) are not forced.
update public.profiles set must_change_password = false;
