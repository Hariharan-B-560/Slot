import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { courseLabel } from "@/lib/courses";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// Availability answers capacity (weekly pattern). Classes answers what actually
// happened: real class INSTANCES by date, with their delivery status.

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "2-digit",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  verified: "default",
  delivered: "secondary",
  published: "outline",
  missed: "outline",
  flagged: "destructive",
};

type Row = {
  id: string;
  scheduled_start: string;
  status: string;
  slot_type: string;
  teacher: { name: string } | null;
  student: { name: string } | null;
  enrolment: { course: string } | null;
};

export default async function ClassesPage() {
  const profile = await getCurrentProfile();

  if (!profile) return null;

  const supabase = await createClient();

  // RLS scopes this: a teacher sees only their own instances, an admin sees all.
  // Read-only history — no one hand-creates classes here.
  const { data } = await supabase
    .from("classes")
    .select(
      "id, scheduled_start, status, slot_type, teacher:profiles!classes_teacher_id_fkey(name), student:students(name), enrolment:enrolments!classes_enrolment_id_fkey(course)",
    )
    .order("scheduled_start", { ascending: false });

  const rows = (data ?? []) as unknown as Row[];

  // Group instances by their IST calendar date.
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const key = dayKeyFmt.format(new Date(r.scheduled_start));
    const list = byDay.get(key) ?? [];
    list.push(r);
    byDay.set(key, list);
  }
  const days = [...byDay.keys()].sort().reverse();

  return (
    <AppShell profile={profile} title={profile.role === "teacher" ? "Class history" : "Classes"} width="max-w-4xl">
      <p className="mb-6 text-sm text-muted-foreground">
        Class instances by date, and what happened to each — read-only.
        {profile.role === "teacher" ? (
          <>
            {" "}
            Deliver today&apos;s classes on{" "}
            <a href="/deliver" className="underline">
              Today&apos;s classes
            </a>
            .
          </>
        ) : (
          <>
            {" "}
            Weekly capacity and placement live on{" "}
            <a href="/availability" className="underline">
              Availability
            </a>
            .
          </>
        )}
      </p>

      {days.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">No class instances yet.</p>
      ) : (
        <div className="space-y-6">
          {days.map((day) => (
            <div key={day}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {dateFmt.format(new Date(day + "T00:00:00+05:30"))}
              </h2>
              <div className="space-y-2">
                {byDay.get(day)!.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2 text-sm"
                  >
                    <span className="font-medium tabular-nums">{timeFmt.format(new Date(c.scheduled_start))}</span>
                    <span>{c.student?.name ?? "—"}</span>
                    {profile.role === "admin" && (
                      <span className="text-muted-foreground">· {c.teacher?.name ?? "—"}</span>
                    )}
                    <Badge variant="outline">
                      {c.enrolment ? courseLabel(c.enrolment.course) : c.slot_type.toLowerCase()}
                    </Badge>
                    <Badge variant={statusVariant[c.status] ?? "outline"} className="ml-auto">
                      {c.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
