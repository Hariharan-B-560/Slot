-- =============================================================================
-- Delivered-vs-verified trend for the dashboard chart.
--
-- Buckets adaptively so the x-axis stays readable: daily for ranges up to ~5
-- weeks, weekly beyond that. Same admin guard as every other dashboard metric —
-- a teacher calling this gets zero rows.
--
-- "Delivered" is EVER-DELIVERED (is_delivered_status), consistent with the rest
-- of the dashboard: a verified class was still delivered.
-- =============================================================================

create or replace function public.dashboard_trend(p_start date, p_end date)
returns table (bucket date, delivered int, verified int)
language plpgsql stable security definer set search_path = public
as $$
declare
  span int := (p_end - p_start) + 1;
  step interval := case when span > 35 then interval '1 week' else interval '1 day' end;
begin
  if not public.is_admin(auth.uid()) then return; end if;

  return query
  with buckets as (
    select b::date as bucket, (b + step)::date as next_b
    from generate_series(
      case when step = interval '1 week' then date_trunc('week', p_start::timestamp) else p_start::timestamp end,
      p_end::timestamp,
      step
    ) b
  )
  select bk.bucket,
         (select count(*)::int from public.classes c
           where public.is_delivered_status(c.status)
             and c.scheduled_start >= bk.bucket and c.scheduled_start < bk.next_b),
         (select count(*)::int from public.classes c
           where c.status = 'verified'
             and c.scheduled_start >= bk.bucket and c.scheduled_start < bk.next_b)
  from buckets bk
  order by bk.bucket;
end;
$$;

grant execute on function public.dashboard_trend(date, date) to authenticated;
grant execute on all functions in schema public to service_role;
