"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type RetroResult = { ok: boolean; error?: string };

// Admin retro-close: record a "taught but forgot to mark delivered" class as
// delivered + verified, with the teacher's evidence and a reason. The DB
// function enforces admin-only, the 3-day cap, the past-window rule, and writes
// the audit row — this action is just the typed doorway.
const retroSchema = z.object({
  class_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(300),
  opening_screenshot: z.string().min(1, "Opening screenshot is required"),
  closing_screenshot: z.string().min(1, "Closing screenshot is required"),
  attendance: z.enum(["present", "late", "absent"]).default("present"),
  absent_reason: z.string().trim().max(300).optional(),
  recording: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function retroClose(input: unknown): Promise<RetroResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = retroSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_retro_close", {
    p_class: d.class_id,
    p_reason: d.reason,
    p_opening: d.opening_screenshot,
    p_closing: d.closing_screenshot,
    p_attendance: d.attendance,
    p_absent_reason: d.absent_reason || undefined,
    p_recording: d.recording || undefined,
    p_notes: d.notes || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/verify");
  revalidatePath("/integrity");
  return { ok: true };
}
