import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { CounsellorManager, type Counsellor } from "@/components/counsellors/CounsellorManager";

export const dynamic = "force-dynamic";

export default async function CounsellorsPage() {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name, email, active")
    .eq("role", "counsellor")
    .order("name");

  return (
    <AppShell profile={profile} title="Counsellors" width="max-w-4xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Add a counsellor, rename them, or retire them. Counsellors get a read-only view of availability, students, and
        fee details — they can look, but change nothing.
      </p>
      <CounsellorManager counsellors={(data ?? []) as Counsellor[]} />
    </AppShell>
  );
}
