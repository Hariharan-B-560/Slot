-- =============================================================================
-- Widen the delivery grace window 15 min -> 1h30m.
--
-- delivery_grace() is the single global knob for how far AFTER a class ends a
-- teacher may still mark it delivered (Rule 1's tolerance), how long evidence can
-- be filed, and when the sweep gives up (published -> missed). Teachers with
-- back-to-back classes found 15 minutes too tight to click "delivered" in time,
-- so the institute raised it to 1 hour 30 minutes. Every trigger/function reads
-- this function, so redefining it here changes the window everywhere at once.
-- (Rule 1 still blocks EARLY delivery and stale backfilling beyond the window.)
-- =============================================================================

create or replace function public.delivery_grace()
returns interval
language sql
immutable
as $$ select interval '1 hour 30 minutes' $$;
