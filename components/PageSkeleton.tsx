import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading placeholders that match each page's real layout, so when
 * data lands there is no shift and no spinner. Header height mirrors the page's
 * <header> (title + nav).
 */
function Header() {
  return (
    <div className="mb-8 flex items-center justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-8 w-40" />
    </div>
  );
}

export function StripSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Header />
      <Skeleton className="mb-3 h-4 w-80" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-12 w-32 shrink-0" />
            <Skeleton className="h-11 flex-1" />
          </div>
        ))}
      </div>
    </main>
  );
}

export function TableSkeleton({ rows = 6, wide = false }: { rows?: number; wide?: boolean }) {
  return (
    <main className={`mx-auto ${wide ? "max-w-6xl" : "max-w-4xl"} px-6 py-10`}>
      <Header />
      <div className="rounded-lg border">
        <Skeleton className="h-10 w-full rounded-b-none" />
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export function DashboardSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Header />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="mb-8 h-72 w-full" />
      <Skeleton className="h-40 w-full" />
    </main>
  );
}
