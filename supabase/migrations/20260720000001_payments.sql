-- =============================================================================
-- Payment ledger — case-by-case bookkeeping. No price list, no methods, no
-- gateway. `paid` and `remaining` are NEVER stored: they are always computed
-- from payments rows (same append-only discipline as the class ledger). An
-- unpaid balance only WARNS — it never blocks generation/delivery/verification.
--
-- Admin-only throughout: teachers get no read or write on payments (rule 10).
-- Both roles are the `authenticated` DB role, so admin-vs-teacher separation
-- runs through public.is_admin(auth.uid()).
-- =============================================================================

-- --- enrolments: an admin-set, case-by-case total fee (nullable) -------------
alter table public.enrolments add column total_fee numeric;

comment on column public.enrolments.total_fee is
  'Admin-set total fee for the enrolment (no price list). NULL = unknown. '
  '"paid"/"remaining" are never stored — computed from payments via '
  'enrolment_payment_status().';

-- --- payments (append-only ledger) -------------------------------------------
create table public.payments (
  id            uuid primary key default extensions.gen_random_uuid(),
  enrolment_id  uuid not null references public.enrolments (id),
  amount        numeric not null check (amount <> 0),  -- + received, − refund/adjustment
  paid_at       timestamptz not null,                  -- admin-set: when money moved
  recorded_by   uuid not null references public.profiles (id),
  recorded_at   timestamptz not null default now(),
  note          text
);
create index payments_enrolment on public.payments (enrolment_id);

alter table public.payments enable row level security;
grant select, insert on public.payments to authenticated;  -- no update/delete grant

-- Admin only — teachers get NOTHING (no policy → 0 rows on select, 42501 on insert).
create policy payments_admin_select on public.payments
  for select to authenticated using (public.is_admin() and public.can_act());
create policy payments_admin_insert on public.payments
  for insert to authenticated with check (public.is_admin() and public.can_act());

-- --- enrolment_fee_history (append-only audit of total_fee changes) ----------
create table public.enrolment_fee_history (
  id            uuid primary key default extensions.gen_random_uuid(),
  enrolment_id  uuid not null references public.enrolments (id),
  previous_fee  numeric,
  new_fee       numeric,
  changed_by    uuid references public.profiles (id),
  changed_at    timestamptz not null default now(),
  reason        text
);
create index enrolment_fee_history_enrolment on public.enrolment_fee_history (enrolment_id);

alter table public.enrolment_fee_history enable row level security;
grant select on public.enrolment_fee_history to authenticated;  -- no insert grant: trigger writes it

create policy fee_history_admin_select on public.enrolment_fee_history
  for select to authenticated using (public.is_admin() and public.can_act());

-- --- append-only: block UPDATE/DELETE on both ledgers, for every role --------
create or replace function public.payments_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'the payment ledger is append-only — record a correction as a new (negative) row'
    using errcode = 'restrict_violation';
end;
$$;
create trigger payments_no_update before update on public.payments
  for each row execute function public.payments_block_mutation();
create trigger payments_no_delete before delete on public.payments
  for each row execute function public.payments_block_mutation();

create or replace function public.fee_history_block_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'enrolment_fee_history is append-only' using errcode = 'restrict_violation';
end;
$$;
create trigger fee_history_no_update before update on public.enrolment_fee_history
  for each row execute function public.fee_history_block_mutation();
create trigger fee_history_no_delete before delete on public.enrolment_fee_history
  for each row execute function public.fee_history_block_mutation();

-- --- log every total_fee change ----------------------------------------------
-- SECURITY DEFINER so the trigger can write the no-direct-insert history table.
-- The reason (optional) rides in on a session GUC, set by the admin action.
create or replace function public.enrolments_log_fee_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.enrolment_fee_history (enrolment_id, previous_fee, new_fee, changed_by, reason)
  values (new.id, old.total_fee, new.total_fee, auth.uid(),
          nullif(current_setting('app.fee_change_reason', true), ''));
  return new;
end;
$$;
create trigger enrolments_fee_change
  after update on public.enrolments
  for each row
  when (old.total_fee is distinct from new.total_fee)
  execute function public.enrolments_log_fee_change();

-- --- derived reader: the ONLY way paid/remaining are exposed ------------------
-- SECURITY DEFINER (sums payments across RLS) but guarded so non-admins get
-- zero rows — teachers never see payment figures. p_enrolment null → all.
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
  if not public.is_admin(auth.uid()) then
    return;  -- no rows for non-admins
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

-- --- set_enrolment_fee: change total_fee + carry the reason to the trigger ----
-- The fee reason must ride a session GUC that the trigger reads IN THE SAME
-- transaction, so the change goes through one admin-gated function (a plain
-- app UPDATE + a separate set_config call would land on different connections).
create or replace function public.set_enrolment_fee(
  p_enrolment uuid, p_fee numeric, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only an admin can change a fee' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.fee_change_reason', coalesce(p_reason, ''), true);
  update public.enrolments set total_fee = p_fee where id = p_enrolment;
  perform set_config('app.fee_change_reason', '', true);
end;
$$;
revoke all on function public.set_enrolment_fee(uuid, numeric, text) from public;
grant execute on function public.set_enrolment_fee(uuid, numeric, text) to authenticated;

-- service_role (server-only, bypasses RLS) grants on the new objects.
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
