-- =============================================================================
-- Course enum → the real four-course list.
--
-- All four courses are 1-teacher-1-student with identical mechanics — "course"
-- is a display label only, never a branch. Replaces the placeholder
-- basic_live | elp enum. Pre-launch with no real users, so existing rows are
-- best-fit mapped: basic_live → basic, elp → speaking.
--
-- Enum swap sequence: drop the column default (it references the old type),
-- retype the column through a CASE cast, drop the old type, rename the new one
-- into place, restore a default.
-- =============================================================================

alter table public.enrolments alter column course drop default;

create type public.course_type_new as enum ('basic', 'speaking', 'combo', 'speaking_partner');

alter table public.enrolments
  alter column course type public.course_type_new
  using (
    case course::text
      when 'basic_live' then 'basic'
      when 'elp'        then 'speaking'
      else 'basic'
    end
  )::public.course_type_new;

drop type public.course_type;
alter type public.course_type_new rename to course_type;

alter table public.enrolments alter column course set default 'basic';
