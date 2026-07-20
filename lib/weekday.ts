// 0=Sunday .. 6=Saturday, matching availability_blocks.weekday and Postgres DOW.
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "18:00:00" -> "18:00" for display. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}
