"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type StatusResult = { ok: boolean; error?: string };

// Pause/resume go through admin-gated DB functions that carry the reason to the
// history trigger and (on resume) regenerate classes. Admin-only.
const pauseSchema = z.object({
  enrolment_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});

export async function pauseEnrolment(input: unknown): Promise<StatusResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = pauseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("pause_enrolment", {
    p_id: parsed.data.enrolment_id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true };
}

export async function resumeEnrolment(enrolmentId: string): Promise<StatusResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resume_enrolment", { p_id: enrolmentId });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true };
}
