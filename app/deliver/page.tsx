import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { DeliverToday, type ClassRow } from "@/components/deliver/DeliverToday";

export const dynamic = "force-dynamic";

// Mirrors the DB's delivery_grace() (1h30m) — keep the two in sync.
const GRACE_MS = 90 * 60 * 1000;

export default async function DeliverPage() {
  const profile = await getCurrentProfile();

  if (!profile) return null;
  if (profile.role !== "teacher") {
    return (
      <AppShell profile={profile} title="Today's classes" width="max-w-3xl">
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">
          Delivering classes and filing session reports is for <strong>teacher</strong> accounts.
        </p>
      </AppShell>
    );
  }

  const supabase = await createClient();

  // Today's window in Asia/Kolkata, expressed as UTC bounds.
  const istToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const dayStart = new Date(`${istToday}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("classes")
    .select("id, scheduled_start, scheduled_end, status, student:students(name), enrolment:enrolments!classes_enrolment_id_fkey(course)")
    .gte("scheduled_start", dayStart.toISOString())
    .lt("scheduled_start", dayEnd.toISOString())
    .order("scheduled_start");

  const now = Date.now();
  const classes: ClassRow[] = ((data ?? []) as unknown as {
    id: string;
    scheduled_start: string;
    scheduled_end: string;
    status: string;
    student: { name: string } | null;
    enrolment: { course: string } | null;
  }[]).map((c) => {
    const start = new Date(c.scheduled_start).getTime();
    const end = new Date(c.scheduled_end).getTime();
    return {
      id: c.id,
      startISO: c.scheduled_start,
      endISO: c.scheduled_end,
      studentName: c.student?.name ?? "—",
      course: c.enrolment?.course ?? null,
      status: c.status,
      inWindow: now >= start && now <= end + GRACE_MS,
    };
  });

  return (
    <AppShell profile={profile} title="Today's classes" width="max-w-3xl">
      <p className="mb-4 text-sm text-muted-foreground">
        You can file a report and deliver a class only inside its window (from start until 1½ hours after end). The
        database enforces this — and requires both screenshots.
      </p>
      <DeliverToday classes={classes} />
    </AppShell>
  );
}
