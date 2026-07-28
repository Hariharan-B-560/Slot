"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type ReassignResult = { ok: boolean; error?: string };

// Reassigning a student to another teacher is a re-enrolment (the DB function
// ends the old enrolment, cancels its future classes, and opens a new one under
// the new teacher). Admin-only; the RPC enforces every rule.
const schema = z.object({
  enrolment_id: z.string().uuid(),
  new_teacher_id: z.string().uuid(),
  new_slot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  reason: z.string().trim().max(300).optional(),
});

export async function reassignTeacher(input: unknown): Promise<ReassignResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reassign_teacher", {
    p_enrolment: parsed.data.enrolment_id,
    p_new_teacher: parsed.data.new_teacher_id,
    p_new_slot: parsed.data.new_slot,
    p_reason: parsed.data.reason || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true };
}
