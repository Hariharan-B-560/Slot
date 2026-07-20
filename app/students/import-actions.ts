"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { COURSES } from "@/lib/courses";

export type ImportResult = { ok: boolean; error?: string; studentId?: string };

// One-time legacy onboarding: create the student, the admin conversion event,
// and a migrated enrolment carrying the state they already have — WITHOUT
// backfilling classes (rule 1 / rule 2 keep the historical period out of the
// ledger). Goes through the real DB path, so rule 4, rule 7 overlap, the
// dual-cap and the new legacy checks all still fire.
const importSchema = z
  .object({
    name: z.string().trim().min(1, "Student name is required").max(120),
    phone: z.string().trim().max(40).optional(),
    course: z.enum(COURSES),
    teacher_id: z.string().uuid("Choose a teacher"),
    slot_start: z.string().regex(/^\d{2}:\d{2}$/),
    duration_minutes: z.coerce.number().int().refine((d) => d === 30 || d === 60, "Duration must be 30 or 60"),
    total_sessions: z.coerce.number().int().positive().optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sessions_already_delivered: z.coerce.number().int().min(0, "Cannot be negative"),
    historical_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the app start date"),
  })
  .refine((d) => d.total_sessions != null || d.end_date != null, {
    message: "Set a session count and/or an end date",
    path: ["total_sessions"],
  })
  .refine((d) => d.total_sessions == null || d.sessions_already_delivered <= d.total_sessions, {
    message: "Already-delivered can't exceed the total package",
    path: ["sessions_already_delivered"],
  })
  .refine((d) => d.historical_start_date == null || d.historical_start_date <= d.start_date, {
    message: "Historical start must be on or before the app start date",
    path: ["historical_start_date"],
  });

function friendly(msg: string): string {
  if (msg.includes("enrolments_no_overlap")) return "That time overlaps an existing booking for this teacher.";
  if (msg.includes("enrolments_one_per_student_teacher"))
    return "This student already holds a slot with this teacher.";
  if (msg.includes("enrolments_has_cap")) return "Set an end date and/or a session count.";
  if (msg.includes("enrolments_already_delivered_le_total"))
    return "Already-delivered can't exceed the total package.";
  if (msg.includes("enrolments_already_delivered_nonneg")) return "Already-delivered can't be negative.";
  if (msg.includes("enrolments_historical_before_start"))
    return "Historical start must be on or before the app start date.";
  if (msg.includes("enrolments_duration_allowed")) return "Session length must be 30 or 60 minutes.";
  return msg;
}

export async function importLegacyStudent(input: unknown): Promise<ImportResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient(); // admin session → RLS allows every write

  // 1) the student record
  const { data: student, error: sErr } = await supabase
    .from("students")
    .insert({ name: d.name, phone: d.phone || null, status: "enrolled" })
    .select("id")
    .single();
  if (sErr) return { ok: false, error: friendly(sErr.message) };
  const studentId = student!.id as string;

  // 2) the admin conversion event (rule 4), tagged as a legacy migration
  const { data: conv, error: cErr } = await supabase
    .from("conversion_events")
    .insert({ student_id: studentId, type: "admin_signoff", recorded_by: profile.id, ref: "legacy migration" })
    .select("id")
    .single();
  if (cErr) return { ok: false, error: friendly(cErr.message) };

  // 3) the migrated enrolment (rule 7 overlap + dual-cap + legacy checks fire here)
  const { error: eErr } = await supabase.from("enrolments").insert({
    student_id: studentId,
    teacher_id: d.teacher_id,
    conversion_event_id: conv!.id,
    course: d.course,
    slot_start: d.slot_start,
    duration_minutes: d.duration_minutes,
    start_date: d.start_date,
    end_date: d.end_date ?? null,
    total_sessions: d.total_sessions ?? null,
    sessions_already_delivered: d.sessions_already_delivered,
    historical_start_date: d.historical_start_date ?? null,
    migrated_from_legacy: true,
    status: "active",
  });
  if (eErr) {
    // The student + conversion rows already landed; surface the enrolment error
    // so the admin can correct the slot/caps and retry (the student now exists,
    // so a retry re-uses it via the normal placement flow if preferred).
    return { ok: false, error: friendly(eErr.message), studentId };
  }

  revalidatePath("/students");
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true, studentId };
}
