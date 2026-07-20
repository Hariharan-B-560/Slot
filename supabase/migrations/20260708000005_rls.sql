-- =============================================================================
-- 0005 — Row Level Security
-- RULE 6 (row ownership) is pure RLS. RULES 3, 4, 5 are also fenced here as a
-- second layer on top of their triggers (defense in depth). service_role /
-- pg_cron bypass RLS and are governed by the triggers in 0004 instead.
-- =============================================================================

-- Base privileges. RLS still gates every row; these just make the tables
-- reachable by the authenticated role.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

alter table public.profiles            enable row level security;
alter table public.students            enable row level security;
alter table public.availability_blocks enable row level security;
alter table public.conversion_events   enable row level security;
alter table public.enrolments          enable row level security;
alter table public.classes             enable row level security;

-- --- profiles ----------------------------------------------------------------
-- Roles/names are needed to resolve teachers; readable by any authenticated
-- user. Only admins may write.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_admin_write on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --- students ----------------------------------------------------------------
-- Readable by authenticated users (a teacher must see who a class is for).
-- Only admins may write. (Students are data records, never login users.)
create policy students_select on public.students
  for select to authenticated using (true);
create policy students_admin_write on public.students
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --- availability_blocks ------------------------------------------------------
-- A teacher owns their own availability; admins may read everything.
create policy availability_teacher_all on public.availability_blocks
  for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
create policy availability_admin_read on public.availability_blocks
  for select to authenticated using (public.is_admin());

-- --- conversion_events --------------------------------------------------------
-- RULE 4 — teachers have NO INSERT. Admin-only for every operation; no DELETE.
create policy conversion_admin_select on public.conversion_events
  for select to authenticated using (public.is_admin());
create policy conversion_admin_insert on public.conversion_events
  for insert to authenticated with check (public.is_admin());
create policy conversion_admin_update on public.conversion_events
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- (no DELETE policy → deletes denied for authenticated)

-- --- enrolments ---------------------------------------------------------------
-- Admins create/manage enrolments (post-conversion). Teachers read their own.
create policy enrolments_admin_write on public.enrolments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy enrolments_teacher_read on public.enrolments
  for select to authenticated using (teacher_id = auth.uid());

-- --- classes (RULE 6 — row ownership) ----------------------------------------
-- A teacher can read/insert/update ONLY their own rows. Admins see and manage
-- all. No DELETE policy for anyone (RULE 3; the trigger also blocks deletes).
create policy classes_teacher_select on public.classes
  for select to authenticated using (teacher_id = auth.uid());
create policy classes_admin_select on public.classes
  for select to authenticated using (public.is_admin());

create policy classes_teacher_insert on public.classes
  for insert to authenticated with check (teacher_id = auth.uid());
create policy classes_admin_insert on public.classes
  for insert to authenticated with check (public.is_admin());

create policy classes_teacher_update on public.classes
  for update to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
create policy classes_admin_update on public.classes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
