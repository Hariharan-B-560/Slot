"use client";

import { useState, useTransition } from "react";
import { createStudent, updateStudent } from "@/app/students/manage-actions";
import { STUDENT_STATUSES } from "@/lib/students";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Status = (typeof STUDENT_STATUSES)[number];
type Student = { id: string; name: string; phone: string | null; status: string };

export function StudentManager({ students }: { students: Student[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("lead");

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createStudent({ name, phone: phone || undefined, status });
      if (!res.ok) setError(res.error ?? "Could not add student");
      else {
        setName("");
        setPhone("");
        setStatus("lead");
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
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => v && setStatus(v as Status)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STUDENT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={add} disabled={pending || !name.trim()}>
            {pending ? "Adding…" : "Add student"}
          </Button>
          {error && <p className="w-full text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((s) => (
              <StudentRow key={s.id} student={s} onError={setError} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StudentRow({ student, onError }: { student: Student; onError: (m: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(student.name);
  const [phone, setPhone] = useState(student.phone ?? "");
  const [status, setStatus] = useState<Status>(student.status as Status);

  function save() {
    onError(null);
    startTransition(async () => {
      const res = await updateStudent(student.id, { name, phone: phone || undefined, status });
      if (!res.ok) onError(res.error ?? "Could not save");
      else setEditing(false);
    });
  }

  if (!editing) {
    return (
      <TableRow>
        <TableCell className="font-medium">{student.name}</TableCell>
        <TableCell className="text-muted-foreground">{student.phone ?? "—"}</TableCell>
        <TableCell>
          <Badge variant="secondary">{student.status}</Badge>
        </TableCell>
        <TableCell className="text-right">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-44" />
      </TableCell>
      <TableCell>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-36" />
      </TableCell>
      <TableCell>
        <Select value={status} onValueChange={(v) => v && setStatus(v as Status)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STUDENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button size="sm" disabled={pending} onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
