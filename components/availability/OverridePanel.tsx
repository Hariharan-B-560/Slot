"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, X } from "lucide-react";
import { openOverride, removeOverride } from "@/app/availability/override-actions";
import { toast } from "sonner";
import { shortDate } from "@/lib/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type OpenDate = {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

// Per-date "open a closed day" control (Saturdays / make-ups). Sundays are
// rejected by the DB; the message surfaces if someone tries. One-off only.
export function OverridePanel({ teacherId, opens }: { teacherId: string; opens: OpenDate[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await openOverride({
        teacher_id: teacherId,
        date,
        kind: "open",
        start_time: start || undefined,
        end_time: end || undefined,
        reason: reason || undefined,
      });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        toast.success("Date opened");
        setDate("");
        setStart("");
        setEnd("");
        setReason("");
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeOverride(id);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else toast.success("Opening removed");
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <CalendarPlus className="h-4 w-4" /> Open a closed day
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Saturdays are closed by default; open a specific date for a make-up or on-demand demo. Sundays can&apos;t be
        opened. One date at a time — no recurrence.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">From (optional)</Label>
          <Input type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} className="w-28" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">To (optional)</Label>
          <Input type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Reason (optional)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. make-up class" />
        </div>
        <Button onClick={submit} disabled={pending || !date}>
          {pending ? "Opening…" : "Open date"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {opens.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">Upcoming open dates</p>
          <ul className="space-y-1.5">
            {opens.map((o) => (
              <li key={o.id} className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-sm">
                <span className="font-medium">{shortDate(o.date)}</span>
                <span className="text-muted-foreground">
                  {o.start_time && o.end_time ? `${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}` : "full day"}
                </span>
                {o.reason && <span className="truncate text-xs text-muted-foreground">· {o.reason}</span>}
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  aria-label="Remove opening"
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
