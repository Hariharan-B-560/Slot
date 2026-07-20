// Shared, URL-persisted date range for the admin analytics pages (Dashboard,
// Integrity). Deliberately minimal — presets only, no custom picker and no
// export — so the date-slicer/export batch can extend this without a rewrite.
// All dates are plain ISO days in Asia/Kolkata, matching how the DB functions
// take (p_start, p_end) as `date`.

export type Preset = "7d" | "30d" | "90d";
export type DateRange = { from: string; to: string; preset: Preset | null };

export const PRESETS: { key: Preset; label: string; days: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Today in IST, as an ISO day. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function shift(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two ISO days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;
}

/**
 * Read the range off the URL. `?from=&to=` wins; otherwise `?range=7d|30d|90d`;
 * otherwise the 30-day default. Invalid input falls back rather than throwing —
 * a malformed URL should never blank the dashboard.
 */
export function parseRange(sp: { from?: string; to?: string; range?: string }): DateRange {
  const today = todayIST();
  if (sp.from && sp.to && ISO.test(sp.from) && ISO.test(sp.to) && sp.from <= sp.to) {
    const preset = PRESETS.find((p) => p.days === daysBetween(sp.from!, sp.to!) && sp.to === today);
    return { from: sp.from, to: sp.to, preset: preset?.key ?? null };
  }
  const preset = PRESETS.find((p) => p.key === sp.range) ?? PRESETS[1]; // 30d default
  return { from: shift(today, -(preset.days - 1)), to: today, preset: preset.key };
}

/** The equal-length window immediately before this one — for "vs previous period". */
export function previousRange(r: DateRange): { from: string; to: string } {
  const len = daysBetween(r.from, r.to);
  return { from: shift(r.from, -len), to: shift(r.from, -1) };
}

/** Href for a preset, preserving the rest of the query string. */
export function rangeHref(path: string, preset: Preset): string {
  return `${path}?range=${preset}`;
}

/** "vs last 30d" label for the delta line. */
export function previousLabel(r: DateRange): string {
  return `vs previous ${daysBetween(r.from, r.to)}d`;
}

/** Percentage change, or null when the baseline is 0 (no meaningful delta). */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}
