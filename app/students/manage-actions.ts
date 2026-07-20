"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { STUDENT_STATUSES as STATUSES } from "@/lib/students";

export type StudentResult = { ok: boolean; error?: string; id?: string; name?: string };

const studentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(40).optional(),
  status: z.enum(STATUSES).default("lead"),
});

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" as const };
  if (profile.role !== "admin") return { error: "Admin only" as const };
  return { ok: true as const };
}

/** Create a student record (admin only; students_admin_write RLS). */
export async function createStudent(input: {
  name: string;
  phone?: string;
  status?: (typeof STATUSES)[number];
}): Promise<StudentResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("students")
    .insert({ name: parsed.data.name, phone: parsed.data.phone || null, status: parsed.data.status })
    .select("id, name")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/students");
  revalidatePath("/roster");
  return { ok: true, id: data!.id as string, name: data!.name as string };
}

/** Edit a student record (admin only). */
export async function updateStudent(
  id: string,
  input: { name: string; phone?: string; status: (typeof STATUSES)[number] },
): Promise<StudentResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = studentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("students")
    .update({ name: parsed.data.name, phone: parsed.data.phone || null, status: parsed.data.status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/students");
  revalidatePath("/roster");
  return { ok: true };
}
