"use client";

import { useState, useTransition } from "react";
import { verifyClass, flagClass } from "@/app/verify/actions";
import { bumpPendingVerify } from "@/components/VerifyBadge";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// `disabled` gates Verify + Flag on the evidence having actually loaded — admin
// must never act on a class whose screenshots they can't see (rule 5).
export function VerifyActions({
  classId,
  status,
  disabled = false,
}: {
  classId: string;
  status: string;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      else if (ok) toast.success(ok);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {!flagging ? (
        <div className="flex gap-2">
          {status === "delivered" && (
            <Button
              size="sm"
              disabled={pending || disabled}
              onClick={() =>
                run(async () => {
                  const res = await verifyClass(classId);
                  // Optimistic: drop the nav badge by one right away — the
                  // next route change / poll corrects any drift.
                  if (res.ok) bumpPendingVerify(-1);
                  return res;
                }, "Class verified")
              }
            >
              Verify
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pending || disabled} onClick={() => setFlagging(true)}>
            Flag
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="h-8 w-48 text-sm"
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={() =>
              run(async () => {
                const res = await flagClass(classId, reason);
                if (res.ok) {
                  setFlagging(false);
                  // Count is unchanged (still pending) but the badge should
                  // turn amber immediately.
                  bumpPendingVerify(0, true);
                }
                return res;
              }, "Flagged for follow-up")
            }
          >
            Save flag
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
