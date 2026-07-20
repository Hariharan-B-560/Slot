"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, GraduationCap, UserCog, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// One box across everything. Queries run through the browser Supabase client, so
// they use the signed-in user's session — RLS decides what comes back. Results
// are grouped (Students / Teachers) and each links straight to that record.

type Hit =
  | { type: "student"; id: string; label: string; sub: string; href: string }
  | { type: "teacher"; id: string; label: string; sub: string; href: string };

export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);

  // "/" focuses the box from anywhere (unless you're already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
      if (typing) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced query (~200ms). Each keystroke resets the timer; an in-flight
  // result is ignored if the query has since changed (stale-guard via `seq`).
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${term.replace(/[%_,]/g, " ")}%`;
      const [students, teachers] = await Promise.all([
        supabase
          .from("students")
          .select("id, name, phone, status")
          .or(`name.ilike.${like},phone.ilike.${like}`)
          .limit(6),
        supabase
          .from("profiles")
          .select("id, name, email")
          .eq("role", "teacher")
          .or(`name.ilike.${like},email.ilike.${like}`)
          .limit(6),
      ]);
      if (mine !== seq.current) return; // a newer query already superseded this
      const s: Hit[] = (students.data ?? []).map((r) => ({
        type: "student",
        id: r.id as string,
        label: r.name as string,
        sub: (r.phone as string | null) ?? (r.status as string) ?? "student",
        href: `/roster/${r.id}`,
      }));
      const t2: Hit[] = (teachers.data ?? []).map((r) => ({
        type: "teacher",
        id: r.id as string,
        label: r.name as string,
        sub: (r.email as string | null) ?? "teacher",
        href: `/availability?teacher=${r.id}`,
      }));
      setHits([...s, ...t2]);
      setActive(0);
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const groups = useMemo(() => {
    const students = hits.filter((h) => h.type === "student");
    const teachers = hits.filter((h) => h.type === "teacher");
    return { students, teachers, flat: [...students, ...teachers] };
  }, [hits]);

  function go(h: Hit) {
    setOpen(false);
    setQ("");
    setHits([]);
    inputRef.current?.blur();
    router.push(h.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    const n = groups.flat.length;
    if (e.key === "ArrowDown" && n) {
      e.preventDefault();
      setActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      setActive((i) => (i - 1 + n) % n);
    } else if (e.key === "Enter" && n) {
      e.preventDefault();
      const h = groups.flat[active];
      if (h) go(h);
    }
  }

  const showPanel = open && q.trim().length >= 1;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search students, teachers…"
          aria-label="Search"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none ring-ring transition-shadow placeholder:text-muted-foreground focus:ring-2"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground sm:block">
          /
        </kbd>
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-md border bg-popover shadow-lg">
          {loading && groups.flat.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : groups.flat.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No matches.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto py-1">
              <Group title="Students" icon={GraduationCap} rows={groups.students} active={active} flat={groups.flat} onPick={go} />
              <Group title="Teachers" icon={UserCog} rows={groups.teachers} active={active} flat={groups.flat} onPick={go} offset={groups.students.length} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  icon: Icon,
  rows,
  active,
  flat,
  onPick,
  offset = 0,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: Hit[];
  active: number;
  flat: Hit[];
  onPick: (h: Hit) => void;
  offset?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      {rows.map((h, i) => {
        const idx = offset + i;
        const isActive = flat[active]?.id === h.id && flat[active]?.type === h.type;
        return (
          <button
            key={`${h.type}-${h.id}`}
            type="button"
            // pointer-down (not click) so it fires before the outside-click closer
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(h);
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
              isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
            }`}
            data-idx={idx}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{h.label}</span>
            <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{h.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
