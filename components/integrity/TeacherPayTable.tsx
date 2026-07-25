"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setTeacherRate } from "@/app/integrity/pay-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp } from "lucide-react";

export type PayRow = {
  teacher_id: string;
  teacher_name: string;
  verified_atoms: number;
  verified_classes: number;
  rate_per_30min: number;
  gross_pay: number;
};

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const money = (n: number) => `₹${inr.format(n)}`;
// Verified pay counts 30-min atoms (a 60-min class is 2), so hours taught =
// atoms ÷ 2. Kept as the display; pay math underneath is unchanged.
const hours = (a: number) => inr.format(a / 2);

type SortKey = "teacher_name" | "verified_atoms" | "verified_classes" | "rate_per_30min" | "gross_pay";

export function TeacherPayTable({ rows }: { rows: PayRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("gross_pay");
  const [asc, setAsc] = useState(false);
  const [editing, setEditing] = useState<PayRow | null>(null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, asc]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          atoms: acc.atoms + Number(r.verified_atoms),
          classes: acc.classes + Number(r.verified_classes),
          gross: acc.gross + Number(r.gross_pay),
        }),
        { atoms: 0, classes: 0, gross: 0 },
      ),
    [rows],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      // Text sorts A→Z by default; numbers high→low (most owed first).
      setAsc(key === "teacher_name");
    }
  }

  const SortHead = ({ label, k, right }: { label: string; k: SortKey; right?: boolean }) => (
    <TableHead className={right ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${right ? "flex-row-reverse" : ""}`}
      >
        {label}
        {sortKey === k &&
          (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Teacher" k="teacher_name" />
              <SortHead label="Hours taught" k="verified_atoms" right />
              <SortHead label="Verified classes" k="verified_classes" right />
              <SortHead label="Rate / 30 min" k="rate_per_30min" right />
              <SortHead label="Gross pay" k="gross_pay" right />
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No active teachers.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.teacher_id}>
                  <TableCell className="font-medium">{r.teacher_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours(Number(r.verified_atoms))}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.verified_classes}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(Number(r.rate_per_30min))}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(Number(r.gross_pay))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                      Edit rate
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {sorted.length > 0 && (
            <tfoot className="border-t bg-muted/40 font-medium">
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{hours(totals.atoms)}</TableCell>
                <TableCell className="text-right tabular-nums">{totals.classes}</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums">{money(totals.gross)}</TableCell>
                <TableCell />
              </TableRow>
            </tfoot>
          )}
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit rate</DialogTitle>
          </DialogHeader>
          {editing && <RateForm row={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RateForm({ row, onDone }: { row: PayRow; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(String(row.rate_per_30min));
  const [reason, setReason] = useState("");

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await setTeacherRate({
        teacher_id: row.teacher_id,
        rate: rate,
        reason: reason || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success(`${row.teacher_name}'s rate updated`);
        router.refresh();
        onDone();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong className="text-foreground">{row.teacher_name}</strong> · currently {money(Number(row.rate_per_30min))}{" "}
        per 30-min atom
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>New rate (₹ per 30 min)</Label>
        <Input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Reason (optional)</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. annual raise" />
      </div>
      <p className="text-xs text-muted-foreground">
        Recorded in the rate history. Pay figures use the current rate, so changing it re-prices past verified classes
        in this view — adjust manually if a change should only apply going forward.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save rate"}
        </Button>
      </DialogFooter>
    </div>
  );
}
