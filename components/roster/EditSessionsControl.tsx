"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { setEnrolmentSessions } from "@/app/roster/sessions-actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Admin-only. Edit an enrolment's class count (total_sessions). Increasing adds
// classes; decreasing cancels the surplus upcoming ones — the DB does both and
// won't let it drop below what's already delivered.
export function EditSessionsControl({
  enrolmentId,
  status,
  currentTotal,
  delivered,
  student,
}: {
  enrolmentId: string;
  status: string;
  currentTotal: number | null;
  delivered: number;
  student: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(currentTotal != null ? String(currentTotal) : "");
  const [reason, setReason] = useState("");

  if (status === "ended") return null; // nothing to edit on a finished enrolment

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await setEnrolmentSessions({ enrolment_id: enrolmentId, total, reason });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success("Class count updated");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" className="ml-2 mt-2" onClick={() => setOpen(true)}>
        <ListChecks className="mr-1 h-3.5 w-3.5" /> Edit sessions
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit class count</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{student}</strong> · currently{" "}
              <strong className="text-foreground">{currentTotal ?? "open"}</strong> sessions ·{" "}
              <strong className="text-foreground">{delivered}</strong> delivered so far
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>New total sessions</Label>
              <Input
                type="number"
                min={Math.max(1, delivered)}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Can&apos;t go below the {delivered} already delivered. Lowering it cancels the latest upcoming classes;
                raising it adds new ones.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Reason</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. student bought 5 more" />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={submit} disabled={pending || !total.trim() || !reason.trim()}>
                {pending ? "Saving…" : "Update count"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
