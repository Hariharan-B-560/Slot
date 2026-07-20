-- =============================================================================
-- Phase 1.5 — 3/3 RLS
-- session_reports: a teacher writes/reads reports for their OWN classes; the
-- admin reads all. INSERT + SELECT only — it is an operational log, so no
-- UPDATE/DELETE is granted (append-style, like the classes ledger).
-- =============================================================================

-- 0005's blanket grant ran before this table existed, so grant explicitly.
grant select, insert on public.session_reports to authenticated;

alter table public.session_reports enable row level security;

create policy session_reports_teacher_select on public.session_reports
  for select to authenticated
  using (exists (
    select 1 from public.classes c
    where c.id = session_reports.class_id and c.teacher_id = auth.uid()
  ));

create policy session_reports_admin_select on public.session_reports
  for select to authenticated
  using (public.is_admin());

create policy session_reports_teacher_insert on public.session_reports
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.classes c
      where c.id = session_reports.class_id and c.teacher_id = auth.uid()
    )
  );

create policy session_reports_admin_insert on public.session_reports
  for insert to authenticated
  with check (public.is_admin());
