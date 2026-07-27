-- =============================================================================
-- seed.sql — one admin, two teachers, two student records.
-- Fixed UUIDs so acceptance tests can impersonate each user deterministically.
-- Idempotent (on conflict do nothing) so `supabase db reset` is repeatable.
-- =============================================================================

-- --- auth.users (profiles.id is an FK to auth.users) -------------------------
-- Minimal rows for the local auth stack. No real login flows in Phase 1.
-- NOTE: GoTrue scans the token columns (confirmation_token, recovery_token,
-- email_change*, reauthentication_token) as non-null strings, so they MUST be
-- '' — leaving them NULL makes every login 500 with "converting NULL to string
-- is unsupported". Same for the *_sent_at timestamps left NULL (nullable) is OK.
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current,
  reauthentication_token
)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000a01',
   'authenticated', 'authenticated', 'admin@theeasyenglish.test',
   crypt('password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000b01',
   'authenticated', 'authenticated', 'teacher1@theeasyenglish.test',
   crypt('password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000b02',
   'authenticated', 'authenticated', 'teacher2@theeasyenglish.test',
   crypt('password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000d01',
   'authenticated', 'authenticated', 'counsellor@theeasyenglish.test',
   crypt('password', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}',
   '', '', '', '', '', '')
on conflict (id) do nothing;

-- --- profiles (roles: admin | teacher only) ----------------------------------
-- email is mirrored here so the app can list users without reading auth.users.
-- must_change_password = false: seeded accounts are ready to use (the column
-- defaults true so ADMIN-created accounts are forced to change on first login).
insert into public.profiles (id, name, role, email, must_change_password) values
  ('00000000-0000-0000-0000-000000000a01', 'Admin One',     'admin',      'admin@theeasyenglish.test',      false),
  ('00000000-0000-0000-0000-000000000b01', 'Teacher One',   'teacher',    'teacher1@theeasyenglish.test',   false),
  ('00000000-0000-0000-0000-000000000b02', 'Teacher Two',   'teacher',    'teacher2@theeasyenglish.test',   false),
  ('00000000-0000-0000-0000-000000000d01', 'Counsellor One', 'counsellor', 'counsellor@theeasyenglish.test', false)
on conflict (id) do nothing;

-- --- students (data records, NO login) ---------------------------------------
-- c01 stays a lead so the conversion-gate flow can be demoed end to end.
-- c02 is already converted + enrolled (seeded below) so generation has input.
insert into public.students (id, name, phone, status) values
  ('00000000-0000-0000-0000-000000000c01', 'Student One',   '+91-90000-00001', 'lead'),
  ('00000000-0000-0000-0000-000000000c02', 'Student Two',   '+91-90000-00002', 'enrolled'),
  ('00000000-0000-0000-0000-000000000c03', 'Student Three', '+91-90000-00003', 'enrolled')
on conflict (id) do nothing;

-- --- one converted student with a recurring enrolment ------------------------
-- Conversion recorded by the admin (RULE 4). Enrolment references it (NOT NULL).
insert into public.conversion_events (id, student_id, type, recorded_by, ref) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000c02',
   'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'seed')
on conflict (id) do nothing;

-- Atom granularity for the grid (30-min atoms). Sessions are 30 or 60 min.
insert into public.app_config (id, slot_minutes) values (true, 30)
on conflict (id) do nothing;

-- Student Three, placed as a 60-MIN session so the strip shows a two-atom span
-- (Teacher One, 16:00–17:00 daily). c01 stays an unassigned lead.
insert into public.conversion_events (id, student_id, type, recorded_by, ref) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000c03',
   'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'seed-60')
on conflict (id) do nothing;
insert into public.enrolments
  (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, course, status)
values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000c03',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000e2',
   '16:00', 60, current_date, 10, 'speaking', 'active')
on conflict (id) do nothing;

-- A DAILY 18:00 IST 30-min session, starting today, capped at 12 sessions.
insert into public.enrolments
  (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date, total_sessions, status)
values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000c02',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000e1',
   '18:00', 30, current_date, 12, 'active')
on conflict (id) do nothing;

-- --- one LEGACY-migrated student (so the Migrated chip + dashboard toggle show)
-- Student Four came over mid-package from the Google Form system: a 20-session
-- package, 12 already delivered there. The app takes over generation today at
-- 19:00 (a free Teacher One atom). Past classes are NOT backfilled.
insert into public.students (id, name, phone, status) values
  ('00000000-0000-0000-0000-000000000c04', 'Student Four', '+91-90000-00004', 'enrolled')
