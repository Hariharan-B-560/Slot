import Link from "next/link";
import { shortDate } from "@/lib/roster";

// Section 2 — the reason admin opens the dashboard. Three short, actionable
// lists; every row clicks through to the record you'd act on. Empty is a good
// outcome, so empty states say so rather than showing a bare dash.

export type Renewal = { student_id: string; student: string; teacher: string; sessions_left: number; phone: string | null };
export type Risk = { student_id: string; student: string; teacher: string; last_class_at: string | null };
export type Backlog = { cnt: number; oldest: string | null };

function Panel({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-emerald-700">{children}</p>
);

export function AttentionLists({
  renewals,
  risks,
  backlog,
}: {
  renewals: Renewal[];
  risks: Risk[];
  backlog: Backlog;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <Panel title="Renewal window" hint="3 or fewer sessions left — call to renew">
        {renewals.length === 0 ? (
          <Empty>No students need renewal calls this week ✓</Empty>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {renewals.slice(0, 8).map((r) => (
              <li key={r.student_id}>
                <Link href={`/roster/${r.student_id}`} className="flex items-baseline gap-2 hover:underline">
                  <span className="font-medium">{r.student}</span>
                  <span className="tabular-nums text-amber-600">{r.sessions_left} left</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.phone ?? r.teacher}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Attendance risk" hint="No delivered class in the last 7 days">
        {risks.length === 0 ? (
          <Empty>Everyone attended in the last week ✓</Empty>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {risks.slice(0, 8).map((r) => (
              <li key={r.student_id}>
                <Link href={`/roster/${r.student_id}`} className="flex items-baseline gap-2 hover:underline">
                  <span className="font-medium">{r.student}</span>
                  <span className="text-xs text-muted-foreground">{r.teacher}</span>
                  <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                    {r.last_class_at ? shortDate(r.last_class_at.slice(0, 10)) : "never"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Verify backlog" hint="Delivered over 48h ago, still unverified">
        {backlog.cnt === 0 ? (
          <Empty>Nothing waiting to be verified ✓</Empty>
        ) : (
          <Link href="/verify" className="block hover:underline">
            <div className="text-3xl font-semibold tabular-nums text-amber-600">{backlog.cnt}</div>
            <div className="text-xs text-muted-foreground">
              oldest {backlog.oldest ? shortDate(backlog.oldest.slice(0, 10)) : "—"} · go to Verify →
            </div>
          </Link>
        )}
      </Panel>
    </div>
  );
}
