import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { TeacherManager, type Teacher } from "@/components/teachers/TeacherManager";

export const dynamic = "force-dynamic";

export default async function TeachersPage() {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name, email, active")
    .eq("role", "teacher")
    .order("name");

  return (
    <AppShell profile={profile} title="Teachers" width="max-w-4xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Add a teacher, rename them, or retire them. A teacher is never deleted — their classes are an append-only
        ledger. Retiring removes them from the availability views and from new placements.
      </p>
      <TeacherManager teachers={(data ?? []) as Teacher[]} />
    </AppShell>
  );
}
