import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { totalSessions, remaining, shortDate, type Enrolment } from "@/lib/roster";
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

type EnrolRow = Enrolment & {
  id: string;
  student_id: string;
  status: string;
  paused_at: string | null;
  migrated_from_legacy: boolean;
  teacher: { name: string } | null;
};

export default async function RosterPage() {
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const [{ data: students }, { data: enrols }, { data: classes }] = await Promise.all([
    supabase.from("students").select("id, name, phone, status").order("name"),
    supabase
      .from("enrolments")
      .select(
        "id, student_id, slot_start, start_date, end_date, total_sessions, sessions_already_delivered, migrated_from_legacy, status, paused_at, teacher:profiles!enrolments_teacher_id_fkey(name)",
      )
      .in("status", ["active", "paused"]),
    supabase.from("classes").select("enrolment_id, status").not("enrolment_id", "is", null),
  ]);

  // Payment status per enrolment (admin-only derived reader) — for the pending
  // chip. Never blocks anything; just warns.
  const { data: payStatus } = await supabase.rpc("enrolment_payment_status");
  const remainingByEnrol = new Map<string, number | null>();
  for (const s of (payStatus ?? []) as { enrolment_id: string; remaining: number | null }[]) {
    remainingByEnrol.set(s.enrolment_id, s.remaining == null ? null : Number(s.remaining));
  }
  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86_400_000);

  const studentRows = (students ?? []) as { id: string; name: string; phone: string | null; status: string }[];
  const enrolRows = (enrols ?? []) as unknown as EnrolRow[];
  const classRows = (classes ?? []) as { enrolment_id: string; status: string }[];

  const enrolByStudent = new Map(enrolRows.map((e) => [e.student_id, e]));
  const deliveredByEnrol = new Map<string, number>();
  for (const c of classRows) {
    if (c.status === "delivered" || c.status === "verified") {
      deliveredByEnrol.set(c.enrolment_id, (deliveredByEnrol.get(c.enrolment_id) ?? 0) + 1);
    }
  }

  return (
    <AppShell profile={profile} title="Student roster" width="max-w-6xl">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Teacher</TableHead>
              <TableHead>Slot</TableHead>
              <TableHead className="text-right">Classes</TableHead>
              <TableHead className="text-right">Delivered</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {studentRows.map((s) => {
              const e = enrolByStudent.get(s.id);
              const total = e ? totalSessions(e) : null;
              const deliveredApp = e ? deliveredByEnrol.get(e.id) ?? 0 : 0;
              const legacy = e?.sessions_already_delivered ?? 0;
              const left = e ? remaining(e, deliveredApp) : null;
              const owed = e ? remainingByEnrol.get(e.id) ?? null : null;
              const paymentPending = e != null && owed != null && owed > 0 && daysSince(e.start_date) > 7;
              return (
                <TableRow key={s.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/roster/${s.id}`} className="hover:underline">
                      {s.name}
                    </Link>
                    {e?.migrated_from_legacy && (
                      <Badge variant="outline" className="ml-2 align-middle text-[10px]">
                        Migrated
                      </Badge>
                    )}
                    {e?.status === "paused" && (
                      <Badge className="ml-2 align-middle bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                        PAUSED{e.paused_at ? ` · ${shortDate(e.paused_at.slice(0, 10))}` : ""}
                      </Badge>
                    )}
                    {paymentPending && (
                      <Badge className="ml-2 align-middle bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                        Payment pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{s.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{s.status}</Badge>
                  </TableCell>
                  <TableCell>{e?.teacher?.name ?? "—"}</TableCell>
                  <TableCell>
                    {e ? (
                      <span className="tabular-nums">
                        {hhmm(e.slot_start)} · open days
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{total ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e ? (
                      legacy > 0 ? (
                        <span title={`${legacy} legacy + ${deliveredApp} in-app`}>
                          {deliveredApp} <span className="text-muted-foreground">(+{legacy} legacy)</span>
                        </span>
                      ) : (
                        deliveredApp
                      )
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{left ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
