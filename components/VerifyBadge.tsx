"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Pending-verify badge: classes with status IN ('delivered','flagged') — the
// exact set the Verify page renders. Count is read through the caller's own
// session, so RLS applies; the hook is only enabled for admins anyway.
// Refresh: on route change + a light 60s poll (no realtime is wired in this
// app, and a badge doesn't justify adding it). Optimistic updates arrive via
// a window event so the Verify page can decrement without a refetch.

const EVT = "pending-verify:update";

type Delta = { delta: number; flagged?: boolean };

/** Optimistically adjust the badge (e.g. -1 after a verify, flagged=true after a flag). */
export function bumpPendingVerify(delta: number, flagged?: boolean) {
  window.dispatchEvent(new CustomEvent<Delta>(EVT, { detail: { delta, flagged } }));
}

// --- pending reschedule requests (the Reschedules nav badge) ----------------
const RESCHED_EVT = "pending-reschedule:update";

/** Optimistically adjust the reschedule badge (e.g. { reschedule: -1 } after a decision). */
export function bumpPending(d: { reschedule?: number }) {
  if (d.reschedule) window.dispatchEvent(new CustomEvent<{ delta: number }>(RESCHED_EVT, { detail: { delta: d.reschedule } }));
}

// --- integrity: a DOT, never a count ----------------------------------------
// A number invites normalisation ("oh, 3 again"); a dot just says "go look".
// Scoped to the current month so it reflects live behaviour, not history.
export function useIntegrityAlert(enabled: boolean) {
  const pathname = usePathname();
  const [alert, setAlert] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    async function load() {
      const supabase = createClient();
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      const { data } = await supabase.rpc("integrity_summary", { p_start: from, p_end: to });
      const row = (data ?? [])[0] as { concerning_teachers: number; flagged_classes: number } | undefined;
      if (alive) setAlert(!!row && (row.concerning_teachers > 0 || row.flagged_classes > 0));
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, pathname]);

  return alert;
}

/** Bare amber dot — deliberately countless. */
export function IntegrityDot({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden className="badge-in ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" />;
}

export function usePendingReschedules(enabled: boolean) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    async function load() {
      const supabase = createClient();
      const { count: c } = await supabase
        .from("reschedule_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (alive) setCount(c ?? 0);
    }
    load();
    const timer = setInterval(load, 60_000);
    const onUpdate = (e: Event) => {
      const d = (e as CustomEvent<{ delta: number }>).detail;
      setCount((n) => Math.max(0, n + (d?.delta ?? 0)));
    };
    window.addEventListener(RESCHED_EVT, onUpdate);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(RESCHED_EVT, onUpdate);
    };
  }, [enabled, pathname]);

  return count;
}

export function usePendingVerify(enabled: boolean) {
  const pathname = usePathname();
  const [state, setState] = useState<{ count: number; flagged: boolean }>({ count: 0, flagged: false });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    async function load() {
      const supabase = createClient();
      const [all, fl] = await Promise.all([
        supabase.from("classes").select("id", { count: "exact", head: true }).in("status", ["delivered", "flagged"]),
        supabase.from("classes").select("id", { count: "exact", head: true }).eq("status", "flagged"),
      ]);
      if (!alive) return;
      setState({ count: all.count ?? 0, flagged: (fl.count ?? 0) > 0 });
    }

    load();
    const timer = setInterval(load, 60_000);
    const onUpdate = (e: Event) => {
      const d = (e as CustomEvent<Delta>).detail;
      setState((s) => ({
        count: Math.max(0, s.count + (d?.delta ?? 0)),
        flagged: d?.flagged ?? s.flagged,
      }));
    };
    window.addEventListener(EVT, onUpdate);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(EVT, onUpdate);
    };
    // pathname in deps → refetch on every route change (the cheap refresh).
  }, [enabled, pathname]);

  return state;
}

/**
 * The visual badge. Mounts only when count > 0 (never a "0" badge), so the
 * appear animation runs exactly once on first arrival — count changes update
 * the same element without re-animating. Amber + a notch dot when any pending
 * item is flagged (the dot keeps it distinguishable without colour).
 */
export function VerifyBadge({ count, flagged }: { count: number; flagged: boolean }) {
  if (count === 0) return null;
  const display = count > 99 ? "99+" : String(count);
  return (
    <span
      aria-hidden
      className={`badge-in relative ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums ${
        flagged ? "bg-amber-500 text-white" : "bg-primary text-primary-foreground"
      }`}
    >
      {display}
      {flagged && (
        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full border border-card bg-white" />
      )}
    </span>
  );
}
