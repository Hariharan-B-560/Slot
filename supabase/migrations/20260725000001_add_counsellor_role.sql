-- =============================================================================
-- Add the `counsellor` role (read-only viewer of availability, students, and
-- slot bookings). Additive to the admin/teacher enum from 0001.
--
-- Postgres forbids USING a newly-added enum value in the same transaction that
-- adds it, so this migration ONLY adds the value. The helper + RLS policies that
-- reference 'counsellor' live in the next migration (a separate transaction).
-- =============================================================================

alter type public.user_role add value if not exists 'counsellor';
