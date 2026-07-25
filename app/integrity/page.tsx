import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { DateRangeControl } from "@/components/DateRangeControl";
import { parseRange } from "@/lib/date-range";
import { fmtIST } from "@/lib/datetime";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeacherPayTable, type PayRow } from "@/components/integrity/TeacherPayTable";

export const dynamic = "force-dynamic";

type Row = {
  teacher_id: string;
  teacher: string;
  utilisation: number;
  delivered: number;
  verified: number;
  gap: number;
  gap_pct: number;
  flagged: number;
  concerning: boolean;
};

export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return null;

  const sp = await searchParams;
  const range = parseRange(sp);
  const supabase = await createClient();

  const [byTeacher, flagged, pay] = await Promise.all([
    supabase.rpc("integrity_by_teacher", { p_start: range.from, p_end: range.to }),
    supabase
      .from("classes")
      .select("id, scheduled_start, flag_reason, teacher:profiles!classes_teacher_id_fkey(name), student:students(name)")
      .eq("status", "flagged")
      .gte("scheduled_start", range.from)
      .lt("scheduled_start", range.to + "T23:59:59")
      .order("scheduled_start", { ascending: false })
      .limit(10),
    supabase.rpc("teacher_pay_all", { p_from: range.from, p_to: range.to }),
  ]);

  const rows = (byTeacher.data ?? []) as Row[];
  const payRows = (pay.data ?? []) as PayRow[];
  const flaggedRows = (flagged.data ?? []) as unknown as {
    id: string;
    scheduled_start: string;
    flag_reason: string | null;
    teacher: { name: string } | null;
    student: { name: string } | null;
  }[];

  return (
    <AppShell profile={profile} title="Integrity" width="max-w-5xl">
      <div className="mb-4">
        <DateRangeControl path="/integrity" range={range} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Delivered-but-never-verified is the fabrication signal. Rows are ranked by that gap; amber means a gap of 20%
        or more, or 3+ flagged classes in range.
      </p>

      <div className="mb-8 overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teacher</TableHead>
              <TableHead className="text-right">Utilisation</TableHead>
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Verified</TableHead>
              <TableHead className="text-right">Gap</TableHead>
              <TableHead className="text-right">Flagged</TableHead>
              <TableHead className="text-right" title="Rejected out-of-window delivery attempts are not recorded yet">
                OOW attempts
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No teacher activity in this range.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.teacher_id} className={r.concerning ? "bg-amber-50" : undefined}>
                  <TableCell className="font-medium">
                    {r.teacher}
                    {r.concerning && (
                      <Badge className="ml-2 bg-amber-500 text-[10px] text-white hover:bg-amber-500">review</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(Number(r.utilisation) * 100)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.verified}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${r.concerning ? "font-semibold text-amber-700" : ""}`}
                  >
                    {r.gap} ({Number(r.gap_pct)}%)
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.flagged}</TableCell>
                  {/* No attempt log exists yet — the rule-1 trigger rejects and discards. */}
                  <TableCell className="text-right text-muted-foreground" title="Not tracked yet">
                    —
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">Teacher pay</h2>
        <span className="text-xs text-muted-foreground">Verified classes only · what&apos;s owed for this range</span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Pay counts 30-min atoms (a 60-min class is 2) on <strong>verified</strong> classes — delivered-but-unverified
        pays nothing. Uses each teacher&apos;s current rate; recent rate changes may need a manual adjustment for
        classes verified before the change. Excel export (Teacher Pay sheet) arrives with the export batch.
      </p>
      <div className="mb-8">
        <TeacherPayTable rows={payRows} />
      </div>

      <h2 className="mb-3 text-sm font-semibold">Recent flagged classes</h2>
      {flaggedRows.length === 0 ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-emerald-700">No flagged classes in this range ✓</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (IST)</TableHead>
                <TableHead>Teacher</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flaggedRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="tabular-nums">
                    <Link href="/verify" className="hover:underline">
                      {fmtIST(c.scheduled_start)}
                    </Link>
                  </TableCell>
                  <TableCell>{c.teacher?.name ?? "—"}</TableCell>
                  <TableCell>{c.student?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.flag_reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
