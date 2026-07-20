// Time-of-day helpers for the availability grid (all in minutes-from-midnight).

export function toMin(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

export function fromMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Slot start times from startHHMM up to (endHHMM - step), stepping by `step` minutes. */
export function slotStarts(startHHMM: string, endHHMM: string, step: number): string[] {
  const out: string[] = [];
  for (let m = toMin(startHHMM); m + step <= toMin(endHHMM); m += step) out.push(fromMin(m));
  return out;
}

// Display window for the grid.
export const DAY_START = "07:00";
export const DAY_END = "21:00";

// Columns are weekdays Mon..Sun (0=Sun..6=Sat).
export const WEEKDAY_COLUMNS = [1, 2, 3, 4, 5, 6, 0];
