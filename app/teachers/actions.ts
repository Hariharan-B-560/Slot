"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/current-user";

export type TeacherResult = { ok: boolean; error?: string; id?: string };

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Not signed in" as const };
  if (profile.role !== "admin") return { error: "Admin only" as const };
  return { ok: true as const };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(8, "Temporary password must be at least 8 characters"),
});

/**
 * Add a teacher. A profile FKs to auth.users, so the auth user must exist first
 * — that needs the Auth Admin API (service role, server-only). The admin sets a
 * TEMPORARY password; the new profile keeps must_change_password = true (the
 * column default), so the teacher is forced to set their own on first login.
 * That is what keeps rule 5 (no self-verify) meaningful: the admin must not know
 * a teacher's real password.
 */
export async function createTeacher(input: {
  name: string;
  email: string;
  password: string;
}): Promise<TeacherResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { name, email, password } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !created?.user) {
    return { ok: false, error: authErr?.message ?? "Could not create the login for this teacher" };
  }

  const supabase = await createClient(); // admin session → RLS-checked write
  const { error: profErr } = await supabase
    .from("profiles")
    .insert({ id: created.user.id, name, role: "teacher", email, active: true }); // must_change_password defaults true
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id); // no login without a profile
    return { ok: false, error: profErr.message };
  }

  revalidatePath("/teachers");
  revalidatePath("/availability");
  return { ok: true, id: created.user.id };
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  active: z.boolean(),
});

/** Edit a teacher's name, or retire/reactivate them (never delete — they own history). */
export async function updateTeacher(
  id: string,
  input: { name: string; active: boolean },
): Promise<TeacherResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/teachers");
  revalidatePath("/availability");
  return { ok: true };
}

/**
 * Reset a teacher's password to a new temporary one (Auth Admin API) and re-arm
 * must_change_password so they must set their own again on next login.
 */
export async function resetTeacherPassword(id: string, password: string): Promise<TeacherResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (password.length < 8) return { ok: false, error: "Temporary password must be at least 8 characters" };

  const admin = createAdminClient();
  const { error: authErr } = await admin.auth.admin.updateUserById(id, { password });
  if (authErr) return { ok: false, error: authErr.message };

  // Re-arm the forced change. Service-role client bypasses the self-update guard,
  // which is correct: this is an admin action, not the user editing their own row.
  const { error: profErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", id);
  if (profErr) return { ok: false, error: profErr.message };

  revalidatePath("/teachers");
  return { ok: true };
}
