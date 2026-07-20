import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { ImportLegacyForm } from "@/components/students/ImportLegacyForm";

export const dynamic = "force-dynamic";

export default async function ImportStudentPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("role", "teacher")
    .eq("active", true)
    .order("name");
  const teachers = (data ?? []) as { id: string; name: string }[];

  // App start defaults to today, in IST (the app's operating timezone).
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <AppShell profile={profile} title="Import existing student" width="max-w-3xl">
      <p className="mb-4 text-sm text-muted-foreground">
        <Link href="/students" className="underline">
          ← Students
        </Link>
      </p>
      <ImportLegacyForm teachers={teachers} today={today} />
    </AppShell>
  );
}
