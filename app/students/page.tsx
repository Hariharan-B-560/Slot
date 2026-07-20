import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { StudentManager } from "@/components/students/StudentManager";
import { courseLabel } from "@/lib/courses";
import { hhmm } from "@/lib/weekday";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const profile = await getCurrentProfile();

  if (!profile) return null;

  const supabase = await createClient();

  // --- Teacher: read-only list of students assigned to them ----------------
  if (profile.role === "teacher") {
    // RLS already limits students to this teacher's own; enrolments give slot/course.
    const [{ data: studentData }, { data: enrolData }] = await Promise.all([
      supabase.from("students").select("id, name, phone, status").order("name"),
      supabase
        .from("enrolments")
        .select("student_id, course, slot_start")
        .eq("teacher_id", profile.id)
        .eq("status", "active"),
    ]);
    const students = (studentData ?? []) as { id: string; name: string; phone: string | null; status: string }[];
    const enrolByStudent = new Map(
      ((enrolData ?? []) as { student_id: string; course: string; slot_start: string }[]).map((e) => [
        e.student_id,
        e,
      ]),
    );

    return (
      <AppShell profile={profile} title="My students" width="max-w-4xl">
        <p className="mb-4 text-sm text-muted-foreground">Students assigned to you. Read-only.</p>
        {students.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-muted-foreground">No students assigned yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Slot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => {
                  const e = enrolByStudent.get(s.id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.status}</Badge>
                      </TableCell>
                      <TableCell>{e ? <Badge variant="outline">{courseLabel(e.course)}</Badge> : "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {e ? `${hhmm(e.slot_start)} · open days` : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </AppShell>
    );
  }

  // --- Admin: full student management ---------------------------------------
  const { data } = await supabase.from("students").select("id, name, phone, status").order("name");

  return (
    <AppShell profile={profile} title="Students" width="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Add or edit student records. Placing a student into a slot and enrolling them happens on the{" "}
          <a href="/availability" className="underline">
            Availability
          </a>{" "}
          grid.
        </p>
        <a
          href="/students/import"
          className="shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Import existing student →
        </a>
      </div>
      <StudentManager students={(data ?? []) as { id: string; name: string; phone: string | null; status: string }[]} />
    </AppShell>
  );
}
