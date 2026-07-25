"use client";

import { Toaster as Sonner } from "sonner";

// Success = green, error = red — the two states read at a glance. Flat fills
// (no blur/shadow-heavy), reusing the emerald/red tints already in the app.
// The `!` wins over the neutral base for typed toasts; plain toast() stays card.
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={2600}
      toastOptions={{
        classNames: {
          toast:
            "group rounded-md border bg-card text-card-foreground shadow-sm text-sm px-3 py-2",
          description: "text-muted-foreground",
          success: "!border-emerald-300 !bg-emerald-50 !text-emerald-800",
          error: "!border-red-300 !bg-red-50 !text-red-800",
        },
      }}
    />
  );
}
