"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type SessionsResult = { ok: boolean; error?: string };

// Editing the class count goes through the admin-gated DB function, which audits
// the change and reconciles the calendar (regenerate on increase, cancel the
// surplus on decrease). Admin-only; the RPC enforces every guardrail.
const schema = z.object({
  enrolment_id: z.string().uuid(),
  total: z.coerce.number().int().positive("The class count must be a positive number"),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});

export async function setEnrolmentSessions(input: unknown): Promise<SessionsResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_enrolment_sessions", {
    p_enrolment: parsed.data.enrolment_id,
    p_total: parsed.data.total,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roster");
  revalidatePath("/availability");
  return { ok: true };
}
