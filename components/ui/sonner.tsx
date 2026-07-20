"use client";

import { Toaster as Sonner } from "sonner";

// Success toasts: fade + slight rise (sonner's default enter is a short
// translate+fade). Short duration so it never blocks a tool people use all day.
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
        },
      }}
    />
  );
}
