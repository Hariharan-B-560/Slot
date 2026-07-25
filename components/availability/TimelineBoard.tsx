"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  publishSlot,
  bulkPublish,
  makeUnavailable,
  bulkMakeUnavailable,
  placeStudent,
  placeDemo,
  endEnrolment,
  enrolmentDetail,
  type EnrolmentDetail,
} from "@/app/availability/grid-actions";
import { createStudent } from "@/app/students/manage-actions";
import { toast } from "sonner";
import { fmtIST } from "@/lib/datetime";
import { shortDate } from "@/lib/roster";
import { COURSES, COURSE_ITEMS, courseLabel, type Course } from "@/lib/courses";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Cell = {
  kind: "free" | "taken" | "na";
  studentName?: string;
  enrolmentId?: string;
  occupantDuration?: number; // 30 | 60 — for span rendering
  isOccupantStart?: boolean; // first atom of the occupying enrolment
  paused?: boolean; // occupant enrolment is paused — held but inactive
  fits30: boolean;
  fits60: boolean;
};
export type TeacherRow = {
  id: string;
  name: string;
  canEdit: boolean;
  cells: Record<string, Cell>; // key = "HH:MM"
  taken: number;
  total: number;
};

type Target = { teacherId: string; time: string };
type Duration = 30 | 60;

const NA: Cell = { kind: "na", fits30: false, fits60: false };
const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

