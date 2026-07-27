-- =============================================================================
-- Counsellor access — READ ONLY. Additive: no existing policy or trigger is
-- touched. A counsellor may SELECT availability, students, and slot bookings
-- (enrolments); they get NO insert/update/delete anywhere — the absence of a
-- write policy is the denial (same idiom as conversion_events' missing DELETE).
--
-- Note on the shared DB role: admin/teacher/counsellor are all the `authenticated`
-- Postgres role, separated only by these policies. Column-level GRANTs therefore
-- cannot isolate counsellors, so column scoping (where wanted) is done with views.
-- Per the product decision, counsellors see students in full and bookings in full
-- (including total_fee), so no view is needed here — plain SELECT policies suffice.
-- =============================================================================

-- Mirror of is_admin/is_teacher for the new role.
create or replace function public.is_counsellor(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.profiles where id = uid and role = 'counsellor') $$;

-- --- availability_blocks: read-only (teacher windows; nothing sensitive) ------
create policy availability_counsellor_read on public.availability_blocks
  for select to authenticated
  using (public.is_counsellor() and public.can_act());

-- --- availability_overrides: read-only so the grid renders closed/open days ---
create policy overrides_counsellor_read on public.availability_overrides
  for select to authenticated
  using (public.is_counsellor() and public.can_act());

-- --- students: read-only. Explicit counsellor policy (also covered by the
-- existing students_select(true)); recorded here so the grant is greppable and
-- intentional. Product decision: all student columns are counsellor-safe.
create policy students_counsellor_read on public.students
  for select to authenticated
  using (public.is_counsellor() and public.can_act());

-- --- enrolments (slot bookings): read-only. "Who booked which slot", incl. fee
-- per the product decision. No write policy → counsellors cannot mutate bookings.
create policy enrolments_counsellor_read on public.enrolments
  for select to authenticated
  using (public.is_counsellor() and public.can_act());

-- service_role (server-only, bypasses RLS) grants for the new function.
grant execute on all functions in schema public to service_role;
