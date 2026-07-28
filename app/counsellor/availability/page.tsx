import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { TimelineBoard, type TeacherRow, type Cell } from "@/components/availability/TimelineBoard";
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
  occupant_paused: boolean | null;
};

const hhmm = (t: string) => t.slice(0, 5);

// Read-only, all-teachers overview for counsellors. The same DB function
// (available_slots) powers the admin grid — occupancy ("slot taken by X") comes
// straight from it; nothing here is placeable or editable.
export default async function CounsellorAvailabilityPage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();

  // profiles is admin/own-row only; this SECURITY DEFINER RPC returns just the
  // id + name of active teachers to a counsellor (no rate/email leak).
  const { data: teacherData } = await supabase.rpc("counsellor_teacher_list");
  const teacherList = (teacherData ?? []) as { id: string; name: string }[];

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
            paused: s.occupant_paused ?? false,
            fits30: false,
            fits60: false,
          };
    }
    return {
      id: t.id,
      name: t.name,
      canEdit: false, // counsellors never edit availability
      cells,
      taken: t.rows.filter((s) => !s.is_free).length,
      total: t.rows.length,
    };
  });

  return (
    <AppShell profile={profile} title="Availability" width="max-w-5xl">
      <p className="mb-4 text-sm text-muted-foreground">
        A read-only view of every teacher&apos;s day — free atoms and who each taken slot belongs to.
      </p>
      <TimelineBoard axis={axis} teachers={teachers} canPlace={false} students={[]} showNames readOnly />
    </AppShell>
  );
}
