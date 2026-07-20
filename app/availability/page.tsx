import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { TimelineBoard, type TeacherRow, type Cell } from "@/components/availability/TimelineBoard";
import { AddWindow } from "@/components/availability/AddWindow";
import { OverridePanel, type OpenDate } from "@/components/availability/OverridePanel";
import { toMin, fromMin } from "@/lib/time";

export const dynamic = "force-dynamic";

type RawSlot = {
  slot_start: string;
  slot_end: string;
  is_free: boolean;
  fits: boolean;
  is_occupant_start: boolean;
  occupant_duration: number | null;
  student_name: string | null;
  enrolment_id: string | null;
};

const hhmm = (t: string) => t.slice(0, 5);

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ teacher?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const sp = await searchParams;

  const supabase = await createClient();

  // Which teachers are on screen? Admin landing = all; otherwise a single one.
  const single = profile.role === "teacher" || !!sp.teacher;
  let teacherList: { id: string; name: string }[];
  if (profile.role === "teacher") {
    teacherList = [{ id: profile.id, name: profile.name }];
  } else if (sp.teacher) {
    const { data } = await supabase.from("profiles").select("id, name").eq("id", sp.teacher).maybeSingle();
    teacherList = data ? [data as { id: string; name: string }] : [];
  } else {
    const { data } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("role", "teacher")
      .eq("active", true)
      .order("name");
    teacherList = (data ?? []) as { id: string; name: string }[];
  }

  // Free/taken/fits ALL come from the DB function — never recomputed here.
  // We ask twice: once for 30-min fit, once for 60-min fit (occupancy is the same).
  const perTeacher = await Promise.all(
    teacherList.map(async (t) => {
      const [{ data: d30 }, { data: d60 }] = await Promise.all([
        supabase.rpc("available_slots", { p_teacher: t.id, p_duration: 30 }),
        supabase.rpc("available_slots", { p_teacher: t.id, p_duration: 60 }),
      ]);
      const rows = (d30 ?? []) as RawSlot[];
      const fit60 = new Map(((d60 ?? []) as RawSlot[]).map((r) => [hhmm(r.slot_start), r.fits]));
      return { ...t, rows, fit60 };
    }),
  );

  // Shared, contiguous axis so strips line up and 60-spans render across atoms.
  const step = 30;
  const allStarts = perTeacher.flatMap((t) => t.rows.map((s) => toMin(hhmm(s.slot_start))));
  const allEnds = perTeacher.flatMap((t) => t.rows.map((s) => toMin(hhmm(s.slot_end))));
  const axis: string[] = [];
  if (allStarts.length > 0) {
    const from = Math.min(...allStarts);
    const to = Math.max(...allEnds);
    for (let m = from; m + step <= to; m += step) axis.push(fromMin(m));
  }

  const teachers: TeacherRow[] = perTeacher.map((t) => {
    const cells: Record<string, Cell> = {};
    for (const s of t.rows) {
      const key = hhmm(s.slot_start);
      cells[key] = s.is_free
        ? { kind: "free", fits30: s.fits, fits60: t.fit60.get(key) ?? false }
        : {
            kind: "taken",
            studentName: s.student_name ?? "Booked",
            enrolmentId: s.enrolment_id ?? "",
            occupantDuration: s.occupant_duration ?? 30,
            isOccupantStart: s.is_occupant_start,
            fits30: false,
            fits60: false,
          };
    }
    return {
      id: t.id,
      name: t.name,
      canEdit: profile.role === "admin" || t.id === profile.id,
      cells,
      taken: t.rows.filter((s) => !s.is_free).length,
      total: t.rows.length,
    };
  });

  const students =
    profile.role === "admin"
      ? ((await supabase.from("students").select("id, name").order("name")).data ?? [])
      : [];

  const only = teachers[0];

  // Admin-only, single-teacher view: upcoming one-off open dates (Saturdays etc).
  let openDates: OpenDate[] = [];
  if (single && profile.role === "admin" && only) {
    const { data } = await supabase
      .from("availability_overrides")
      .select("id, date, start_time, end_time, reason")
      .eq("teacher_id", only.id)
      .eq("kind", "open")
      .gte("date", new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()))
      .order("date");
    openDates = (data ?? []) as OpenDate[];
  }

  return (
    <AppShell profile={profile} title="Availability" width="max-w-5xl">
      {single ? (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-3">
            {profile.role === "admin" && (
              <Link href="/availability" className="text-sm text-muted-foreground underline">
                ← All teachers
              </Link>
            )}
            <span className="text-xl font-semibold">{only?.name}</span>
            <span className="text-lg font-semibold tabular-nums">
              {only?.taken ?? 0}/{only?.total ?? 0}
            </span>
            <span className="text-xs text-muted-foreground">
              {only?.total ? Math.round((only.taken / only.total) * 100) : 0}% utilised
            </span>
          </div>

          <TimelineBoard
            axis={axis}
            teachers={teachers}
            canPlace={profile.role === "admin"}
            students={students as { id: string; name: string }[]}
            showNames={false}
          />

          {only?.canEdit && (
            <div className="mt-6">
              <AddWindow teacherId={only.id} />
            </div>
          )}

          {profile.role === "admin" && only && (
            <div className="mt-6">
              <OverridePanel teacherId={only.id} opens={openDates} />
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            A demo came in? Pick the session length, then click a highlighted gap to place the student.
          </p>
          <TimelineBoard
            axis={axis}
            teachers={teachers}
            canPlace
            students={students as { id: string; name: string }[]}
            showNames
            linkTeachers
          />
        </>
      )}
    </AppShell>
  );
}
