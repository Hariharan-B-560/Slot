"use client";

import { useState, useTransition } from "react";
import { publishRange } from "@/app/availability/grid-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Publishes a daily working window. Dragging handles gaps *inside* the current
 * strip; this is how you extend it (or start one from nothing). The DB enforces
 * that the window is a whole multiple of the session length — we surface that
 * error rather than pre-checking it here.
 */
export function AddWindow({ teacherId }: { teacherId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("20:00");

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Daily window from</Label>
        <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">to</Label>
        <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" />
      </div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await publishRange(teacherId, start, end);
            if (!res.ok) setError(res.error ?? "Could not publish");
          });
        }}
      >
        {pending ? "Publishing…" : "Publish window"}
      </Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </div>
  );
}
