// Daily slot model: a student attends EVERY DAY at one fixed time.
// There is no weekday dimension, so session maths is plain day arithmetic.

export type Enrolment = {
  slot_start: string;
  start_date: string;
  end_date: string | null;
  total_sessions: number | null;
  // Legacy migration: sessions completed on the old system before app cutover.
  // Absent (undefined) on app-native enrolments — treated as 0.
  sessions_already_delivered?: number | null;
};

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inclusive day count between two ISO dates. */
export function daysInclusive(startISO: string, endISO: string): number {
  const a = new Date(startISO + "T00:00:00").getTime();
  const b = new Date(endISO + "T00:00:00").getTime();
  if (b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Total sessions: the count cap if set, else the day-range count. */
export function totalSessions(e: Enrolment): number | null {
  if (e.total_sessions != null) return e.total_sessions;
  if (e.end_date) return daysInclusive(e.start_date, e.end_date);
  return null;
}

/**
 * Remaining sessions = total − (legacy already-delivered + delivered in-app).
 * Legacy migration carries `sessions_already_delivered` so a mid-package student
 * reads correctly from day one; app-native enrolments have it undefined = 0.
 * Null when the enrolment is open-ended (no total).
 */
export function remaining(e: Enrolment, deliveredInApp: number): number | null {
  const total = totalSessions(e);
  if (total == null) return null;
  return Math.max(0, total - ((e.sessions_already_delivered ?? 0) + deliveredInApp));
}

/**
 * When the slot frees up — the LAST session date, taking whichever cap binds
 * first: the session count (start_date + n − 1 days) or end_date.
 */
export function freesUp(e: Enrolment): { date: string | null; boundBy: "sessions" | "end_date" | null } {
  const byCount = e.total_sessions != null ? addDays(e.start_date, e.total_sessions - 1) : null;
  const byDate = e.end_date ?? null;
  if (byCount && byDate) {
    return byCount <= byDate ? { date: byCount, boundBy: "sessions" } : { date: byDate, boundBy: "end_date" };
  }
  if (byCount) return { date: byCount, boundBy: "sessions" };
  if (byDate) return { date: byDate, boundBy: "end_date" };
  return { date: null, boundBy: null };
}

/** "2026-09-28" -> "28 Sep" */
export function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