export function TimelineBoard({
  axis,
  teachers,
  canPlace,
  students,
  showNames,
  linkTeachers = false,
}: {
  axis: string[];
  teachers: TeacherRow[];
  canPlace: boolean;
  students: { id: string; name: string }[];
  showNames: boolean;
  linkTeachers?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<Duration>(30);
  const [freeMenu, setFreeMenu] = useState<Target | null>(null);
  const [placeFor, setPlaceFor] = useState<Target | null>(null);
  const [detail, setDetail] = useState<EnrolmentDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // --- drag state (refs so the window listener never goes stale) ------------
  const downRef = useRef(false);
  const draggedRef = useRef(false);
  const modeRef = useRef<"publish" | "unpublish" | null>(null);
  const teacherRef = useRef<string | null>(null);
  const startRef = useRef<Target | null>(null);
  const selRef = useRef<Set<string>>(new Set());
  const [, force] = useState(0);
  const bump = () => force((v) => v + 1);

  const [flash, setFlash] = useState<Set<string>>(new Set());
  const fkey = (tid: string, time: string) => `${tid}|${time}`;
  function doFlash(keys: string[]) {
    setFlash(new Set(keys));
    setTimeout(() => setFlash(new Set()), 240);
  }

  const teacherById = (id: string) => teachers.find((t) => t.id === id);
  const cellOf = (t: TeacherRow, time: string): Cell => t.cells[time] ?? NA;
  const fitsFor = (c: Cell) => (duration === 60 ? c.fits60 : c.fits30);

  function act(target: Target, c: Cell) {
    const t = teacherById(target.teacherId);
    if (!t) return;
    if (c.kind === "taken") {
      if (!c.enrolmentId) return;
      setDetail(null);
      setDetailOpen(true);
      startTransition(async () => setDetail(await enrolmentDetail(c.enrolmentId!)));
      return;
    }
    if (!t.canEdit) return;
    if (c.kind === "free") setFreeMenu(target);
    else {
      // na → publish this atom
      setError(null);
      startTransition(async () => {
        const res = await publishSlot(target.teacherId, target.time);
        if (!res.ok) setError(res.error ?? "Could not publish");
        else {
          doFlash([fkey(target.teacherId, target.time)]);
          toast.success(`${target.time} published`);
        }
      });
    }
  }

  const finalizeRef = useRef<() => void>(() => {});
  finalizeRef.current = () => {
    if (!downRef.current) return;
    downRef.current = false;
    const mode = modeRef.current;
    const tid = teacherRef.current;
    if (draggedRef.current && mode && tid && selRef.current.size > 0) {
      const times = [...selRef.current];
      setError(null);
      startTransition(async () => {
        const res = mode === "publish" ? await bulkPublish(tid, times) : await bulkMakeUnavailable(tid, times);
        if (!res.ok) setError(res.error ?? "Bulk update failed");
        else {
          doFlash(times.map((x) => fkey(tid, x)));
          toast.success(`${times.length} times ${mode === "publish" ? "published" : "made unavailable"}`);
        }
      });
    } else if (startRef.current) {
      const s = startRef.current;
      const t = teacherById(s.teacherId);
      if (t) act(s, cellOf(t, s.time));
    }
    selRef.current = new Set();
    draggedRef.current = false;
    modeRef.current = null;
    teacherRef.current = null;
    startRef.current = null;
    bump();
  };
  useEffect(() => {
    const h = () => finalizeRef.current();
    window.addEventListener("mouseup", h);
    return () => window.removeEventListener("mouseup", h);
  }, []);

  function onDown(t: TeacherRow, time: string, c: Cell) {
    startRef.current = { teacherId: t.id, time };
    downRef.current = true;
    draggedRef.current = false;
    teacherRef.current = t.id;
    modeRef.current = !t.canEdit || c.kind === "taken" ? null : c.kind === "free" ? "unpublish" : "publish";
    selRef.current = modeRef.current ? new Set([time]) : new Set();
    bump();
  }
  function onEnter(t: TeacherRow, time: string, c: Cell) {
    if (!downRef.current || teacherRef.current !== t.id || !modeRef.current) return;
    const eligible = (modeRef.current === "publish" && c.kind === "na") || (modeRef.current === "unpublish" && c.kind === "free");
    if (eligible && !selRef.current.has(time)) {
      selRef.current.add(time);
      draggedRef.current = true;
      bump();
    }
  }

  const cols = { gridTemplateColumns: `repeat(${axis.length}, minmax(36px, 1fr))` };
  const idxOf = new Map(axis.map((t, i) => [t, i] as const));

  if (axis.length === 0) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No published times yet.</p>;
  }

  return (
    <div className="select-none space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Duration picker — pick the session length first; the strip then shows
          where a session of that length can start. */}
      {canPlace && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Session length</span>
          <div className="inline-flex overflow-hidden rounded-md border">
            {([30, 60] as Duration[]).map((d) => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-3 py-1 font-medium transition-colors ${
                  duration === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
          {duration === 60 && (
            <span className="text-xs text-muted-foreground">A 60 needs two free atoms in a row.</span>
          )}
        </div>
      )}

      <div className="overflow-x-auto pb-1">
        <div>
          {/* Ruler — hours only */}
          <div className="flex items-end">
            {showNames && <div className="w-36 shrink-0" />}
            <div className="grid flex-1" style={cols}>
              {axis.map((t) => (
                <div key={t} className="text-[10px] tabular-nums text-muted-foreground">
                  {t.endsWith(":00") ? t : ""}
                </div>
              ))}
            </div>
          </div>

          {teachers.map((t) => (
            <div key={t.id} className="flex items-center py-2">
              {showNames && (
                <div className="w-36 shrink-0 pr-3">
                  <div className="truncate text-sm font-medium">
                    {linkTeachers ? (
                      <Link href={`/availability?teacher=${t.id}`} className="hover:underline">
                        {t.name}
                      </Link>
                    ) : (
                      t.name
                    )}
                  </div>
                  <div className="text-lg font-semibold tabular-nums leading-none">
                    {t.taken}/{t.total}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t.total ? Math.round((t.taken / t.total) * 100) : 0}% utilised
                  </div>
                </div>
              )}

              <div className="grid flex-1 gap-0.5" style={cols}>
                {axis.map((time) => {
                  const c = cellOf(t, time);
                  const i = idxOf.get(time)!;

                  // A 60's continuation atom is drawn as part of the start cell's
                  // span — skip it so we don't render two boxes.
                  if (c.kind === "taken" && c.isOccupantStart === false) return null;

                  const span = c.kind === "taken" && c.occupantDuration === 60 ? 2 : 1;
                  const selected = teacherRef.current === t.id && selRef.current.has(time);
                  const flashing = flash.has(fkey(t.id, time));
                  const fits = fitsFor(c);

                  let cls = "bg-transparent";
                  let inner: React.ReactNode = null;
                  if (c.kind === "free") {
                    // Free & fits the chosen duration = bright ACTION blue. Free but
                    // no room for this duration = dim (still free for a 30).
                    cls = fits
                      ? "bg-primary text-primary-foreground cursor-pointer hover:z-10 hover:scale-[1.03] hover:brightness-110 active:scale-[0.97]"
                      : "bg-primary/25 text-primary-foreground/70 cursor-pointer";
                  } else if (c.kind === "taken") {
                    // Paused = held but inactive → muted + diagonal stripes so it
                    // reads as occupied-but-paused at a glance (flat, no blur).
                    cls = c.paused
                      ? "cursor-pointer border border-dashed border-amber-300 bg-[repeating-linear-gradient(45deg,var(--muted),var(--muted)_5px,transparent_5px,transparent_10px)] text-muted-foreground/70"
                      : "bg-muted text-muted-foreground cursor-pointer";
                    inner = (
                      <span className="truncate">
                        {c.studentName}
                        {c.paused && <span className="ml-1 text-[9px] uppercase text-amber-600">paused</span>}
                      </span>
                    );
                  } else if (t.canEdit) {
                    cls =
                      "cursor-pointer border border-dashed border-border bg-muted/20 text-muted-foreground/40 hover:border-primary/60 hover:bg-primary/5 hover:text-primary";
                    inner = <span className="text-base leading-none">+</span>;
                  }

                  const label =
                    c.kind === "free"
                      ? fits
                        ? `Free — fits a ${duration}`
                        : `Free — no room for a ${duration} here`
                      : c.kind === "taken"
                        ? `${c.studentName} (${c.occupantDuration} min)${c.paused ? " — paused, slot held" : ""}`
                        : "Not published — click to publish";

                  return (
                    <div
                      key={time}
                      role="button"
                      tabIndex={0}
                      aria-label={`${time} — ${label}`}
                      title={`${time} · ${label}`}
                      style={{ gridColumn: `${i + 1} / span ${span}` }}
                      onMouseDown={() => onDown(t, time, c)}
                      onMouseEnter={() => onEnter(t, time, c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          act({ teacherId: t.id, time }, c);
                        }
                      }}
                      className={`relative flex h-11 items-center justify-center overflow-hidden rounded-sm px-1 text-[11px] font-medium outline-none transition-transform duration-150 ease-out focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring ${cls} ${
                        selected ? "z-10 ring-2 ring-primary" : ""
                      } ${flashing ? "motion-flash z-10" : ""}`}
                    >
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm bg-primary" /> Free — click to place ({duration} min)
        </span>
        {duration === 60 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-5 rounded-sm bg-primary/25" /> Free — too short for a 60
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm bg-muted" /> Taken (a 60 spans two atoms)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-3 w-5 items-center justify-center rounded-sm border border-dashed border-border bg-muted/20 text-[9px] leading-none text-muted-foreground/60">
            +
          </span>
          Not published — click or drag to open the time
        </span>
      </div>

      {/* Free atom → place or unpublish */}
      <Dialog open={!!freeMenu} onOpenChange={(o) => !o && setFreeMenu(null)}>
        <DialogContent className="duration-150 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{freeMenu?.time} — free</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {canPlace &&
              (freeMenu && fitsFor(cellOf(teacherById(freeMenu.teacherId)!, freeMenu.time)) ? (
                <Button
                  onClick={() => {
                    setPlaceFor(freeMenu);
                    setFreeMenu(null);
                  }}
                >
                  Place a student here ({duration} min)
                </Button>
              ) : (
                <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  A {duration}-min session won&apos;t fit starting here. Switch to 30 min, or pick a time with a free
                  atom right after it.
                </p>
              ))}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                const target = freeMenu;
                setFreeMenu(null);
                if (!target) return;
                setError(null);
                startTransition(async () => {
                  const res = await makeUnavailable(target.teacherId, target.time);
                  if (!res.ok) setError(res.error ?? "Failed");
                  else {
                    doFlash([fkey(target.teacherId, target.time)]);
                    toast.success(`${target.time} made unavailable`);
                  }
                });
              }}
            >
              Make unavailable
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Placement */}
      <Dialog open={!!placeFor} onOpenChange={(o) => !o && setPlaceFor(null)}>
        <DialogContent className="duration-150 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Place a student — {placeFor?.time} · {duration} min
            </DialogTitle>
          </DialogHeader>
          {placeFor && (
            <PlacementForm
              teacherId={placeFor.teacherId}
              time={placeFor.time}
              duration={duration}
              students={students}
              onDone={() => {
                doFlash([fkey(placeFor.teacherId, placeFor.time)]);
                toast.success(`Student placed at ${placeFor.time} (${duration} min)`);
                setPlaceFor(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Taken → drill-down */}
      <Dialog open={detailOpen} onOpenChange={(o) => !o && setDetailOpen(false)}>
        <DialogContent className="duration-150 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detail ? detail.student : "Details"}</DialogTitle>
          </DialogHeader>
          {!detail && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-6">
                <Skeleton className="h-9 w-16" />
                <Skeleton className="h-9 w-16" />
                <Skeleton className="h-9 w-16" />
              </div>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>{detail.teacher}</span>·<Badge variant="outline">{courseLabel(detail.course)}</Badge>·
                <span>{detail.slot}</span>·<Badge variant="secondary">{detail.status}</Badge>
                {detail.migrated && <Badge variant="outline">Migrated</Badge>}
              </div>
              <div className="flex gap-6">
                <Stat label="Sessions" value={detail.total ?? "—"} />
                <Stat
                  label="Delivered"
                  value={
                    detail.legacyDelivered > 0
                      ? `${detail.legacyDelivered + detail.delivered}`
                      : detail.delivered
                  }
                />
                <Stat label="Remaining" value={detail.remaining ?? "—"} />
              </div>
              {detail.legacyDelivered > 0 && (
                <p className="text-xs text-muted-foreground">
                  {detail.legacyDelivered} legacy + {detail.delivered} here ={" "}
                  {detail.legacyDelivered + detail.delivered}
                  {detail.total != null ? ` of ${detail.total}` : ""}
                </p>
              )}
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase text-muted-foreground">Slot frees up</p>
                {detail.freesUpDate ? (
                  <p>
                    {detail.remaining != null && <strong>{detail.remaining} left</strong>}
                    {detail.remaining != null && " · "}
                    frees ~<strong>{shortDate(detail.freesUpDate)}</strong>{" "}
                    <span className="text-xs text-muted-foreground">
                      ({detail.freesUpBy === "sessions" ? "session count" : "end date"} binds first)
                    </span>
                  </p>
                ) : (
                  <p className="text-muted-foreground">No cap set.</p>
                )}
              </div>

              {detail.payment && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Payments</p>
                    <a href={`/roster/${detail.studentId}`} className="text-xs text-primary underline">
                      Manage in roster →
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span>
                      <span className="text-muted-foreground">Fee</span>{" "}
                      <strong>{detail.payment.totalFee == null ? "—" : `₹${inrFmt.format(detail.payment.totalFee)}`}</strong>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Paid</span>{" "}
                      <strong>₹{inrFmt.format(detail.payment.paid)}</strong>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Remaining</span>{" "}
                      <strong className={detail.payment.feeRemaining != null && detail.payment.feeRemaining > 0 ? "text-amber-600" : ""}>
                        {detail.payment.feeRemaining == null ? "unknown" : `₹${inrFmt.format(detail.payment.feeRemaining)}`}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Recent classes</p>
                {detail.recent.length === 0 ? (
                  <p className="text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {detail.recent.map((c, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="tabular-nums">{fmtIST(c.when)}</span>
                        <Badge variant="outline">{c.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {canPlace && detail.status === "active" && (
                <DialogFooter>
                  <Button
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        const res = await endEnrolment(detail.enrolmentId);
                        if (!res.ok) setError(res.error ?? "Failed");
                        else {
                          toast.success("Enrolment ended — slot freed");
                          setDetailOpen(false);
                        }
                      });
                    }}
                  >
                    End enrolment (frees the slot)
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
    </div>
  );
}

function PlacementForm({
  teacherId,
  time,
  duration,
  students,
  onDone,
}: {
  teacherId: string;
  time: string;
  duration: Duration;
  students: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"enrolled" | "demo">("enrolled");
  const [list, setList] = useState(students);
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [course, setCourse] = useState<Course>("basic");
  const [newName, setNewName] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [total, setTotal] = useState("20");
  // demo-only fields
  const [demoDate, setDemoDate] = useState(today);
  const [expectedJoin, setExpectedJoin] = useState("");

  function addNew() {
    if (!newName.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createStudent({ name: newName, status: "lead" });
      if (!res.ok || !res.id) setError(res.error ?? "Could not add student");
      else {
        setList((l) => [...l, { id: res.id!, name: res.name ?? newName }]);
        setStudentId(res.id);
        setNewName("");
      }
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "demo"
          ? await placeDemo({
              teacher_id: teacherId,
              student_id: studentId,
              slot_start: time,
              duration_minutes: duration,
              demo_date: demoDate,
              expected_joining_date: expectedJoin || undefined,
            })
          : await placeStudent({
              teacher_id: teacherId,
              student_id: studentId,
              course,
              slot_start: time,
              duration_minutes: duration,
              start_date: startDate,
              end_date: endDate || undefined,
              total_sessions: total || undefined,
            });
      if (!res.ok) setError(res.error ?? "Failed");
      else onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setKind("enrolled")}
          className={`rounded px-3 py-1 ${kind === "enrolled" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Enrolled
        </button>
        <button
          type="button"
          onClick={() => setKind("demo")}
          className={`rounded px-3 py-1 ${kind === "demo" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Demo
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Student</Label>
        <Select
          items={Object.fromEntries(list.map((s) => [s.id, s.name]))}
          value={studentId}
          onValueChange={(v) => v && setStudentId(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose a student" />
          </SelectTrigger>
          <SelectContent>
            {list.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-end gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="or add a new student…"
            className="h-8 text-sm"
          />
          <Button type="button" size="sm" variant="outline" disabled={pending || !newName.trim()} onClick={addNew}>
            + New
          </Button>
        </div>
      </div>

      {kind === "enrolled" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Course</Label>
            <Select items={COURSE_ITEMS} value={course} onValueChange={(v) => v && setCourse(v as Course)}>
              <SelectTrigger className="w-48">
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
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End (opt)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sessions (opt)</Label>
              <Input type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {duration}-min session on open days at {time}. Set an end date and/or a session count — the database requires at
            least one.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Demo date</Label>
              <Input type="date" value={demoDate} onChange={(e) => setDemoDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Expected joining (opt)</Label>
              <Input type="date" value={expectedJoin} onChange={(e) => setExpectedJoin(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            One-off {duration}-min demo at {time} on the chosen date. No recurring enrolment is created.
          </p>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button onClick={submit} disabled={pending}>
          {pending ? "Placing…" : kind === "demo" ? "Place demo" : "Place student"}
        </Button>
      </DialogFooter>
    </div>
  );
}
