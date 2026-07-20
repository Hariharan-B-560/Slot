-- =============================================================================
-- 0002 — Tables
-- Columns follow decision-v1.md §Data model exactly. Reserved-but-unused columns
-- (verify_source, student_confirmed_at) are present so future student login /
-- join-log auto-verify need no migration.
-- =============================================================================

-- --- profiles ----------------------------------------------------------------
-- App users. id references auth.users(id). Role drives every RLS policy.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       public.user_role not null,
  created_at timestamptz not null default now()
);

-- --- students ----------------------------------------------------------------
-- Data records only — NO login. Reserved for future student login.
create table public.students (
  id         uuid primary key default extensions.gen_random_uuid(),
  name       text not null,
  phone      text,
  status     public.student_status not null default 'lead',
  created_at timestamptz not null default now()
);

-- --- availability_blocks ------------------------------------------------------
-- Teacher-published availability. Denominator for utilisation.
create table public.availability_blocks (
  id         uuid primary key default extensions.gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id),
  weekday    smallint not null check (weekday between 0 and 6),  -- 0=Sunday
  start_time time not null,
  end_time   time not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

-- --- conversion_events --------------------------------------------------------
-- The objective conversion gate (anti-fraud spine, rule 4).
-- Constraint "recorded_by must be an admin, never the demo teacher" is enforced
-- by a trigger in 0004 (admin and teacher roles are disjoint, so admin-only
-- recording already excludes any demo teacher).
create table public.conversion_events (
  id          uuid primary key default extensions.gen_random_uuid(),
  student_id  uuid not null references public.students (id),
  type        public.conversion_type not null,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now(),
  ref         text
);

-- --- enrolments ---------------------------------------------------------------
-- Created only when a conversion_event exists (rule 4): conversion_event_id is
-- NOT NULL + FK. An enrolment is a recurring series, not a single class.
create table public.enrolments (
  id                  uuid primary key default extensions.gen_random_uuid(),
  student_id          uuid not null references public.students (id),
  teacher_id          uuid not null references public.profiles (id),
  source_demo_id      uuid,  -- FK to classes added after classes exists (below).
  conversion_event_id uuid not null references public.conversion_events (id),
  schedule            text not null,  -- rrule string or weekday+time spec.
  start_date          date not null,
  end_date            date,
  status              text not null default 'active',
  created_at          timestamptz not null default now()
);

-- --- classes (append-only ledger) --------------------------------------------
-- The heart of the model. Corrections are new rows, never edits (rule 3).
-- Rule 2 (publish-before-happen) is a CHECK constraint here; the trigger in
-- 0004 defaults published_at so the invariant always holds.
create table public.classes (
  id                   uuid primary key default extensions.gen_random_uuid(),
  slot_type            public.slot_type not null,
  teacher_id           uuid not null references public.profiles (id),
  student_id           uuid not null references public.students (id),
  enrolment_id         uuid references public.enrolments (id),  -- null for DEMO.
  scheduled_start      timestamptz not null,
  scheduled_end        timestamptz not null,
  status               public.class_status not null default 'published',
  published_at         timestamptz not null default now(),
  delivered_at         timestamptz,
  delivered_by         uuid references public.profiles (id),
  verified_at          timestamptz,
  verified_by          uuid references public.profiles (id),
  verify_source        public.verify_source,          -- 'admin' live; others future.
  student_confirmed_at timestamptz,                    -- reserved, unused in v1.
  flag_reason          text,
  created_at           timestamptz not null default now(),

  check (scheduled_start < scheduled_end),
  -- RULE 2 — publish-before-happen. Primary invariant lives here as a CHECK.
  constraint publish_before_happen check (published_at < scheduled_start),
  -- DEMO has no enrolment; ENROLLED must have one.
  check (
    (slot_type = 'DEMO'     and enrolment_id is null) or
    (slot_type = 'ENROLLED' and enrolment_id is not null)
  )
);

-- Now that classes exists, wire enrolments.source_demo_id → the DEMO class it
-- was born from.
alter table public.enrolments
  add constraint enrolments_source_demo_fk
  foreign key (source_demo_id) references public.classes (id);

-- Helpful indexes for the dashboard/queue queries built in later phases.
create index classes_teacher_idx      on public.classes (teacher_id);
create index classes_status_idx       on public.classes (status);
create index classes_window_idx       on public.classes (scheduled_start, scheduled_end);
create index conversion_student_idx   on public.conversion_events (student_id);
create index enrolments_teacher_idx   on public.enrolments (teacher_id);
