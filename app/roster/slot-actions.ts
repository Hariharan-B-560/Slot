"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type SlotResult = { ok: boolean; error?: string; moved?: number };

// Changing an enrolment's daily slot goes through the admin-gated DB function,
// which moves every future published class via the sanctioned reschedule path.
// Admin-only (the RPC enforces it too — this guard is the fast bounce).
const slotSchema = z.object({
  enrolment_id: z.string().uuid(),
  new_slot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a HH:MM time"),
  reason: z.string().trim().max(300).optional(),
});

export async function changeEnrolmentSlot(input: unknown): Promise<SlotResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_enrolment_slot", {
    p_enrolment: parsed.data.enrolment_id,
    p_new_slot: parsed.data.new_slot,
    p_reason: parsed.data.reason || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true, moved: typeof data === "number" ? data : undefined };
}
