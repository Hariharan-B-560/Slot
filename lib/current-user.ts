import { createClient } from "@/lib/supabase/server";

export type Profile = { id: string; name: string; role: "admin" | "teacher" | "counsellor" };

/**
 * The signed-in user's profile (id, name, role), or null if not signed in.
 * Role drives what the availability screen shows and lets you do.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, name, role")
    .eq("id", user.id)
    .single();

  return (data as Profile) ?? null;
}
