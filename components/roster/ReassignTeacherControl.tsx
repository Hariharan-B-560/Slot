"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserRoundCog } from "lucide-react";
import { reassignTeacher } from "@/app/roster/reassign-actions";
import { toast } from "sonner";
import { hhmm } from "@/lib/weekday";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Teacher = { id: string; name: string };

// Admin-only. Moves a student to another teacher as a re-enrolment: the old
// enrolment ends, its upcoming classes are cancelled, and a new one opens under
// the chosen teacher at the chosen time, continuing the package. The DB does it.
export function ReassignTeacherControl({
  enrolmentId,
  status,
  currentSlot,
  student,
  currentTeacher,
  teachers,
}: {
  enrolmentId: string;
  status: string;
  currentSlot: string;
  student: string;
  currentTeacher: string;
  teachers: Teacher[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [slot, setSlot] = useState(hhmm(currentSlot));
  const [reason, setReason] = useState("");

  if (status === "ended") return null; // nothing to reassign on a finished enrolment
  if (teachers.length === 0) return null; // no other teacher to move to

  function submit() {
    setError(null);
    if (!teacherId) {
      setError("Pick a teacher");
      return;
    }
    startTransition(async () => {
      const res = await reassignTeacher({
        enrolment_id: enrolmentId,
        new_teacher_id: teacherId,
        new_slot: slot,
        reason: reason || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success("Student reassigned — new classes are generating");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" className="ml-2 mt-2" onClick={() => setOpen(true)}>
        <UserRoundCog className="mr-1 h-3.5 w-3.5" /> Reassign teacher
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reassign to another teacher</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{student}</strong> · currently with{" "}
              <strong className="text-foreground">{currentTeacher}</strong> at{" "}
              <strong className="text-foreground tabular-nums">{hhmm(currentSlot)}</strong>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>New teacher</Label>
              <Select
                items={Object.fromEntries(teachers.map((t) => [t.id, t.name]))}
                value={teacherId}
                onValueChange={(v) => v && setTeacherId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a teacher" />
                </SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>New daily time</Label>
              <Input type="time" step={1800} value={slot} onChange={(e) => setSlot(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reason (optional)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. teacher on leave" />
            </div>

            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              This ends the current enrolment and cancels its upcoming classes, then starts fresh under the new teacher
              — continuing the same package (sessions already delivered still count). Classes already delivered stay
              with the old teacher. Refused if the new time clashes with that teacher&apos;s schedule.
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Reassigning…" : "Reassign"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
