"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { toMin, fromMin } from "@/lib/time";
import { totalSessions, remaining, freesUp } from "@/lib/roster";
import { COURSES } from "@/lib/courses";

export type ActionResult = { ok: boolean; error?: string };

// Availability writes go through the caller's OWN session — RLS decides:
// availability_teacher_all (own rows) and availability_admin_write (any teacher).
// No more service-role bypass; the database is the authority.
async function authWrite(teacherId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" as const };
  const allowed = profile.role === "admin" || (profile.role === "teacher" && teacherId === profile.id);
  if (!allowed) return { error: "Not allowed to edit this teacher" as const };
  return { supabase: await createClient(), profile };
}

async function sessionMinutes(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase.from("app_config").select("slot_minutes").limit(1).maybeSingle();
  return (data?.slot_minutes as number | undefined) ?? 30;
}

/**
 * Publish a daily working window (a block). The DB enforces that its length is a
 * whole multiple of session_minutes — we surface that error, never pre-block it.
 */
export async function publishRange(teacherId: string, start: string, end: string): Promise<ActionResult> {
  const a = await authWrite(teacherId);
  if (a.error) return { ok: false, error: a.error };
  const { error } = await a.supabase!
    .from("availability_blocks")
    .insert({ teacher_id: teacherId, start_time: start, end_time: end });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/availability");
  return { ok: true };
}

// Publish one 30-min time (no-op if a block already covers it).
async function _publish(supabase: SupabaseClient, teacherId: string, time: string, sess: number) {
  const start = fromMin(toMin(time));
  const end = fromMin(toMin(time) + sess);
  const { data: covering } = await supabase
    .from("availability_blocks")
    .select("id")
    .eq("teacher_id", teacherId)
    .lte("start_time", start)
    .gte("end_time", end);
  if (covering && covering.length > 0) return;
  await supabase
    .from("availability_blocks")
    .insert({ teacher_id: teacherId, start_time: start, end_time: end });
}

export async function publishSlot(teacherId: string, time: string): Promise<ActionResult> {
  const a = await authWrite(teacherId);
  if (a.error) return { ok: false, error: a.error };
  const sess = await sessionMinutes(a.supabase!);
  await _publish(a.supabase!, teacherId, time, sess);
  revalidatePath("/availability");
  return { ok: true };
}

/** Bulk publish (drag-select across unpublished segments). */
export async function bulkPublish(teacherId: string, times: string[]): Promise<ActionResult> {
  const a = await authWrite(teacherId);
  if (a.error) return { ok: false, error: a.error };
  const sess = await sessionMinutes(a.supabase!);
  for (const t of times) await _publish(a.supabase!, teacherId, t, sess);
  revalidatePath("/availability");
  return { ok: true };
}

// Remove one 30-min time; if it sits inside a bigger block, split the block into
// per-slot blocks so only that time disappears.
async function _makeUnavailable(supabase: SupabaseClient, teacherId: string, time: string, sess: number) {
  const start = toMin(time);
  const end = start + sess;
  const { data: blocks } = await supabase
    .from("availability_blocks")
    .select("id, start_time, end_time")
    .eq("teacher_id", teacherId)
    .lte("start_time", fromMin(start))
    .gte("end_time", fromMin(end));

  for (const b of (blocks ?? []) as { id: string; start_time: string; end_time: string }[]) {
    await supabase.from("availability_blocks").delete().eq("id", b.id);
    const bs = toMin(b.start_time);
    const be = toMin(b.end_time);
    const rows: { teacher_id: string; start_time: string; end_time: string }[] = [];
    for (let m = bs; m + sess <= be; m += sess) {
      if (m === start) continue; // the time being removed
      rows.push({ teacher_id: teacherId, start_time: fromMin(m), end_time: fromMin(m + sess) });
    }
    if (rows.length > 0) await supabase.from("availability_blocks").insert(rows);
  }
}

export async function makeUnavailable(teacherId: string, time: string): Promise<ActionResult> {
  const a = await authWrite(teacherId);
  if (a.error) return { ok: false, error: a.error };
  const sess = await sessionMinutes(a.supabase!);
  await _makeUnavailable(a.supabase!, teacherId, time, sess);
  revalidatePath("/availability");
  return { ok: true };
}

/** Bulk remove (drag-select over free times). */
export async function bulkMakeUnavailable(teacherId: string, times: string[]): Promise<ActionResult> {
  const a = await authWrite(teacherId);
  if (a.error) return { ok: false, error: a.error };
  const sess = await sessionMinutes(a.supabase!);
  for (const t of times) await _makeUnavailable(a.supabase!, teacherId, t, sess);
  revalidatePath("/availability");
  return { ok: true };
}

// --- Placement (admin only) -------------------------------------------------
const placeSchema = z.object({
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid("Choose a student"),
  course: z.enum(COURSES),
  slot_start: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.coerce.number().int().refine((d) => d === 30 || d === 60, "Duration must be 30 or 60"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  total_sessions: z.coerce.number().int().positive().optional(),
});

function friendly(msg: string): string {
  if (msg.includes("enrolments_no_overlap")) return "That time overlaps an existing booking for this teacher.";
  if (msg.includes("enrolments_one_per_student_teacher"))
    return "This student already holds a slot with this teacher.";
  if (msg.includes("enrolments_has_cap")) return "Set an end date and/or a session count.";
  if (msg.includes("duration_minutes")) return "Session length must be 30 or 60 minutes.";
  return msg;
}

export async function placeStudent(input: unknown): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient(); // admin session → RLS allows both writes
  const { data: conv, error: convErr } = await supabase
    .from("conversion_events")
    .insert({ student_id: d.student_id, type: "admin_signoff", recorded_by: profile.id })
    .select("id")
    .single();
  if (convErr) return { ok: false, error: friendly(convErr.message) };

  const { error: enrErr } = await supabase.from("enrolments").insert({
    student_id: d.student_id,
    teacher_id: d.teacher_id,
    conversion_event_id: conv!.id,
    course: d.course,
    slot_start: d.slot_start,
    duration_minutes: d.duration_minutes,
    start_date: d.start_date,
    end_date: d.end_date ?? null,
    total_sessions: d.total_sessions ?? null,
    status: "active",
  });
  if (enrErr) return { ok: false, error: friendly(enrErr.message) };

  await supabase.from("students").update({ status: "enrolled" }).eq("id", d.student_id);
  revalidatePath("/availability");
  return { ok: true };
}

