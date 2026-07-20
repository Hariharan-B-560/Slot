"use client";

import { useState, useTransition } from "react";
import { approveReschedule, denyReschedule } from "@/app/reschedules/actions";
import { bumpPending } from "@/components/VerifyBadge";
import { toast } from "sonner";
import { fmtIST } from "@/lib/datetime";
import { courseLabel } from "@/lib/courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type RequestRow = {
  id: string;
  classId: string;
  currentStart: string;
  proposedStart: string | null;
  reason: string;
  teacherName: string;
  studentName: string;
  course: string | null;
};

export function RescheduleQueue({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-muted-foreground">No pending reschedule requests.</p>;
  }
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <RequestCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function toLocalInput(iso: string): string {
  // ISO → "YYYY-MM-DDTHH:mm" in IST for the datetime-local default.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function RequestCard({ r }: { r: RequestRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "approve" | "deny">("idle");
  const [newStart, setNewStart] = useState(toLocalInput(r.proposedStart ?? r.currentStart));
  const [note, setNote] = useState("");
  const [done, setDone] = useState<"approved" | "denied" | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveReschedule({ request_id: r.id, class_id: r.classId, new_start: newStart, note: note || undefined });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        bumpPending({ reschedule: -1 });
        toast.success("Class moved");
        setDone("approved");
      }
    });
  }
  function deny() {
    setError(null);
    startTransition(async () => {
      const res = await denyReschedule({ request_id: r.id, note: note || undefined });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        bumpPending({ reschedule: -1 });
        toast.success("Request denied");
        setDone("denied");
      }
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {r.teacherName} → {r.studentName}: <span className="font-medium text-foreground">{done}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 text-sm">
        <div className="font-medium">
          {r.teacherName} → {r.studentName} <Badge variant="outline">{r.course ? courseLabel(r.course) : "demo"}</Badge>
        </div>
        <div className="tabular-nums text-muted-foreground">
          Current: {fmtIST(r.currentStart)}
          {r.proposedStart && <> · proposed: {fmtIST(r.proposedStart)}</>}
        </div>
        <div className="mt-1">
          <span className="text-xs uppercase text-muted-foreground">Reason</span> — {r.reason}
        </div>
      </div>

      {mode === "idle" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setMode("approve")}>Approve &amp; place</Button>
          <Button size="sm" variant="outline" onClick={() => setMode("deny")}>Deny</Button>
        </div>
      )}

      {mode === "approve" && (
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">New date &amp; time (IST)</Label>
            <Input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="w-64" />
            <p className="text-xs text-muted-foreground">
              Open the target Saturday first if needed. An overlapping slot will be rejected.
            </p>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          <div className="flex gap-2">
            <Button size="sm" onClick={approve} disabled={pending}>{pending ? "Moving…" : "Confirm move"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === "deny" && (
        <div className="space-y-3">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for denial (optional)" />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={deny} disabled={pending}>{pending ? "…" : "Confirm deny"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
