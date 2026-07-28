"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { retroClose } from "@/app/verify/retro-actions";
import { fmtIST } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UploadZone } from "@/components/deliver/UploadZone";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type RecoverRow = {
  id: string;
  startISO: string;
  teacherName: string;
  studentName: string;
  status: string;
};

// Admin-only rescue for classes that passed their window unmarked (within 3
// days). Records the teacher's evidence + a reason, then the DB marks it
// delivered + verified and logs the exception. The DB enforces every guard.
export function RecoverMissed({ classes }: { classes: RecoverRow[] }) {
  const [active, setActive] = useState<RecoverRow | null>(null);
  if (classes.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-1 text-sm font-semibold">Missed — still recoverable</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Classes that passed their window unmarked, within the last 3 days. Recording one files the teacher&apos;s
        evidence and marks it delivered &amp; verified — logged as an admin exception in Integrity.
      </p>
      <div className="space-y-2">
        {classes.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
            <span className="font-medium tabular-nums">{fmtIST(c.startISO)}</span>
            <span>{c.studentName}</span>
            <span className="text-muted-foreground">· {c.teacherName}</span>
            <Badge variant="outline">{c.status}</Badge>
            <div className="ml-auto">
              <Button size="sm" variant="outline" onClick={() => setActive(c)}>
                Record as delivered
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Retro-close a missed class</DialogTitle>
          </DialogHeader>
          {active && <RetroForm row={active} onDone={() => setActive(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RetroForm({ row, onDone }: { row: RecoverRow; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<"present" | "late" | "absent">("present");
  const [absentReason, setAbsentReason] = useState("");
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);

  const missing = [!opening && "opening", !closing && "closing"].filter(Boolean) as string[];
  const ready =
    missing.length === 0 && reason.trim().length > 0 && (attendance !== "absent" || absentReason.trim().length > 0);

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const res = await retroClose({
        class_id: row.id,
        reason,
        opening_screenshot: opening!,
        closing_screenshot: closing!,
        attendance,
        absent_reason: absentReason || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success("Recorded as delivered & verified");
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div>
          <strong className="text-foreground">{row.studentName}</strong> · {row.teacherName}
        </div>
        <div className="tabular-nums">{fmtIST(row.startISO)}</div>
      </div>

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        This bypasses the normal deliver window because the class already happened. It&apos;s admin-only, needs the
        teacher&apos;s screenshots + a reason, and is recorded as an exception. Use it only for a class the teacher
        genuinely taught but forgot to mark.
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Why is this being recorded late?</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. teacher forgot to click deliver" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Attendance</Label>
        <Select
          items={{ present: "Present", late: "Late", absent: "Absent" }}
          value={attendance}
          onValueChange={(v) => v && setAttendance(v as typeof attendance)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="present">Present</SelectItem>
            <SelectItem value="late">Late</SelectItem>
            <SelectItem value="absent">Absent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {attendance === "absent" && (
        <div className="flex flex-col gap-1.5">
          <Label>Reason for absence</Label>
          <Input value={absentReason} onChange={(e) => setAbsentReason(e.target.value)} placeholder="Why was the student absent?" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <UploadZone label="Add opening screenshot" classId={row.id} kind="opening" onChange={setOpening} />
        <UploadZone label="Add closing screenshot" classId={row.id} kind="closing" onChange={setClosing} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
        {!ready && (
          <p className="text-xs text-muted-foreground">
            Needs a reason and both screenshots before you can record it.
          </p>
        )}
        <Button onClick={submit} disabled={pending || !ready} className="w-full sm:w-auto sm:self-end">
          {pending ? "Recording…" : "Record as delivered & verified"}
        </Button>
      </DialogFooter>
    </div>
  );
}