// --- Demo placement (admin only) --------------------------------------------
// A DEMO is a one-off class, not an enrolment. It inherits the slot's start time
// and the chosen duration — no free-form datetime, no minutes field. The admin
// picks the demo DATE and (optionally) an expected joining date for the lead.
const demoSchema = z.object({
  teacher_id: z.string().uuid(),
  student_id: z.string().uuid("Choose a student"),
  slot_start: z.string().regex(/^\d{2}:\d{2}$/),
  duration_minutes: z.coerce.number().int().refine((d) => d === 30 || d === 60, "Duration must be 30 or 60"),
  demo_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the demo date"),
  expected_joining_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function placeDemo(input: unknown): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = demoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  // demo_date + slot_start in Asia/Kolkata → an absolute instant.
  const start = new Date(`${d.demo_date}T${d.slot_start}:00+05:30`);
  const end = new Date(start.getTime() + d.duration_minutes * 60_000);

  const supabase = await createClient(); // admin session → classes_admin_insert
  const { error: clsErr } = await supabase.from("classes").insert({
    slot_type: "DEMO",
    teacher_id: d.teacher_id,
    student_id: d.student_id,
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
    duration_minutes: d.duration_minutes,
  });
  if (clsErr) {
    if (clsErr.message.includes("publish_before_happen"))
      return { ok: false, error: "The demo time must be in the future." };
    return { ok: false, error: clsErr.message };
  }

  await supabase
    .from("students")
    .update({ status: "demo_scheduled", expected_joining_date: d.expected_joining_date ?? null })
    .eq("id", d.student_id);

  revalidatePath("/availability");
  revalidatePath("/classes");
  return { ok: true };
}

export async function endEnrolment(enrolmentId: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const supabase = await createClient();
  const { error } = await supabase.from("enrolments").update({ status: "ended" }).eq("id", enrolmentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/availability");
  return { ok: true };
}

// --- Taken-row drill-down ---------------------------------------------------
export type EnrolmentDetail = {
  student: string;
  teacher: string;
  course: string;
  slot: string;
  total: number | null;
  delivered: number;
  legacyDelivered: number;
  migrated: boolean;
  remaining: number | null;
  freesUpDate: string | null;
  freesUpBy: "sessions" | "end_date" | null;
  status: string;
  enrolmentId: string;
  studentId: string;
  recent: { when: string; status: string }[];
  // Payment figures — admin only (the DB reader returns nothing for teachers).
  payment: { totalFee: number | null; paid: number; feeRemaining: number | null } | null;
};

export async function enrolmentDetail(enrolmentId: string): Promise<EnrolmentDetail | null> {
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("enrolments")
    .select(
      "id, student_id, course, slot_start, start_date, end_date, total_sessions, sessions_already_delivered, migrated_from_legacy, status, student:students(name), teacher:profiles!enrolments_teacher_id_fkey(name)",
    )
    .eq("id", enrolmentId)
    .maybeSingle();
  if (!e) return null;
  const en = e as unknown as {
    id: string; student_id: string; course: string; slot_start: string; start_date: string; end_date: string | null;
    total_sessions: number | null; sessions_already_delivered: number | null; migrated_from_legacy: boolean;
    status: string; student: { name: string } | null; teacher: { name: string } | null;
  };

  const { data: cls } = await supabase
    .from("classes")
    .select("scheduled_start, status")
    .eq("enrolment_id", enrolmentId)
    .order("scheduled_start", { ascending: false });
  const classRows = (cls ?? []) as { scheduled_start: string; status: string }[];
  const delivered = classRows.filter((c) => c.status === "delivered" || c.status === "verified").length;

  const total = totalSessions(en);
  const frees = freesUp(en);

  // Admin-only: the derived reader returns zero rows for teachers, so `payment`
  // stays null and no payment figures reach a teacher's drill-down.
  const { data: pay } = await supabase.rpc("enrolment_payment_status", { p_enrolment: enrolmentId });
  const payRow = (pay ?? [])[0] as { total_fee: number | null; paid: number; remaining: number | null } | undefined;
  const payment = payRow
    ? {
        totalFee: payRow.total_fee == null ? null : Number(payRow.total_fee),
        paid: Number(payRow.paid),
        feeRemaining: payRow.remaining == null ? null : Number(payRow.remaining),
      }
    : null;

  return {
    enrolmentId: en.id,
    student: en.student?.name ?? "—",
    teacher: en.teacher?.name ?? "—",
    course: en.course,
    slot: `${en.slot_start.slice(0, 5)} · open days`,
    total,
    delivered,
    legacyDelivered: en.sessions_already_delivered ?? 0,
    migrated: en.migrated_from_legacy,
    remaining: remaining(en, delivered),
    freesUpDate: frees.date,
    freesUpBy: frees.boundBy,
    status: en.status,
    studentId: en.student_id,
    recent: classRows.slice(0, 6).map((c) => ({ when: c.scheduled_start, status: c.status })),
    payment,
  };
}
