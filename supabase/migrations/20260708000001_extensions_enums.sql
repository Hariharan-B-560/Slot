-- =============================================================================
-- 0001 — Extensions + enums
-- The Easy English / Slot booking — Phase 1 enforcement layer.
-- See decision-v1.md §Data model and §Anti-fraud rules.
-- =============================================================================

-- gen_random_uuid() for primary keys.
create extension if not exists pgcrypto with schema extensions;

-- pgTAP powers supabase/tests/anti_fraud.sql (the six acceptance tests).
create extension if not exists pgtap with schema extensions;

-- --- Enums -------------------------------------------------------------------
-- Roles in v1 are admin and teacher only. Students are data records, not users.
create type public.user_role as enum ('admin', 'teacher');

-- Student lifecycle (data records; reserved for future student login).
create type public.student_status as enum ('lead', 'demo_scheduled', 'enrolled', 'dropped');

-- The objective conversion gate.
create type public.conversion_type as enum ('payment', 'admin_signoff');

-- Two slot types, one engine.
create type public.slot_type as enum ('DEMO', 'ENROLLED');

-- Class-instance state machine (decision-v1.md §Class-instance state machine).
create type public.class_status as enum ('published', 'delivered', 'verified', 'missed', 'flagged');

-- Who/what verified. 'admin' is the only live source in v1; join_log/student
-- are reserved so future auto-verify slots in with no migration.
create type public.verify_source as enum ('admin', 'join_log', 'student');
