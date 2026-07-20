import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { PaymentsPanel, type PaymentRow, type PaymentStatus } from "@/components/roster/PaymentsPanel";
import { totalSessions, remaining, type Enrolment } from "@/lib/roster";
import { hhmm } from "@/lib/weekday";
import { fmtIST } from "@/lib/datetime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  verified: "default",
  delivered: "secondary",
  published: "outline",
  missed: "outline",
  flagged: "destructive",
};

export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const profile = await getCurrentProfile();

  if (!profile || profile.role !== "admin") return null;

  const supabase = await createClient();
  const { data: student } = await supabase
    .from("students")
    .select("id, name, phone, status")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) notFound();

  const [{ data: enrols }, { data: classes }] = await Promise.all([
    supabase
      .from("enrolments")
      .select(
        "id, slot_start, start_date, end_date, total_sessions, sessions_already_delivered, migrated_from_legacy, status, teacher:profiles!enrolments_teacher_id_fkey(name)",
      )
      .eq("student_id", studentId)
      .order("start_date", { ascending: false }),
    supabase
      .from("classes")
      .select("id, enrolment_id, scheduled_start, status")
      .eq("student_id", studentId)
      .order("scheduled_start", { ascending: false }),
  ]);

  const enrolRows = (enrols ?? []) as unknown as (Enrolment & {
    id: string;
    status: string;
    migrated_from_legacy: boolean;
    teacher: { name: string } | null;
  })[];
  const classRows = (classes ?? []) as {
    id: string;
    enrolment_id: string | null;
    scheduled_start: string;
    status: string;
  }[];
  const delivered = classRows.filter((c) => c.status === "delivered" || c.status === "verified").length;
  const deliveredByEnrol = new Map<string, number>();
  for (const c of classRows) {
    if ((c.status === "delivered" || c.status === "verified") && c.enrolment_id) {
      deliveredByEnrol.set(c.enrolment_id, (deliveredByEnrol.get(c.enrolment_id) ?? 0) + 1);
    }
  }

  // Payments (admin RLS) + derived status per enrolment — never a stored paid/remaining.
  const enrolIds = enrolRows.map((e) => e.id);
  const [{ data: payData }, { data: statusData }] = await Promise.all([
    supabase
      .from("payments")
      .select("id, enrolment_id, amount, paid_at, note, recorder:profiles!payments_recorded_by_fkey(name)")
      .in("enrolment_id", enrolIds.length ? enrolIds : ["00000000-0000-0000-0000-000000000000"])
      .order("paid_at", { ascending: false }),
    supabase.rpc("enrolment_payment_status"), // p_enrolment null → all enrolments (admin only)
  ]);
  const payByEnrol = new Map<string, PaymentRow[]>();
  for (const p of (payData ?? []) as unknown as {
    id: string; enrolment_id: string; amount: number; paid_at: string; note: string | null; recorder: { name: string } | null;
  }[]) {
    const row: PaymentRow = { id: p.id, amount: Number(p.amount), paid_at: p.paid_at, note: p.note, recordedBy: p.recorder?.name ?? null };
    payByEnrol.set(p.enrolment_id, [...(payByEnrol.get(p.enrolment_id) ?? []), row]);
  }
  const statusByEnrol = new Map<string, PaymentStatus>();
  for (const s of (statusData ?? []) as { enrolment_id: string; total_fee: number | null; paid: number; remaining: number | null }[]) {
    statusByEnrol.set(s.enrolment_id, {
      total_fee: s.total_fee == null ? null : Number(s.total_fee),
      paid: Number(s.paid),
      remaining: s.remaining == null ? null : Number(s.remaining),
    });
  }
  const todayISO = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  return (
    <AppShell profile={profile} title={student.name} width="max-w-4xl">

      <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
        <Link href="/roster" className="underline">
          ← Roster
        </Link>
        <span>·</span>
        <span>{student.phone ?? "no phone"}</span>
        <Badge variant="secondary">{student.status}</Badge>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Enrolments</CardTitle>
        </CardHeader>
        <CardContent>
          {enrolRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enrolments.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {enrolRows.map((e) => {
                const total = totalSessions(e);
                const legacy = e.sessions_already_delivered ?? 0;
                const app = deliveredByEnrol.get(e.id) ?? 0;
                const left = remaining(e, app);
                return (
                  <li key={e.id} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {e.teacher?.name ?? "—"} · {hhmm(e.slot_start)} · open days
                      {e.migrated_from_legacy && (
                        <Badge variant="outline" className="text-[10px]">
                          Migrated
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      from {e.start_date}
                      {e.end_date ? ` to ${e.end_date}` : ""} ·{" "}
                      {total != null ? `${total} sessions` : "open (by count)"} · {e.status}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {legacy > 0 ? (
                        <>
                          {legacy} legacy + {app} here = <strong>{legacy + app}</strong>
                          {total != null ? ` of ${total}` : ""}
                        </>
                      ) : (
                        <>
                          {app} delivered{total != null ? ` of ${total}` : ""}
                        </>
                      )}
                      {left != null && (
                        <>
                          {" · "}
                          <strong>{left} remaining</strong>
                        </>
                      )}
                    </div>

                    <PaymentsPanel
                      enrolmentId={e.id}
                      status={statusByEnrol.get(e.id) ?? { total_fee: null, paid: 0, remaining: null }}
                      payments={payByEnrol.get(e.id) ?? []}
                      today={todayISO}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        Class history — {delivered} delivered/verified of {classRows.length}
      </h2>
      {classRows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">No classes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (IST)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classRows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="tabular-nums">{fmtIST(c.scheduled_start)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[c.status] ?? "outline"}>{c.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppShell>
  );
}
