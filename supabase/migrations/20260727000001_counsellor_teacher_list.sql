-- =============================================================================
-- Counsellor teacher directory.
--
-- profiles_select was tightened (0714) to own-row-or-admin, so a counsellor
-- can't read teacher rows directly — and we don't want to expose the whole
-- profiles row to them anyway (it carries rate_per_30min + email). This returns
-- ONLY the id + name of active teachers, and only to a counsellor, so the
-- read-only availability grid has its teacher list without leaking pay/email.
-- =============================================================================

create or replace function public.counsellor_teacher_list()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_counsellor() and public.can_act()) then
    return;                                   -- non-counsellors get nothing
  end if;

  return query
  select p.id, p.name
  from public.profiles p
  where p.role = 'teacher' and p.active
  order by p.name;
end;
$$;

grant execute on function public.counsellor_teacher_list() to authenticated;
grant execute on all functions in schema public to service_role;
