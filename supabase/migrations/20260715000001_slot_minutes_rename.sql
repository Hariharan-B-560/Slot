-- =============================================================================
-- Mixed durations — 1/3: rename session_minutes -> slot_minutes
-- The value is the ATOM granularity (the 30-min grid unit), NOT the session
-- length. Session length now lives on the enrolment (duration_minutes).
-- generate_classes and available_slots are rewritten in migration 3; here we
-- only rename the column and refresh the trigger that reads it.
-- =============================================================================

alter table public.app_config rename column session_minutes to slot_minutes;

-- Availability block length must be a whole multiple of the atom.
create or replace function public.availability_block_multiple()
returns trigger
language plpgsql
as $$
declare
  slot int;
  mins numeric;
begin
  select coalesce(max(slot_minutes), 30) into slot from public.app_config;
  slot := coalesce(slot, 30);
  mins := extract(epoch from (new.end_time - new.start_time)) / 60.0;

  if mins <= 0 or mins <> floor(mins) or (mins::int % slot) <> 0 then
    raise exception
      'availability block length (% min) must be a positive whole multiple of slot_minutes (%)',
      mins, slot
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
