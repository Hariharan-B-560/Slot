import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { VerifyCard, type VerifyCardData } from "@/components/verify/VerifyCard";
import { RecoverMissed, type RecoverRow } from "@/components/verify/RecoverMissed";

export const dynamic = "force-dynamic";

// Signed URLs are minted server-side with the admin's own session (anon key +
// cookies — the service_role key never reaches the browser). Storage RLS
// (evidence_admin_read_all) authorises the read. 60-min TTL: long enough for a
// review sitting, short enough that a leaked URL expires quickly.
const SIGNED_TTL_SECONDS = 60 * 60;

type Report = {
  attendance: string;
  absent_reason: string | null;
  opening_screenshot: string | null;
  closing_screenshot: string | null;
  recording: string | null;
  notes: string | null;
};

async function signed(supabase: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("session-evidence").createSignedUrl(path, SIGNED_TTL_SECONDS);
  return error ? null : data?.signedUrl ?? null;
}

export default async function VerifyPage() {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("classes")
    .select(
      "id, scheduled_start, status, flag_reason, teacher:profiles!classes_teacher_id_fkey(name), student:students(name), enrolment:enrolments!classes_enrolment_id_fkey(course), report:session_reports(attendance, absent_reason, opening_screenshot, closing_screenshot, recording, notes)",
    )
    .in("status", ["delivered", "flagged"])
    .order("scheduled_start", { ascending: false });

  // Recoverable: never-delivered classes whose window has passed, within the
  // last 3 days — the candidates for an admin retro-close. The RPC enforces the
  // exact grace + cap; this list is just the shortlist.
  const nowISO = new Date().toISOString();
  const threeDaysAgoISO = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: recData } = await supabase
    .from("classes")
    .select(
      "id, scheduled_start, status, teacher:profiles!classes_teacher_id_fkey(name), student:students(name)",
    )
    .in("status", ["published", "missed"])
    .lt("scheduled_end", nowISO)
    .gte("scheduled_start", threeDaysAgoISO)
    .order("scheduled_start", { ascending: false });

  const recoverable = ((recData ?? []) as unknown as {
    id: string;
    scheduled_start: string;
    status: string;
    teacher: { name: string } | null;
    student: { name: string } | null;
  }[]).map<RecoverRow>((c) => ({
    id: c.id,
    startISO: c.scheduled_start,
    teacherName: c.teacher?.name ?? "—",
    studentName: c.student?.name ?? "—",
    status: c.status,
  }));

  const rows = (data ?? []) as unknown as {
    id: string;
    scheduled_start: string;
    status: string;
    flag_reason: string | null;
    teacher: { name: string } | null;
    student: { name: string } | null;
    enrolment: { course: string } | null;
    // class_id is UNIQUE on session_reports → PostgREST returns a to-ONE embed
    // (a single object or null), NOT an array. Indexing it as an array was the
    // bug: the report was always dropped, so no evidence path ever reached the
    // signer and admin verified blind.
    report: Report | null;
  }[];

  const cards: VerifyCardData[] = await Promise.all(
    rows.map(async (r) => {
      const rep = r.report ?? null;
      return {
        id: r.id,
        scheduled_start: r.scheduled_start,
        status: r.status,
        flag_reason: r.flag_reason,
        teacherName: r.teacher?.name ?? "—",
        studentName: r.student?.name ?? "—",
        course: r.enrolment?.course ?? null,
        attendance: rep?.attendance ?? null,
        absentReason: rep?.absent_reason ?? null,
        notes: rep?.notes ?? null,
        openingUrl: await signed(supabase, rep?.opening_screenshot ?? null),
        closingUrl: await signed(supabase, rep?.closing_screenshot ?? null),
        recordingUrl: await signed(supabase, rep?.recording ?? null),
      };
    }),
  );

  return (
    <AppShell profile={profile} title="Verify" width="max-w-5xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Delivered classes awaiting verification, plus flagged ones. Only an admin can verify (rule 5) — and only once
        the evidence has loaded.
      </p>

      <RecoverMissed classes={recoverable} />

      {cards.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">Nothing to review.</p>
      ) : (
        <div className="space-y-4">
          {cards.map((r) => (
            <VerifyCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
