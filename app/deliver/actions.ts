"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type ActionResult = { ok: boolean; error?: string };

const reportSchema = z.object({
  class_id: z.string().uuid(),
  attendance: z.enum(["present", "late", "absent"]),
  absent_reason: z.string().trim().max(500).optional(),
  opening_screenshot: z.string().min(1).optional(), // Storage path (uploaded client-side)
  closing_screenshot: z.string().min(1).optional(),
  recording: z.string().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function friendly(msg: string): string {
  if (msg.includes("session_reports_absent_reason")) return "Add a reason for the absence.";
  if (msg.includes("RULE 8b") || msg.includes("evidence-window"))
    return "This class isn't open for reporting right now (outside its window).";
  if (msg.includes("RULE 8")) return "A session report is required before delivering.";
  if (msg.includes("RULE 1") || msg.includes("no-backfill"))
    return "You can only deliver inside the class window (from start until 1½ hours after end).";
  if (msg.includes("null value") && msg.includes("screenshot"))
    return "Both opening and closing screenshots are required.";
  return msg;
}

/**
 * Files the session report (evidence) AND marks the class delivered. The DB is
 * the enforcer: the report-window trigger, the absent-reason CHECK, NOT NULL
 * screenshots, and rules 8 + 1 all fire here. We surface, never pre-block.
 */
export async function submitReport(input: unknown): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "teacher") return { ok: false, error: "Only a teacher can deliver a class" };

  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient();

  // 1) File the report (evidence). NOT NULL / window / absent-reason enforced here.
  const { error: repErr } = await supabase.from("session_reports").insert({
    class_id: d.class_id,
    attendance: d.attendance,
    absent_reason: d.absent_reason ?? null,
    opening_screenshot: d.opening_screenshot ?? null,
    closing_screenshot: d.closing_screenshot ?? null,
    recording: d.recording ?? null,
    notes: d.notes ?? null,
    created_by: profile.id,
  });
  if (repErr) return { ok: false, error: friendly(repErr.message) };

  // 2) Transition to delivered. Rule 8 (report exists) + rule 1 (window) enforced.
  const { error: delErr } = await supabase
    .from("classes")
    .update({ status: "delivered" })
    .eq("id", d.class_id);
  if (delErr) return { ok: false, error: friendly(delErr.message) };

  revalidatePath("/deliver");
  return { ok: true };
}
