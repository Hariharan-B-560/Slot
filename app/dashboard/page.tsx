import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/current-user";
import { AppShell } from "@/components/AppShell";
import { DateRangeControl } from "@/components/DateRangeControl";
import { AttentionLists, type Renewal, type Risk, type Backlog, type LongPaused } from "@/components/dashboard/AttentionLists";
import { UtilisationChart, type UtilisationRow } from "@/components/UtilisationChart";
import { TrendChart, type TrendRow } from "@/components/dashboard/TrendChart";
import { parseRange, previousRange, previousLabel, delta } from "@/lib/date-range";

export const dynamic = "force-dynamic";

type Headline = { utilisation: number; delivered: number; verified: number; active_students: number };
type Money = { received: number; outstanding: number; arrears: number };

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** One headline number with its "vs previous period" delta underneath. */
function Metric({
  label,
  value,
  change,
  suffix,
}: {
  label: string;
  value: number | string;
  change: number | null;
  suffix: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-card p-4">
      <div className="text-3xl font-semibold tabular-nums sm:text-4xl">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {change == null ? (
          <span>no prior data</span>
        ) : (
          <span>
            {change > 0 ? "↑" : change < 0 ? "↓" : "→"} {Math.abs(change)}% {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>;
}) {
  const profile = await getCurrentProfile();
  // Admin-only. The route is also blocked in middleware — this is defence in
  // depth, and every metric function is RLS-guarded on top.
  if (!profile || profile.role !== "admin") return null;

  const sp = await searchParams;
  const range = parseRange(sp);
  const prev = previousRange(range);
  const supabase = await createClient();

  const [now, before, renewalsRes, risksRes, backlogRes, integrityRes, moneyRes, utilRes, trendRes, longPausedRes] =
    await Promise.all([
      supabase.rpc("dashboard_headline", { p_start: range.from, p_end: range.to }),
      supabase.rpc("dashboard_headline", { p_start: prev.from, p_end: prev.to }),
      supabase.rpc("dashboard_renewals"),
      supabase.rpc("dashboard_attendance_risk"),
      supabase.rpc("dashboard_verify_backlog"),
      supabase.rpc("integrity_summary", { p_start: range.from, p_end: range.to }),
      supabase.rpc("dashboard_money", { p_start: range.from, p_end: range.to }),
      supabase.rpc("dashboard_utilisation", { p_start: range.from, p_end: range.to }),
      supabase.rpc("dashboard_trend", { p_start: range.from, p_end: range.to }),
      supabase.rpc("dashboard_long_paused"),
    ]);

  const zero: Headline = { utilisation: 0, delivered: 0, verified: 0, active_students: 0 };
  const h = ((now.data ?? [])[0] as Headline) ?? zero;
  const p = ((before.data ?? [])[0] as Headline) ?? zero;
  const renewals = (renewalsRes.data ?? []) as Renewal[];
  const risks = (risksRes.data ?? []) as Risk[];
  const backlog = ((backlogRes.data ?? [])[0] as Backlog) ?? { cnt: 0, oldest: null };
  const integrity = ((integrityRes.data ?? [])[0] as { concerning_teachers: number; flagged_classes: number }) ?? {
    concerning_teachers: 0,
    flagged_classes: 0,
  };
  const money = ((moneyRes.data ?? [])[0] as Money) ?? { received: 0, outstanding: 0, arrears: 0 };
  const util = (utilRes.data ?? []) as UtilisationRow[];
  const trend = (trendRes.data ?? []) as TrendRow[];
  const longPaused = (longPausedRes.data ?? []) as LongPaused[];

  const vs = previousLabel(range);
  const utilPct = Math.round(Number(h.utilisation) * 100);
  const prevUtilPct = Math.round(Number(p.utilisation) * 100);
  const concerning = integrity.concerning_teachers > 0 || integrity.flagged_classes > 0;

  return (
    <AppShell profile={profile} title="Dashboard" width="max-w-6xl">
      <div className="mb-6">
        <DateRangeControl path="/dashboard" range={range} />
      </div>

      {/* 1 — Operational health */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row">
        <Metric label="Utilisation" value={`${utilPct}%`} change={delta(utilPct, prevUtilPct)} suffix={vs} />
        <Metric label="Classes delivered" value={h.delivered} change={delta(h.delivered, p.delivered)} suffix={vs} />
        <Metric label="Classes verified" value={h.verified} change={delta(h.verified, p.verified)} suffix={vs} />
        <Metric
          label="Active students"
          value={h.active_students}
          change={delta(h.active_students, p.active_students)}
          suffix={vs}
        />
      </div>

      {/* 2 — Who needs attention */}
      <h2 className="mb-3 text-sm font-semibold">Who needs attention</h2>
      <div className="mb-8">
        <AttentionLists renewals={renewals} risks={risks} backlog={backlog} longPaused={longPaused} />
      </div>

      {/* 3 — Performance charts (both driven by the selected range) */}
      <div className="mb-8 flex flex-col gap-4 xl:flex-row">
        <section className="min-w-0 flex-1 rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Availability vs verified hours, per teacher</h2>
          <UtilisationChart data={util} />
        </section>
        <section className="min-w-0 flex-1 rounded-lg border bg-card p-4">
          <h2 className="mb-1 text-sm font-semibold">Delivered vs verified over time</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            A widening gap between the lines is the drift worth checking on Integrity.
          </p>
          <TrendChart data={trend} />
        </section>
      </div>

      {/* 4 — Integrity strip */}
      {concerning ? (
        <Link
          href="/integrity"
          className="mb-8 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          Integrity — {integrity.concerning_teachers} teacher
          {integrity.concerning_teachers === 1 ? "" : "s"} with concerning gap ·{" "}
          {integrity.flagged_classes} flagged class{integrity.flagged_classes === 1 ? "" : "es"}
          <span className="ml-auto">→</span>
        </Link>
      ) : (
        <div className="mb-8 rounded-lg border bg-card px-4 py-2.5 text-sm text-emerald-700">
          Integrity — 0 flags this period ✓
        </div>
      )}

      {/* 5 — Money */}
      <h2 className="mb-3 text-sm font-semibold">Money</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">₹{inr.format(Number(money.received))}</div>
          <div className="text-xs text-muted-foreground">Received in range</div>
        </div>
        <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
          <div className="text-xl font-semibold tabular-nums">₹{inr.format(Number(money.outstanding))}</div>
          <div className="text-xs text-muted-foreground">Outstanding (active enrolments)</div>
        </div>
        <Link href="/roster" className="min-w-0 flex-1 rounded-lg border bg-card p-3 hover:bg-muted/40">
          <div className={`text-xl font-semibold tabular-nums ${money.arrears > 0 ? "text-amber-600" : ""}`}>
            {money.arrears}
          </div>
          <div className="text-xs text-muted-foreground">In arrears &gt;30 days · view roster →</div>
        </Link>
      </div>
    </AppShell>
  );
}
