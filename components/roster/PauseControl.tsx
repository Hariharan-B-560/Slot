"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";
import { pauseEnrolment, resumeEnrolment } from "@/app/roster/enrolment-status-actions";
import { toast } from "sonner";
import { shortDate } from "@/lib/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const REASONS = ["Travel", "Financial", "Health", "Other"] as const;

// Admin pause/resume for a single enrolment. Pausing holds the slot; resuming
// regenerates classes today-forward. The DB enforces both — this is the surface.
export function PauseControl({
  enrolmentId,
  status,
  pausedAt,
  student,
  teacher,
}: {
  enrolmentId: string;
  status: string;
  pausedAt: string | null;
  student: string;
  teacher: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasonKind, setReasonKind] = useState<(typeof REASONS)[number]>("Travel");
  const [note, setNote] = useState("");

  if (status === "ended") return null; // nothing to pause/resume on a finished enrolment

  function pause() {
    setError(null);
    const reason = reasonKind === "Other" ? note.trim() : note.trim() ? `${reasonKind} — ${note.trim()}` : reasonKind;
    if (reasonKind === "Other" && !note.trim()) {
      setError("Give a reason");
      return;
    }
    startTransition(async () => {
      const res = await pauseEnrolment({ enrolment_id: enrolmentId, reason });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        toast.success("Enrolment paused — slot held");
        setOpen(false);
        router.refresh();
      }
    });
  }

  function resume() {
    startTransition(async () => {
      const res = await resumeEnrolment(enrolmentId);
      if (!res.ok) toast.error(res.error ?? "Failed");
      else {
        toast.success("Enrolment resumed — classes regenerating");
        router.refresh();
      }
    });
  }

  if (status === "paused") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge className="bg-amber-500 text-[10px] text-white hover:bg-amber-500">PAUSED</Badge>
        {pausedAt && <span className="text-xs text-muted-foreground">since {shortDate(pausedAt.slice(0, 10))}</span>}
        <Button size="sm" variant="outline" disabled={pending} onClick={resume}>
          <PlayCircle className="mr-1 h-3.5 w-3.5" /> Resume
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
        <PauseCircle className="mr-1 h-3.5 w-3.5" /> Pause enrolment
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pause enrolment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label>Reason</Label>
              <Select value={reasonKind} onValueChange={(v) => v && setReasonKind(v as (typeof REASONS)[number])}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={reasonKind === "Other" ? "Describe the reason" : "Extra note (optional)"}
              />
            </div>

            <div className="rounded-md border bg-amber-50 p-3 text-sm text-amber-900">
              This will pause <strong>{student}</strong>&apos;s daily class with <strong>{teacher}</strong>. Their slot
              stays reserved. No classes will generate until you resume.
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={pause} disabled={pending}>
                {pending ? "Pausing…" : "Pause & hold the slot"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
