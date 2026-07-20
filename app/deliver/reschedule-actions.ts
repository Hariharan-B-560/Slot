"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type RequestResult = { ok: boolean; error?: string };

// A teacher REQUESTS a reschedule — they can never move the class themselves.
// RLS lets a teacher insert a request only for a class they own; the class
// itself is untouched here.
const schema = z.object({
  class_id: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(500),
  proposed_start: z.string().optional(), // ISO datetime-local (optional suggestion)
});

export async function requestReschedule(input: unknown): Promise<RequestResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient(); // teacher session → rr_teacher_insert RLS
  const { error } = await supabase.from("reschedule_requests").insert({
    class_id: d.class_id,
    requested_by: profile.id,
    reason: d.reason,
    proposed_start: d.proposed_start ? new Date(d.proposed_start).toISOString() : null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/deliver");
  return { ok: true };
}
