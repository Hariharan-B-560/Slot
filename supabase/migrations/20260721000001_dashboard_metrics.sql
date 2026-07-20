-- =============================================================================
-- Admin dashboard + integrity metrics.
--
-- Every function here is SECURITY DEFINER (it aggregates across teachers) and
-- GUARDED by is_admin(auth.uid()) — a teacher calling any of them gets zero
-- rows. Admin-only is enforced here AND at the route layer; never by hiding nav.
--
-- "Delivered" means EVER-DELIVERED: status in ('delivered','verified','flagged').
-- class_status is mutually exclusive, so a verified class is no longer
-- 'delivered'. Counting only 'delivered' would make verifying a class DECREASE
-- the delivered count and cancel out the delivered−verified gap — the very
-- signal the integrity page exists to surface.
--
-- Closed days (Sundays, unopened Saturdays) are already excluded from
-- utilisation denominators by open_days_count() — see 20260719000001.
-- =============================================================================

-- Ever-delivered predicate, in one place.
create or replace function public.is_delivered_status(s public.class_status)
returns boolean language sql immutable
as $$ select s in ('delivered', 'verified', 'flagged') $$;

-- --- 1. headline numbers -----------------------------------------------------
create or replace function public.dashboard_headline(p_start date, p_end date)
returns table (utilisation numeric, delivered int, verified int, active_students int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  with cap as (  -- available hours across active teachers, closed days excluded
    select coalesce(sum(
      coalesce((select sum(extract(epoch from (b.end_time - b.start_time)) / 3600.0)
                from public.availability_blocks b where b.teacher_id = p.id and b.active), 0)
      * public.open_days_count(p.id, p_start, p_end)
    ), 0) as hours
    from public.profiles p where p.role = 'teacher' and p.active
  ),
  k as (
    select
      coalesce(sum(extract(epoch from (k.scheduled_end - k.scheduled_start)) / 3600.0)
               filter (where k.status = 'verified' and k.slot_type = 'ENROLLED'), 0) as verified_hours,
      count(*) filter (where public.is_delivered_status(k.status))::int as delivered_cnt,
      count(*) filter (where k.status = 'verified')::int                as verified_cnt
    from public.classes k
    where k.scheduled_start >= p_start and k.scheduled_start < (p_end + 1)
  ),
  s as (
    select count(distinct e.student_id)::int as cnt
    from public.enrolments e
    where e.status = 'active'
      and e.start_date <= p_end
      and (e.end_date is null or e.end_date >= p_start)
  )
  select
    case when (select hours from cap) > 0
         then round((select verified_hours from k) / (select hours from cap), 3)
         else 0 end,
    (select delivered_cnt from k),
    (select verified_cnt from k),
    (select cnt from s);
end;
$$;

-- --- 2. renewal window (≤3 sessions left) ------------------------------------
-- Sessions left counts legacy + in-app deliveries together (legacy-migration batch).
create or replace function public.dashboard_renewals()
returns table (student_id uuid, student text, teacher text, sessions_left int, phone text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  select e.student_id, st.name, p.name,
         (e.total_sessions - (coalesce(e.sessions_already_delivered, 0) + coalesce(d.cnt, 0)))::int,
         st.phone
  from public.enrolments e
  join public.students st on st.id = e.student_id
  join public.profiles p on p.id = e.teacher_id
  left join lateral (
    select count(*)::int as cnt from public.classes c
    where c.enrolment_id = e.id and public.is_delivered_status(c.status)
  ) d on true
  where e.status = 'active'
    and e.total_sessions is not null
    and (e.total_sessions - (coalesce(e.sessions_already_delivered, 0) + coalesce(d.cnt, 0))) <= 3
  order by 4 asc;
end;
$$;

-- --- 3. attendance risk (no delivered class in the last 7 days) --------------
create or replace function public.dashboard_attendance_risk()
returns table (student_id uuid, student text, teacher text, last_class_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  select e.student_id, st.name, p.name, d.last_at
  from public.enrolments e
  join public.students st on st.id = e.student_id
  join public.profiles p on p.id = e.teacher_id
  left join lateral (
    select max(c.scheduled_start) as last_at from public.classes c
    where c.enrolment_id = e.id and public.is_delivered_status(c.status)
  ) d on true
  where e.status = 'active'
    and (d.last_at is null or d.last_at < now() - interval '7 days')
  order by d.last_at asc nulls first;
end;
$$;

-- --- 4. verify backlog (delivered >48h ago, still unverified) ----------------
create or replace function public.dashboard_verify_backlog()
returns table (cnt int, oldest timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  select count(*)::int, min(c.delivered_at)
  from public.classes c
  where c.status = 'delivered' and c.delivered_at < now() - interval '48 hours';
end;
$$;

-- --- 5. integrity per teacher ------------------------------------------------
create or replace function public.integrity_by_teacher(p_start date, p_end date)
returns table (
  teacher_id uuid, teacher text, utilisation numeric,
  delivered int, verified int, gap int, gap_pct numeric,
  flagged int, concerning boolean
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  with per as (
    select p.id, p.name,
      coalesce((select sum(extract(epoch from (b.end_time - b.start_time)) / 3600.0)
                from public.availability_blocks b where b.teacher_id = p.id and b.active), 0)
        * public.open_days_count(p.id, p_start, p_end) as cap_hours,
      coalesce((select sum(extract(epoch from (c.scheduled_end - c.scheduled_start)) / 3600.0)
                from public.classes c
                where c.teacher_id = p.id and c.status = 'verified' and c.slot_type = 'ENROLLED'
                  and c.scheduled_start >= p_start and c.scheduled_start < (p_end + 1)), 0) as ver_hours,
      (select count(*)::int from public.classes c
        where c.teacher_id = p.id and public.is_delivered_status(c.status)
          and c.scheduled_start >= p_start and c.scheduled_start < (p_end + 1)) as del,
      (select count(*)::int from public.classes c
        where c.teacher_id = p.id and c.status = 'verified'
          and c.scheduled_start >= p_start and c.scheduled_start < (p_end + 1)) as ver,
      (select count(*)::int from public.classes c
        where c.teacher_id = p.id and c.status = 'flagged'
          and c.scheduled_start >= p_start and c.scheduled_start < (p_end + 1)) as flg
    from public.profiles p
    where p.role = 'teacher' and p.active
  )
  select per.id, per.name,
         case when per.cap_hours > 0 then round(per.ver_hours / per.cap_hours, 3) else 0 end,
         per.del, per.ver, (per.del - per.ver),
         case when per.del > 0 then round(((per.del - per.ver)::numeric / per.del) * 100, 1) else 0 end,
         per.flg,
         (case when per.del > 0 then ((per.del - per.ver)::numeric / per.del) * 100 else 0 end >= 20
          or per.flg >= 3)
  from per
  order by (case when per.del > 0 then ((per.del - per.ver)::numeric / per.del) * 100 else 0 end) desc,
           per.name;
end;
$$;

-- --- 6. integrity summary (dashboard strip + nav dot) ------------------------
create or replace function public.integrity_summary(p_start date, p_end date)
returns table (concerning_teachers int, flagged_classes int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  select
    (select count(*)::int from public.integrity_by_teacher(p_start, p_end) t where t.concerning),
    (select count(*)::int from public.classes c
      where c.status = 'flagged'
        and c.scheduled_start >= p_start and c.scheduled_start < (p_end + 1));
end;
$$;

-- --- 7. money ----------------------------------------------------------------
create or replace function public.dashboard_money(p_start date, p_end date)
returns table (received numeric, outstanding numeric, arrears int)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  with bal as (  -- remaining per ACTIVE enrolment, NULL fees excluded
    select e.id,
           e.total_fee - coalesce((select sum(p.amount) from public.payments p where p.enrolment_id = e.id), 0) as rem,
           e.start_date
    from public.enrolments e
    where e.status = 'active' and e.total_fee is not null
  )
  select
    coalesce((select sum(p.amount) from public.payments p
               where p.paid_at >= p_start and p.paid_at < (p_end + 1)), 0),
    coalesce((select sum(bal.rem) from bal), 0),
    (select count(*)::int from bal
      where bal.rem > 0 and bal.start_date < current_date - 30);
end;
$$;

grant execute on function public.dashboard_headline(date, date)      to authenticated;
grant execute on function public.dashboard_renewals()                to authenticated;
grant execute on function public.dashboard_attendance_risk()         to authenticated;
grant execute on function public.dashboard_verify_backlog()          to authenticated;
grant execute on function public.integrity_by_teacher(date, date)    to authenticated;
grant execute on function public.integrity_summary(date, date)       to authenticated;
grant execute on function public.dashboard_money(date, date)         to authenticated;
grant execute on function public.is_delivered_status(public.class_status) to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
