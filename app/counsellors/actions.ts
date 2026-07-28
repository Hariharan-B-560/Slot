"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/current-user";

export type CounsellorResult = { ok: boolean; error?: string; id?: string };

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
 * Add a counsellor. Same shape as adding a teacher: the profile FKs to
 * auth.users, so create the auth user first (Auth Admin API, server-only), then
 * the profile with role 'counsellor'. The TEMPORARY password + must_change_password
 * default force them to set their own on first login.
 */
export async function createCounsellor(input: {
  name: string;
  email: string;
  password: string;
}): Promise<CounsellorResult> {
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
    return { ok: false, error: authErr?.message ?? "Could not create the login for this counsellor" };
  }

  const supabase = await createClient(); // admin session → RLS-checked write
  const { error: profErr } = await supabase
    .from("profiles")
    .insert({ id: created.user.id, name, role: "counsellor", email, active: true }); // must_change_password defaults true
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id); // no login without a profile
    return { ok: false, error: profErr.message };
  }

  revalidatePath("/counsellors");
  return { ok: true, id: created.user.id };
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  active: z.boolean(),
});

/** Edit a counsellor's name, or retire/reactivate them. */
export async function updateCounsellor(
  id: string,
  input: { name: string; active: boolean },
): Promise<CounsellorResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ name: parsed.data.name, active: parsed.data.active })
    .eq("id", id)
    .eq("role", "counsellor");
  if (error) return { ok: false, error: error.message };

  revalidatePath("/counsellors");
  return { ok: true };
}

/** Reset a counsellor's password to a new temporary one + re-arm the forced change. */
export async function resetCounsellorPassword(id: string, password: string): Promise<CounsellorResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return { ok: false, error: gate.error };
  if (password.length < 8) return { ok: false, error: "Temporary password must be at least 8 characters" };

  const admin = createAdminClient();
  const { error: authErr } = await admin.auth.admin.updateUserById(id, { password });
  if (authErr) return { ok: false, error: authErr.message };

  const { error: profErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", id);
  if (profErr) return { ok: false, error: profErr.message };

  revalidatePath("/counsellors");
  return { ok: true };
}
