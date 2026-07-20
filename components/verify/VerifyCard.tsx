"use client";

import { useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { VerifyActions } from "@/components/verify/VerifyRow";
import { fmtIST } from "@/lib/datetime";
import { courseLabel } from "@/lib/courses";
import { Badge } from "@/components/ui/badge";

// One review card. Signed URLs are generated SERVER-SIDE and passed in as
// props; this component only renders them and tracks whether the two
// screenshots actually loaded — Verify/Flag stay disabled until both do, so an
// admin can never verify evidence they can't see (rule 5).

export type VerifyCardData = {
  id: string;
  scheduled_start: string;
  status: string;
  flag_reason: string | null;
  teacherName: string;
  studentName: string;
  course: string | null;
  attendance: string | null;
  absentReason: string | null;
  notes: string | null;
  openingUrl: string | null;
  closingUrl: string | null;
  recordingUrl: string | null;
};

type LoadState = "loading" | "loaded" | "error";

function Evidence({ url, label, onState }: { url: string | null; label: string; onState: (s: LoadState) => void }) {
  // A null URL can never load — report the error state immediately (once).
  const [state, setState] = useState<LoadState>(url ? "loading" : "error");

  function set(s: LoadState) {
    setState(s);
    onState(s);
  }
  if (!url && state !== "error") set("error");

  return (
    <figure className="flex min-w-0 flex-1 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-muted-foreground">{label}</figcaption>
      <div className="relative flex min-h-56 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
        {state === "error" ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-sm text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            Couldn&apos;t load evidence — try refresh
          </div>
        ) : (
          <>
            {state === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url!}
              alt={label}
              className={`max-h-[28rem] w-full object-contain transition-opacity ${
                state === "loaded" ? "opacity-100" : "opacity-0"
              }`}
              onLoad={() => set("loaded")}
              onError={() => set("error")}
            />
          </>
        )}
      </div>
    </figure>
  );
}

export function VerifyCard({ r }: { r: VerifyCardData }) {
  const [opening, setOpening] = useState<LoadState>("loading");
  const [closing, setClosing] = useState<LoadState>("loading");
  const bothLoaded = opening === "loaded" && closing === "loaded";

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">
            {r.teacherName} → {r.studentName}
          </div>
          <div className="tabular-nums text-muted-foreground">
            {fmtIST(r.scheduled_start)} · {r.course ? courseLabel(r.course) : "demo"} · attendance:{" "}
            <span className="font-medium text-foreground">{r.attendance ?? "—"}</span>
            {r.absentReason ? ` (${r.absentReason})` : ""}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={r.status === "flagged" ? "destructive" : "secondary"}>{r.status}</Badge>
            {r.status === "flagged" && r.flag_reason && (
              <span className="text-xs text-destructive">{r.flag_reason}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <VerifyActions classId={r.id} status={r.status} disabled={!bothLoaded} />
          {!bothLoaded && (
            <span className="text-xs text-muted-foreground">Loading evidence… actions unlock once both load</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Evidence url={r.openingUrl} label="Opening screenshot" onState={setOpening} />
        <Evidence url={r.closingUrl} label="Closing screenshot" onState={setClosing} />
      </div>

      {(r.recordingUrl || r.notes) && (
        <div className="mt-4 space-y-2">
          {r.recordingUrl && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Recording</div>
              <video controls preload="metadata" className="max-h-72 w-full rounded-md border" src={r.recordingUrl} />
              <a
                href={r.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-primary underline"
              >
                Open recording ↗
              </a>
            </div>
          )}
          {r.notes && <p className="max-w-prose text-sm text-muted-foreground">“{r.notes}”</p>}
        </div>
      )}
    </div>
  );
}
