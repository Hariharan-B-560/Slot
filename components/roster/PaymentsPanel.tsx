"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IndianRupee, Plus, Minus, Pencil } from "lucide-react";
import { addPayment, setTotalFee } from "@/app/roster/payment-actions";
import { toast } from "sonner";
import { shortDate } from "@/lib/roster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  note: string | null;
  recordedBy: string | null;
};
export type PaymentStatus = {
  total_fee: number | null;
  paid: number;
  remaining: number | null;
};

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const money = (n: number | null) => (n == null ? "—" : `₹${inr.format(n)}`);

export function PaymentsPanel({
  enrolmentId,
  status,
  payments,
  today,
}: {
  enrolmentId: string;
  status: PaymentStatus;
  payments: PaymentRow[];
  today: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "payment" | "adjustment" | "fee">("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [note, setNote] = useState("");
  const [fee, setFee] = useState(status.total_fee != null ? String(status.total_fee) : "");
  const [reason, setReason] = useState("");

  function reset() {
    setMode("idle");
    setError(null);
    setAmount("");
    setPaidAt(today);
    setNote("");
    setReason("");
  }

  function submitPayment(sign: 1 | -1) {
    setError(null);
    const n = parseFloat(amount);
    if (!n || n <= 0) {
      setError("Enter a positive amount");
      return;
    }
    startTransition(async () => {
      const res = await addPayment({ enrolment_id: enrolmentId, amount: sign * n, paid_at: paidAt, note: note || undefined });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        toast.success(sign > 0 ? "Payment recorded" : "Adjustment recorded");
        reset();
        router.refresh();
      }
    });
  }

  function submitFee() {
    setError(null);
    startTransition(async () => {
      const res = await setTotalFee({
        enrolment_id: enrolmentId,
        total_fee: fee === "" ? undefined : parseFloat(fee),
        reason: reason || undefined,
      });
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        toast.success("Total fee updated");
        reset();
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <IndianRupee className="h-4 w-4" /> Payments
      </div>

      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-muted-foreground">Total fee</span> <strong>{money(status.total_fee)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Paid</span> <strong>{money(status.paid)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Remaining</span>{" "}
          <strong className={status.remaining != null && status.remaining > 0 ? "text-amber-600" : ""}>
            {status.remaining == null ? "unknown" : money(status.remaining)}
          </strong>
        </span>
      </div>

      {/* Payment list — append-only, no edit/delete controls */}
      {payments.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded border bg-card px-3 py-1.5">
              <span className={`font-medium tabular-nums ${p.amount < 0 ? "text-amber-600" : ""}`}>
                {p.amount < 0 ? `−₹${inr.format(Math.abs(p.amount))}` : money(p.amount)}
              </span>
              <span className="text-muted-foreground">{shortDate(p.paid_at.slice(0, 10))}</span>
              {p.note && <span className="truncate text-xs text-muted-foreground">· {p.note}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{p.recordedBy ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}

      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("payment")}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add payment
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("adjustment")}>
            <Minus className="mr-1 h-3.5 w-3.5" /> Add adjustment
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("fee")}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit total fee
          </Button>
        </div>
      )}

      {(mode === "payment" || mode === "adjustment") && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{mode === "adjustment" ? "Adjustment amount (₹)" : "Amount (₹)"}</Label>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Date received</Label>
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs">Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "adjustment" ? "e.g. refund for missed classes" : "e.g. instalment 2"} />
            </div>
          </div>
          {mode === "adjustment" && (
            <p className="text-xs text-muted-foreground">Recorded as a negative amount — corrections are new rows, never edits.</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={() => submitPayment(mode === "adjustment" ? -1 : 1)}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === "fee" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Total fee (₹)</Label>
              <Input type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className="w-32" />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label className="text-xs">Reason (optional — logged)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. added 10 sessions" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={submitFee}>{pending ? "Saving…" : "Save fee"}</Button>
            <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
