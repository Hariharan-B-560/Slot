-- =============================================================================
-- Batch 2 — 2/3 TRIGGERS
-- Evidence can't be filed early or backfilled: a session_reports row's
-- created_at must fall inside the linked class's delivery window
-- [scheduled_start, scheduled_end + grace]. Pairs with rule 8 (no delivery
-- without a report) to make the report the anti-fraud spine of delivery.
-- =============================================================================

create or replace function public.session_report_in_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cs timestamptz;
  ce timestamptz;
begin
  -- The report is stamped server-side; a teacher can't supply a fake time.
  new.created_at := now();

  select scheduled_start, scheduled_end into cs, ce
  from public.classes where id = new.class_id;
  if cs is null then
    raise exception 'session report references an unknown class'
      using errcode = 'foreign_key_violation';
  end if;

  if now() < cs or now() > ce + public.delivery_grace() then
    raise exception
      'RULE 8b evidence-window: a session report can only be filed within the class window [%, % + grace %]',
      cs, ce, public.delivery_grace()
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger session_report_in_window
  before insert on public.session_reports
  for each row execute function public.session_report_in_window();
