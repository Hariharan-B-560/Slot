// Display timestamps in the institute's timezone (Asia/Kolkata), regardless of
// where the server runs. Storage stays timestamptz (UTC) in Postgres.
const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

export function fmtIST(iso: string): string {
  return fmt.format(new Date(iso));
}
