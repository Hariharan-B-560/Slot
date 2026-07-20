import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { RescheduleQueue, type RequestRow } from "@/components/reschedules/RescheduleQueue";

export const dynamic = "force-dynamic";

export default async function ReschedulesPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  // Pending requests joined to their class (current time, teacher, student, course).
  const { data } = await supabase
    .from("reschedule_requests")
    .select(
      "id, class_id, reason, proposed_start, requested_at, " +
        "class:classes!reschedule_requests_class_id_fkey(scheduled_start, " +
        "teacher:profiles!classes_teacher_id_fkey(name), student:students(name), " +
        "enrolment:enrolments!classes_enrolment_id_fkey(course))",
    )
    .eq("status", "pending")
    .order("requested_at", { ascending: true });

  const rows: RequestRow[] = (
    (data ?? []) as unknown as {
      id: string;
      class_id: string;
      reason: string;
      proposed_start: string | null;
      class: {
        scheduled_start: string;
        teacher: { name: string } | null;
        student: { name: string } | null;
        enrolment: { course: string } | null;
      } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    classId: r.class_id,
    currentStart: r.class?.scheduled_start ?? "",
    proposedStart: r.proposed_start,
    reason: r.reason,
    teacherName: r.class?.teacher?.name ?? "—",
    studentName: r.class?.student?.name ?? "—",
    course: r.class?.enrolment?.course ?? null,
  }));

  return (
    <AppShell profile={profile} title="Reschedule requests" width="max-w-3xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Teachers request; you decide. Approving moves the original class (no duplicate) and is audited. Delivered
        classes can&apos;t be moved.
      </p>
      <RescheduleQueue rows={rows} />
    </AppShell>
  );
}
