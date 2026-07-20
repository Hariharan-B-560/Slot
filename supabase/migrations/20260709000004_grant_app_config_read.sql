-- =============================================================================
-- Grant read access to app_config for the authenticated role.
-- app_config was created in Phase 1.5, AFTER the blanket grant in 0005, so
-- authenticated never received SELECT on it. session_slots() and the
-- availability-length trigger read app_config as the CALLER's role, so without
-- this grant every availability read/write from the app failed with
-- "permission denied for table app_config". Read-only: config stays admin-set
-- via SQL/seed (no insert/update/delete grant).
-- =============================================================================

grant select on public.app_config to authenticated;
