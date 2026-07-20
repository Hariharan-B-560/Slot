-- =============================================================================
-- Grant service_role full access to the public schema (the standard Supabase
-- default that this local project was missing — 0005 granted only to
-- `authenticated`). service_role is server-only and already bypasses RLS by
-- design; without these grants it hit "permission denied for table ...".
-- Used by the admin-gated availability writes in the grid (an admin editing
-- another teacher's availability_blocks).
-- =============================================================================

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
