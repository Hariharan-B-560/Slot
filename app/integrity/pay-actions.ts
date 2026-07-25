"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type RateResult = { ok: boolean; error?: string };

// Changing a teacher's rate goes through the admin-gated DB function, which
// carries the reason to the rate_history trigger in one transaction. Admin-only
// (the RPC also enforces it — this guard is the fast bounce).
const rateSchema = z.object({
  teacher_id: z.string().uuid(),
  rate: z.coerce.number().min(0, "Rate can't be negative").max(100000),
  reason: z.string().trim().max(300).optional(),
});

export async function setTeacherRate(input: unknown): Promise<RateResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_teacher_rate", {
    p_teacher: parsed.data.teacher_id,
    p_rate: parsed.data.rate,
    p_reason: parsed.data.reason || undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/integrity");
  return { ok: true };
}