on conflict (id) do nothing;
insert into public.conversion_events (id, student_id, type, recorded_by, ref) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000c04',
   'admin_signoff', '00000000-0000-0000-0000-000000000a01', 'legacy migration')
on conflict (id) do nothing;
insert into public.enrolments
  (id, student_id, teacher_id, conversion_event_id, slot_start, duration_minutes, start_date,
   total_sessions, sessions_already_delivered, historical_start_date, migrated_from_legacy, course, status)
values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000c04',
   '00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000e4',
   '19:00', 30, current_date, 20, 12, current_date - 60, true, 'combo', 'active')
on conflict (id) do nothing;

-- --- availability (daily working window) -------------------------------------
-- A block is now just a time range — the teacher's daily window, sliced into
-- 30-min slots. Teacher One 16:00–20:00 = 8 slots. Teacher Two 17:00–19:00 = 4.
insert into public.availability_blocks (teacher_id, start_time, end_time) values
  ('00000000-0000-0000-0000-000000000b01', '16:00', '20:00'),
  ('00000000-0000-0000-0000-000000000b02', '17:00', '19:00')
on conflict do nothing;

-- --- one open-Saturday override (so the Open-dates panel + Saturday generation
-- are visible on a fresh reset). Next week's Saturday, 16:00–18:00 for Teacher
-- One. Sundays are never openable (DB CHECK).
insert into public.availability_overrides (id, teacher_id, date, kind, start_time, end_time, created_by, reason) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000b01',
   date_trunc('week', current_date)::date + 12, 'open', '16:00', '18:00',
   '00000000-0000-0000-0000-000000000a01', 'Make-up Saturday (demo)')
on conflict (id) do nothing;

-- --- sample lifecycle rows so the dashboard isn't empty on a fresh reset ------
-- These go through the real lifecycle (publish -> deliver -> verify), so every
-- anti-fraud trigger applies. The jwt claim is set locally so auth.uid() names
-- the acting user, exactly as it would from the app.
do $$
declare
  cid uuid;
  admin uuid := '00000000-0000-0000-0000-000000000a01';
  t1    uuid := '00000000-0000-0000-0000-000000000b01';
  t2    uuid := '00000000-0000-0000-0000-000000000b02';
  s2    uuid := '00000000-0000-0000-0000-000000000c02';
  f1    uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  -- (a) Teacher One: a VERIFIED enrolled class (utilisation numerator).
  -- 30-min session window (matches app_config.session_minutes), centred on now.
  insert into public.classes (slot_type, teacher_id, student_id, enrolment_id,
                              scheduled_start, scheduled_end, published_at)
  values ('ENROLLED', t1, s2, f1, now() - interval '15 minutes',
          now() + interval '15 minutes', now() - interval '2 hours')
  returning id into cid;

  -- RULE 8: a session report (with evidence) must exist before delivery.
  insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, notes, created_by)
  values (cid, 'present', cid || '/opening-seed.png', cid || '/closing-seed.png', 'Present perfect — intro', t1);

  perform set_config('request.jwt.claims', json_build_object('sub', t1)::text, true);
  update public.classes set status = 'delivered' where id = cid;   -- inside window
  perform set_config('request.jwt.claims', json_build_object('sub', admin)::text, true);
  update public.classes set status = 'verified' where id = cid;    -- admin verifies

  -- (b) Teacher Two: a DELIVERED-but-unverified class (admin review queue).
  insert into public.classes (slot_type, teacher_id, student_id,
                              scheduled_start, scheduled_end, published_at)
  values ('DEMO', t2, s2, now() - interval '15 minutes',
          now() + interval '15 minutes', now() - interval '90 minutes')
  returning id into cid;

  insert into public.session_reports (class_id, attendance, opening_screenshot, closing_screenshot, notes, created_by)
  values (cid, 'late', cid || '/opening-seed.png', cid || '/closing-seed.png', 'Past tense drill', t2);

  perform set_config('request.jwt.claims', json_build_object('sub', t2)::text, true);
  update public.classes set status = 'delivered' where id = cid;

  -- (c) Teacher One: a PUBLISHED class LIVE right now (start −10 min, end +50 min)
  -- so the Deliver screen has something deliverable immediately after a reset.
  insert into public.classes (slot_type, teacher_id, student_id, enrolment_id, duration_minutes,
                              scheduled_start, scheduled_end, published_at)
  values ('ENROLLED', t1, s2, f1, 60, now() - interval '10 minutes',
          now() + interval '50 minutes', now() - interval '2 hours');

  perform set_config('request.jwt.claims', '', true);              -- clear impersonation
end $$;
