"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importLegacyStudent } from "@/app/students/import-actions";
import { toast } from "sonner";
import { shortDate } from "@/lib/roster";
import { COURSES, courseLabel, type Course } from "@/lib/courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Teacher = { id: string; name: string };

export function ImportLegacyForm({ teachers, today }: { teachers: Teacher[]; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [course, setCourse] = useState<Course>("basic");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [slotStart, setSlotStart] = useState("");
  const [duration, setDuration] = useState<30 | 60>(30);
  const [totalSessions, setTotalSessions] = useState("");
  const [endDate, setEndDate] = useState("");
  const [alreadyDelivered, setAlreadyDelivered] = useState("");
  const [historicalStart, setHistoricalStart] = useState("");
  const [startDate, setStartDate] = useState(today);

  const total = totalSessions ? parseInt(totalSessions, 10) : null;
  const already = alreadyDelivered ? parseInt(alreadyDelivered, 10) : 0;
  const remainingPreview = total != null ? Math.max(0, total - already) : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await importLegacyStudent({
        name,
        phone: phone || undefined,
        course,
        teacher_id: teacherId,
        slot_start: slotStart,
        duration_minutes: duration,
        total_sessions: totalSessions || undefined,
        end_date: endDate || undefined,
        sessions_already_delivered: alreadyDelivered || 0,
        historical_start_date: historicalStart || undefined,
        start_date: startDate,
      });
      if (!res.ok) {
        setError(res.error ?? "Failed");
      } else {
        toast.success(`${name} imported`);
        router.push(res.studentId ? `/roster/${res.studentId}` : "/roster");
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>One-time onboarding.</strong> Use this only for students already mid-package on the legacy Google Form
        system. Past classes are <em>not</em> imported — only the count they&apos;ve already completed is carried over.
        For new students, place them on the{" "}
        <a href="/availability" className="underline">
          Availability
        </a>{" "}
        grid instead.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Student name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Phone (optional)">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
        </Field>

        <Field label="Course">
          <Select value={course} onValueChange={(v) => v && setCourse(v as Course)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COURSES.map((c) => (
                <SelectItem key={c} value={c}>
                  {courseLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Teacher">
          <Select value={teacherId} onValueChange={(v) => v && setTeacherId(v)}>
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
        </Field>

        <Field label="Slot start (daily)">
          <Input type="time" step={1800} value={slotStart} onChange={(e) => setSlotStart(e.target.value)} />
        </Field>
        <Field label="Session length">
          <Select value={String(duration)} onValueChange={(v) => v && setDuration(Number(v) as 30 | 60)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 min</SelectItem>
              <SelectItem value="60">60 min</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Total sessions (package)">
          <Input
            type="number"
            min={1}
            value={totalSessions}
            onChange={(e) => setTotalSessions(e.target.value)}
            placeholder="e.g. 20"
          />
        </Field>
        <Field label="End date (or/and)">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>

        <Field label="Sessions already delivered (legacy)">
          <Input
            type="number"
            min={0}
            value={alreadyDelivered}
            onChange={(e) => setAlreadyDelivered(e.target.value)}
            placeholder="e.g. 12"
          />
        </Field>
        <Field label="Historical start (pre-app)">
          <Input type="date" value={historicalStart} onChange={(e) => setHistoricalStart(e.target.value)} />
        </Field>

        <Field label="App start date (generation begins)">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
      </div>

      {/* Preview */}
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Preview</p>
        {name.trim() && total != null ? (
          <p>
            This will create <strong>{name.trim()}</strong> with <strong>{remainingPreview} sessions remaining</strong>{" "}
            ({total} total, {already} already delivered on the legacy system). App classes start{" "}
            <strong>{shortDate(startDate)}</strong>.
          </p>
        ) : name.trim() && endDate ? (
          <p>
            This will create <strong>{name.trim()}</strong>, capped by end date <strong>{shortDate(endDate)}</strong>,
            with {already} already delivered on the legacy system. App classes start{" "}
            <strong>{shortDate(startDate)}</strong>.
          </p>
        ) : (
          <p className="text-muted-foreground">Enter a name and a session count or end date to preview.</p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending}>
        {pending ? "Importing…" : "Import student"}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
