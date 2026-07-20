"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X, Check, Loader2, RotateCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// A real dropzone for a single screenshot: tap/drop → thumbnail + filename +
// real upload progress → checkmark. Uploads happen on select (via XHR so we get
// byte-level progress), and the resulting storage path is handed back through
// onChange. Removing clears it. Storage RLS still applies — the user can only
// write under a class they own.

type State =
  | { s: "idle" }
  | { s: "uploading"; progress: number; url: string; name: string }
  | { s: "done"; path: string; url: string; name: string }
  | { s: "error"; msg: string; url: string; name: string; file: File };

function uploadWithProgress(file: File, path: string, token: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    xhr.open("POST", `${base}/storage/v1/object/session-evidence/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    xhr.setRequestHeader("x-upsert", "false");
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
}

export function UploadZone({
  label,
  classId,
  kind,
  onChange,
}: {
  label: string;
  classId: string;
  kind: "opening" | "closing";
  onChange: (path: string | null) => void;
}) {
  const [state, setState] = useState<State>({ s: "idle" });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastUrl = useRef<string | null>(null);

  // Revoke object URLs so previews don't leak memory.
  useEffect(() => {
    return () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, []);

  async function start(file: File) {
    if (!file.type.startsWith("image/")) {
      // reuse the error card so the message is in plain words, tap-to-retry style
      const url = URL.createObjectURL(file);
      swapUrl(url);
      setState({ s: "error", msg: "That's not an image — tap to choose another", url, name: file.name, file });
      onChange(null);
      return;
    }
    const url = URL.createObjectURL(file);
    swapUrl(url);
    setState({ s: "uploading", progress: 0, url, name: file.name });
    onChange(null);

    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setState({ s: "error", msg: "Couldn't upload — tap to retry", url, name: file.name, file });
      return;
    }
    const ext = file.name.split(".").pop() || "png";
    const path = `${classId}/${kind}-${Date.now()}.${ext}`;
    try {
      await uploadWithProgress(file, path, token, (p) =>
        setState((prev) => (prev.s === "uploading" ? { ...prev, progress: p } : prev)),
      );
      setState({ s: "done", path, url, name: file.name });
      onChange(path);
    } catch {
      setState({ s: "error", msg: "Couldn't upload — tap to retry", url, name: file.name, file });
      onChange(null);
    }
  }

  function swapUrl(url: string) {
    if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    lastUrl.current = url;
  }

  function clear() {
    if (lastUrl.current) {
      URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = null;
    }
    setState({ s: "idle" });
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const inputId = `upload-${kind}`;
  const hasImage = state.s !== "idle";

  return (
    <div className="flex flex-col gap-1.5">
      {/* accept=image/* on mobile offers camera roll + camera directly */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) start(f);
        }}
      />

      {!hasImage ? (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) start(f);
          }}
          className={`flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
            drag ? "border-primary bg-primary/10" : "border-primary/40 text-primary hover:bg-primary/5"
          }`}
        >
          <ImagePlus className="h-6 w-6" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-[11px] text-muted-foreground">Tap to add or drop an image</span>
        </label>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{state.name}</div>
            {state.s === "uploading" && (
              <div className="mt-1.5" role="progressbar" aria-valuenow={Math.round(state.progress * 100)}>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full origin-left bg-primary transition-transform duration-150 ease-out"
                    style={{ transform: `scaleX(${Math.max(0.05, state.progress)})` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading… {Math.round(state.progress * 100)}%
                </div>
              </div>
            )}
            {state.s === "done" && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <Check className="h-3.5 w-3.5" /> Uploaded
              </div>
            )}
            {state.s === "error" && (
              <button
                type="button"
                onClick={() => start(state.file)}
                className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-destructive"
              >
                <RotateCw className="h-3.5 w-3.5" /> {state.msg}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label={`Remove ${label}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
