-- =============================================================================
-- Real auth — 3/3: RLS rewrite
-- Every DATA policy now requires can_act() (active + not pending a password
-- change) IN ADDITION to its existing identity check. Two carve-outs on
-- profiles let a forced/inactive user still read their own row and clear their
-- own password flag (guarded by the 0002 trigger). Also: admin can now write
-- availability (kills the service-role bypass), profiles_select is tightened to
-- own-row-or-admin, and app_config comes under RLS.
-- =============================================================================

-- ---------------------------------------------------------------- profiles ---
drop policy if exists profiles_select      on public.profiles;
drop policy if exists profiles_admin_write on public.profiles;

-- Carve-out: read your OWN row even while forced/inactive (needed to redirect).
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.is_admin() and public.can_act());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());

-- Carve-out: update your OWN row (the 0002 trigger limits a non-admin to
-- flipping must_change_password true -> false). NOT gated by can_act so a forced
-- user can escape.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ------------------------------------------------------ availability_blocks ---
drop policy if exists availability_teacher_all  on public.availability_blocks;
drop policy if exists availability_admin_read   on public.availability_blocks;

create policy availability_teacher_all on public.availability_blocks
  for all to authenticated
  using (teacher_id = auth.uid() and public.can_act())
  with check (teacher_id = auth.uid() and public.can_act());

-- NEW: admins may write any teacher's availability through RLS (no more
-- service-role bypass).
create policy availability_admin_write on public.availability_blocks
  for all to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());

-- ----------------------------------------------------------------- classes ---
drop policy if exists classes_teacher_select on public.classes;
drop policy if exists classes_admin_select   on public.classes;
drop policy if exists classes_teacher_insert on public.classes;
drop policy if exists classes_admin_insert   on public.classes;
drop policy if exists classes_teacher_update on public.classes;
drop policy if exists classes_admin_update   on public.classes;

create policy classes_teacher_select on public.classes
  for select to authenticated using (teacher_id = auth.uid() and public.can_act());
create policy classes_admin_select on public.classes
  for select to authenticated using (public.is_admin() and public.can_act());
create policy classes_teacher_insert on public.classes
  for insert to authenticated with check (teacher_id = auth.uid() and public.can_act());
create policy classes_admin_insert on public.classes
  for insert to authenticated with check (public.is_admin() and public.can_act());
create policy classes_teacher_update on public.classes
  for update to authenticated
  using (teacher_id = auth.uid() and public.can_act())
  with check (teacher_id = auth.uid() and public.can_act());
create policy classes_admin_update on public.classes
  for update to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());

-- ------------------------------------------------------- conversion_events ---
drop policy if exists conversion_admin_select on public.conversion_events;
drop policy if exists conversion_admin_insert on public.conversion_events;
drop policy if exists conversion_admin_update on public.conversion_events;

create policy conversion_admin_select on public.conversion_events
  for select to authenticated using (public.is_admin() and public.can_act());
create policy conversion_admin_insert on public.conversion_events
  for insert to authenticated with check (public.is_admin() and public.can_act());
create policy conversion_admin_update on public.conversion_events
  for update to authenticated using (public.is_admin() and public.can_act());

-- -------------------------------------------------------------- enrolments ---
drop policy if exists enrolments_admin_write  on public.enrolments;
drop policy if exists enrolments_teacher_read on public.enrolments;

create policy enrolments_admin_write on public.enrolments
  for all to authenticated
  using (public.is_admin() and public.can_act())
  with check (public.is_admin() and public.can_act());
create policy enrolments_teacher_read on public.enrolments
  for select to authenticated using (teacher_id = auth.uid() and public.can_act());

-- ---------------------------------------------------------- session_reports ---
drop policy if exists session_reports_admin_insert   on public.session_reports;
drop policy if exists session_reports_teacher_insert on public.session_reports;
drop policy if exists session_reports_admin_select   on public.session_reports;
drop policy if exists session_reports_teacher_select on public.session_reports;

create policy session_reports_admin_insert on public.session_reports
  for insert to authenticated with check (public.is_admin() and public.can_act());
create policy session_reports_teacher_insert on public.session_reports
  for insert to authenticated
  with check (
    public.can_act()
    and created_by = auth.uid()
    and exists (select 1 from public.classes c where c.id = class_id and c.teacher_id = auth.uid())
  );
create policy session_reports_admin_select on public.session_reports
  for select to authenticated using (public.is_admin() and public.can_act());
create policy session_reports_teacher_select on public.session_reports
  for select to authenticated
  using (
    public.can_act()
    and exists (select 1 from public.classes c where c.id = session_reports.class_id and c.teacher_id = auth.uid())
  );

-- -------------------------------------------------- storage: session-evidence ---
drop policy if exists evidence_teacher_insert_own_class on storage.objects;
drop policy if exists evidence_teacher_read_own_class   on storage.objects;
drop policy if exists evidence_admin_read_all           on storage.objects;

create policy evidence_teacher_insert_own_class on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'session-evidence' and public.can_act()
    and exists (select 1 from public.classes c
                where c.id = ((storage.foldername(name))[1])::uuid and c.teacher_id = auth.uid())
  );
create policy evidence_teacher_read_own_class on storage.objects
  for select to authenticated
  using (
    bucket_id = 'session-evidence' and public.can_act()
    and exists (select 1 from public.classes c
                where c.id = ((storage.foldername(name))[1])::uuid and c.teacher_id = auth.uid())
  );
create policy evidence_admin_read_all on storage.objects
  for select to authenticated
  using (bucket_id = 'session-evidence' and public.is_admin() and public.can_act());

-- ---------------------------------------------------------------- app_config ---
-- The one table not previously under RLS. Non-sensitive (session length) and
-- functions need to read it, so a simple authenticated read policy.
alter table public.app_config enable row level security;
create policy app_config_read on public.app_config
  for select to authenticated using (true);
