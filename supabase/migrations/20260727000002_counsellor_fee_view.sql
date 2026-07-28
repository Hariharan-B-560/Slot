-- =============================================================================
-- Let counsellors see fee details.
--
-- enrolment_payment_status is the ONLY reader that exposes paid/remaining. It was
-- admin-only; per the product decision counsellors may view fee details too, so
-- widen the guard to admin OR counsellor. (Teachers still get zero rows.)
-- Everything else about the function is unchanged.
-- =============================================================================

create or replace function public.enrolment_payment_status(p_enrolment uuid default null)
returns table (
  enrolment_id   uuid,
  total_fee      numeric,
  paid           numeric,
  remaining      numeric,
  last_payment_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_admin(auth.uid()) or public.is_counsellor(auth.uid())) then
    return;  -- teachers still see no payment figures
  end if;

  return query
    select e.id,
           e.total_fee,
           coalesce(sum(p.amount), 0) as paid,
           case when e.total_fee is null then null
                else e.total_fee - coalesce(sum(p.amount), 0) end as remaining,
           max(p.paid_at) as last_payment_at
    from public.enrolments e
    left join public.payments p on p.enrolment_id = e.id
    where p_enrolment is null or e.id = p_enrolment
    group by e.id, e.total_fee;
end;
$$;
grant execute on function public.enrolment_payment_status(uuid) to authenticated;
