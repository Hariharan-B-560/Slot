"use client";

import { useState, useTransition } from "react";
import { createCounsellor, updateCounsellor, resetCounsellorPassword } from "@/app/counsellors/actions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Counsellor = { id: string; name: string; email: string | null; active: boolean };

export function CounsellorManager({ counsellors }: { counsellors: Counsellor[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createCounsellor({ name, email, password });
      if (!res.ok) setError(res.error ?? "Could not add counsellor");
      else {
        toast.success("Counsellor added — they'll set their own password on first login");
        setName("");
        setEmail("");
        setPassword("");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-48" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Email (their login)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="counsellor@example.com"
              className="w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Temporary password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 8 chars"
              className="w-40"
            />
          </div>
          <Button onClick={add} disabled={pending || !name.trim() || !email.trim() || password.length < 8}>
            {pending ? "Adding…" : "Add counsellor"}
          </Button>
          {error && <p className="w-full text-sm text-destructive">{error}</p>}
          <p className="w-full text-xs text-muted-foreground">
            Give the counsellor this temporary password. They&apos;ll be forced to set their own on first login. A
            counsellor is read-only: they can view availability, students, and fees, but change nothing.
          </p>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-40 text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {counsellors.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No counsellors yet.
                </TableCell>
              </TableRow>
            ) : (
              counsellors.map((c) => <CounsellorRow key={c.id} counsellor={c} onError={setError} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CounsellorRow({ counsellor, onError }: { counsellor: Counsellor; onError: (m: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counsellor.name);

  function save(next: { name: string; active: boolean }) {
    onError(null);
    startTransition(async () => {
      const res = await updateCounsellor(counsellor.id, next);
      if (!res.ok) onError(res.error ?? "Could not save");
      else setEditing(false);
    });
  }

  function resetPassword() {
    const pw = window.prompt(`New temporary password for ${counsellor.name} (min 8 chars):`);
    if (!pw) return;
    onError(null);
    startTransition(async () => {
      const res = await resetCounsellorPassword(counsellor.id, pw);
      if (!res.ok) onError(res.error ?? "Could not reset");
      else toast.success("Password reset — they'll set a new one on next login");
    });
  }

  return (
    <TableRow className={counsellor.active ? "" : "opacity-60"}>
      <TableCell className="font-medium">
        {editing ? <Input value={name} onChange={(e) => setName(e.target.value)} className="w-44" /> : counsellor.name}
      </TableCell>
      <TableCell className="text-muted-foreground">{counsellor.email ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={counsellor.active ? "secondary" : "outline"}>{counsellor.active ? "active" : "retired"}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={pending} onClick={() => save({ name, active: counsellor.active })}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Switch
                checked={counsellor.active}
                disabled={pending}
                onCheckedChange={(v) => save({ name: counsellor.name, active: v })}
              />
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={resetPassword}>
                Reset password
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
