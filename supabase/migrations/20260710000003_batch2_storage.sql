-- =============================================================================
-- Batch 2 — 3/3 STORAGE
-- Private bucket "session-evidence" for opening/closing screenshots + optional
-- recording. Object path is `{class_id}/<file>`, so ownership is derived from
-- the first path segment. No public read.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('session-evidence', 'session-evidence', false)
on conflict (id) do nothing;

-- A teacher may upload only under a class they own.
create policy "evidence_teacher_insert_own_class"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'session-evidence'
    and exists (
      select 1 from public.classes c
      where c.id = ((storage.foldername(name))[1])::uuid
        and c.teacher_id = auth.uid()
    )
  );

-- A teacher may read evidence for their own classes.
create policy "evidence_teacher_read_own_class"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'session-evidence'
    and exists (
      select 1 from public.classes c
      where c.id = ((storage.foldername(name))[1])::uuid
        and c.teacher_id = auth.uid()
    )
  );

-- Admins may read all evidence (for the verify queue).
create policy "evidence_admin_read_all"
  on storage.objects for select to authenticated
  using (bucket_id = 'session-evidence' and public.is_admin());
