"use client";

import { useState, useTransition } from "react";
import { submitReport } from "@/app/deliver/actions";
import { requestReschedule } from "@/app/deliver/reschedule-actions";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { fmtIST } from "@/lib/datetime";
import { courseLabel } from "@/lib/courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UploadZone } from "@/components/deliver/UploadZone";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ClassRow = {
  id: string;
  startISO: string;
  endISO: string;
  studentName: string;
  course: string | null;
  status: string;
  inWindow: boolean;
};

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  verified: "default",
  delivered: "secondary",
  published: "outline",
  missed: "outline",
  flagged: "destructive",
};

export function DeliverToday({ classes }: { classes: ClassRow[] }) {
  const [active, setActive] = useState<ClassRow | null>(null);
  const [resched, setResched] = useState<ClassRow | null>(null);

  return (
    <div className="space-y-2">
      {classes.length === 0 && (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">No classes scheduled for today.</p>
      )}
      {classes.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <span className="font-medium tabular-nums">{fmtIST(c.startISO)}</span>
          <span>{c.studentName}</span>
          <Badge variant="outline">{c.course ? courseLabel(c.course) : "demo"}</Badge>
          <Badge variant={statusVariant[c.status] ?? "outline"}>{c.status}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {c.status === "published" && c.inWindow && <Button size="sm" onClick={() => setActive(c)}>File report &amp; deliver</Button>}
            {c.status === "published" && !c.inWindow && (
              <span className="text-xs text-muted-foreground">outside window</span>
            )}
            {/* A teacher never moves a class — they ask; an admin decides. */}
            {c.status === "published" && (
              <Button size="sm" variant="outline" onClick={() => setResched(c)}>
                Request reschedule
              </Button>
            )}
            {c.status === "delivered" && <span className="text-xs text-muted-foreground">awaiting verification</span>}
            {c.status === "verified" && <span className="text-xs text-emerald-700">verified ✓</span>}
          </div>
        </div>
      ))}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Session report</DialogTitle>
          </DialogHeader>
          {active && <ReportForm row={active} onDone={() => setActive(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!resched} onOpenChange={(o) => !o && setResched(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a reschedule</DialogTitle>
          </DialogHeader>
          {resched && <RescheduleForm row={resched} onDone={() => setResched(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportForm({ row, onDone }: { row: ClassRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<"present" | "late" | "absent">("present");
  const [absentReason, setAbsentReason] = useState("");
  const [notes, setNotes] = useState("");
  // The two screenshots upload on select (via UploadZone) and hand back their
  // storage path once done. Both are required to close a class.
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [closingPath, setClosingPath] = useState<string | null>(null);
  const [recording, setRecording] = useState<File | null>(null);

  const missing = [!openingPath && "opening", !closingPath && "closing"].filter(Boolean) as string[];
  const ready = missing.length === 0;

  async function uploadOne(file: File, kind: string): Promise<string> {
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "png";
    const path = `${row.id}/${kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("session-evidence").upload(path, file);
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    return path;
  }

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      // Screenshots are already uploaded; only the optional recording remains.
      let recordingPath: string | undefined;
      if (recording) {
        try {
          recordingPath = await uploadOne(recording, "recording");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Upload failed");
          return;
        }
      }

      const res = await submitReport({
        class_id: row.id,
        attendance,
        absent_reason: absentReason || undefined,
        opening_screenshot: openingPath!,
        closing_screenshot: closingPath!,
        recording: recordingPath,
        notes: notes || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success("Class delivered");
        onDone();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div>
          <strong className="text-foreground">{row.studentName}</strong> · {row.course ? courseLabel(row.course) : "demo"}
        </div>
        <div className="tabular-nums">{fmtIST(row.startISO)}</div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Attendance</Label>
        <Select value={attendance} onValueChange={(v) => v && setAttendance(v as typeof attendance)}>
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
        <UploadZone label="Add opening screenshot" classId={row.id} kind="opening" onChange={setOpeningPath} />
        <UploadZone label="Add closing screenshot" classId={row.id} kind="closing" onChange={setClosingPath} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Recording (optional)</Label>
        <input type="file" onChange={(e) => setRecording(e.target.files?.[0] ?? null)} className="text-sm" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Notes (optional)</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
        {!ready && (
          <p className="text-xs text-muted-foreground">
            Still need the <span className="font-medium text-foreground">{missing.join(" and ")}</span> screenshot
            {missing.length > 1 ? "s" : ""} before you can deliver.
          </p>
        )}
        <Button onClick={submit} disabled={pending || !ready} className="w-full sm:w-auto sm:self-end">
          {pending ? "Delivering…" : "Submit & mark delivered"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function RescheduleForm({ row, onDone }: { row: ClassRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [proposed, setProposed] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await requestReschedule({
        class_id: row.id,
        reason,
        proposed_start: proposed || undefined,
      });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        toast.success("Reschedule requested — an admin will decide");
        onDone();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div>
          <strong className="text-foreground">{row.studentName}</strong> · {row.course ? courseLabel(row.course) : "demo"}
        </div>
        <div className="tabular-nums">{fmtIST(row.startISO)}</div>
      </div>
      <p className="text-xs text-muted-foreground">
        You can&apos;t move a class yourself — this sends a request for an admin to approve and place.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label>Reason</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this need to move?" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Suggested new time (optional)</Label>
        <Input type="datetime-local" value={proposed} onChange={(e) => setProposed(e.target.value)} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button onClick={submit} disabled={pending || !reason.trim()}>
          {pending ? "Sending…" : "Send request"}
        </Button>
      </DialogFooter>
    </div>
  );
}
