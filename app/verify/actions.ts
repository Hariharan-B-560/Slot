"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type ActionResult = { ok: boolean; error?: string };

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" as const };
  if (profile.role !== "admin") return { error: "Admin only" as const };
  return { ok: true as const };
}

/** Admin verifies a delivered class (rule 5: teachers can't). */
export async function verifyClass(id: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const supabase = await createClient();
  const { error } = await supabase.from("classes").update({ status: "verified" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/verify");
  return { ok: true };
}

/** Admin flags a delivered class for follow-up, with a reason. */
export async function flagClass(id: string, reason: string): Promise<ActionResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const r = z.string().trim().min(1, "Give a reason").max(500).safeParse(reason);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Invalid reason" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({ status: "flagged", flag_reason: r.data })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/verify");
  return { ok: true };
}
