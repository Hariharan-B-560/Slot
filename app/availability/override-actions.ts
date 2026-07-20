"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";

export type OverrideResult = { ok: boolean; error?: string };

// Admin opens (or closes) a specific date for a specific teacher — a one-off,
// never recurring. The DB CHECK rejects opening a Sunday; RLS allows only admins
// to write. A null time window means the whole day.
const overrideSchema = z.object({
  teacher_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  kind: z.enum(["open", "close"]),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().trim().max(200).optional(),
});

function friendly(msg: string): string {
  if (msg.includes("overrides_no_open_sunday")) return "Sundays can't be opened — the institute is closed on Sundays.";
  if (msg.includes("overrides_window_paired")) return "Give both a start and an end time, or leave both blank for the full day.";
  if (msg.includes("overrides_window_order")) return "The start time must be before the end time.";
  return msg;
}

export async function openOverride(input: unknown): Promise<OverrideResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if ((d.start_time && !d.end_time) || (!d.start_time && d.end_time))
    return { ok: false, error: "Give both a start and an end time, or leave both blank for the full day." };

  const supabase = await createClient(); // admin session → overrides_admin_write
  const { error } = await supabase.from("availability_overrides").insert({
    teacher_id: d.teacher_id,
    date: d.date,
    kind: d.kind,
    start_time: d.start_time ?? null,
    end_time: d.end_time ?? null,
    reason: d.reason || null,
    created_by: profile.id,
  });
  if (error) return { ok: false, error: friendly(error.message) };

  revalidatePath("/availability");
  return { ok: true };
}

export async function removeOverride(id: string): Promise<OverrideResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return { ok: false, error: "Admin only" };
  const supabase = await createClient();
  const { error } = await supabase.from("availability_overrides").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/availability");
  return { ok: true };
}
