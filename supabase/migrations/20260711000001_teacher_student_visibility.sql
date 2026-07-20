-- =============================================================================
-- Teacher student visibility
-- A teacher may see only students assigned to them — via an enrolment or a
-- (demo or enrolled) class with that teacher. Admins still see all. Replaces the
-- previous "any authenticated user sees all students" select policy. Payments/
-- conversion remain admin-only (rule 4) — unchanged.
-- =============================================================================

-- SECURITY DEFINER so the policy check doesn't recurse through RLS on
-- enrolments/classes.
create or replace function public.teaches_student(p_student uuid, p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.enrolments e
                 where e.teacher_id = p_uid and e.student_id = p_student)
      or exists (select 1 from public.classes c
                 where c.teacher_id = p_uid and c.student_id = p_student);
$$;

-- Replace the permissive select policy with a scoped one.
drop policy if exists students_select on public.students;

create policy students_select on public.students
  for select to authenticated
  using (public.is_admin() or public.teaches_student(id));
