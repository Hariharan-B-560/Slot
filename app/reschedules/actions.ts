"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type DecisionResult = { ok: boolean; error?: string };

function friendly(msg: string): string {
  if (msg.includes("rule 7") || msg.includes("exclusion")) return "That slot overlaps another class for this teacher.";
  if (msg.includes("only a published class")) return "That class can no longer be moved (it's already delivered).";
  if (msg.includes("publish_before_happen")) return "The new time must be in the future.";
  return msg;
}

const approveSchema = z.object({
  request_id: z.string().uuid(),
  class_id: z.string().uuid(),
  new_start: z.string().min(1, "Pick the new date and time"), // datetime-local
  note: z.string().trim().max(500).optional(),
});

export async function approveReschedule(input: unknown): Promise<DecisionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient(); // admin session → reschedule_class re-checks is_admin
  // The DB function moves the ORIGINAL class row (audited), guards overlap +
  // published-only, and marks the request approved. No duplicate class.
  const { error } = await supabase.rpc("reschedule_class", {
    p_class_id: d.class_id,
    p_new_start: new Date(d.new_start).toISOString(),
    p_request_id: d.request_id,
    p_note: d.note || null,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/reschedules");
  revalidatePath("/availability");
  return { ok: true };
}

const denySchema = z.object({
  request_id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
});

export async function denyReschedule(input: unknown): Promise<DecisionResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = denySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("reschedule_requests")
    .update({ status: "denied", decided_by: profile.id, decided_at: new Date().toISOString(), decision_note: d.note || null })
    .eq("id", d.request_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/reschedules");
  return { ok: true };
}
