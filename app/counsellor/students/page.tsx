import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { StudentManager } from "@/components/students/StudentManager";

export const dynamic = "force-dynamic";

// Read-only, searchable student list for counsellors. Reuses the admin manager
// with readOnly — no add/edit surfaces render, and writes are denied by RLS.
export default async function CounsellorStudentsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("students").select("id, name, phone, status").order("name");
  const students = (data ?? []) as { id: string; name: string; phone: string | null; status: string }[];

  return (
    <AppShell profile={profile} title="Students" width="max-w-4xl">
      <StudentManager students={students} readOnly />
    </AppShell>
  );
}
