"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { changeEnrolmentSlot } from "@/app/roster/slot-actions";
import { toast } from "sonner";
import { hhmm } from "@/lib/weekday";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Admin-only permanent slot change. Moves the enrolment's daily time; every
// upcoming class follows (the DB does the moves). Only offered on active
// enrolments — paused/ended aren't reschedulable.
export function SlotChangeControl({
  enrolmentId,
  status,
  currentSlot,
  student,
  teacher,
}: {
  enrolmentId: string;
  status: string;
  currentSlot: string;
  student: string;
  teacher: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState(hhmm(currentSlot));
  const [reason, setReason] = useState("");

  if (status !== "active") return null;

  function submit() {
    setError(null);
    if (slot === hhmm(currentSlot)) {
      setError("Pick a different time");
      return;
    }
    startTransition(async () => {
      const res = await changeEnrolmentSlot({ enrolment_id: enrolmentId, new_slot: slot, reason: reason || undefined });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success(
          res.moved ? `Slot changed — ${res.moved} upcoming class${res.moved === 1 ? "" : "es"} moved` : "Slot changed",
        );
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" className="ml-2 mt-2" onClick={() => setOpen(true)}>
        <Clock className="mr-1 h-3.5 w-3.5" /> Change slot
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change slot time</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{student}</strong> with{" "}
              <strong className="text-foreground">{teacher}</strong> · currently{" "}
              <strong className="text-foreground tabular-nums">{hhmm(currentSlot)}</strong> daily
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>New daily time</Label>
              <Input type="time" step={1800} value={slot} onChange={(e) => setSlot(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reason (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. student's school hours changed" />
            </div>

            <div className="rounded-md border bg-amber-50 p-3 text-xs text-amber-900">
              Moves all upcoming classes to the new time (past classes stay put). If the new time clashes with another
              of {teacher}&apos;s students, it&apos;s refused. Teacher and session length can&apos;t be changed here yet.
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Moving classes…" : "Change slot"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
