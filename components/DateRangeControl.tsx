import Link from "next/link";
import { PRESETS, rangeHref, type DateRange } from "@/lib/date-range";

// Range control: quick presets plus a custom from/to. URL-persisted so the
// range survives refresh and is shareable. The custom picker is a plain GET
// form — no client JS, and it lands on ?from=&to= which parseRange already
// understands.
export function DateRangeControl({ path, range }: { path: string; range: DateRange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="inline-flex overflow-hidden rounded-md border text-xs">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={rangeHref(path, p.key)}
            className={`px-3 py-1.5 font-medium transition-colors ${
              range.preset === p.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form action={path} method="get" className="flex flex-wrap items-center gap-2 text-xs">
        <label className="text-muted-foreground" htmlFor={`${path}-from`}>
          From
        </label>
        <input
          id={`${path}-from`}
          type="date"
          name="from"
          defaultValue={range.from}
          max={range.to}
          className="h-8 rounded-md border bg-background px-2 text-xs outline-none ring-ring focus:ring-2"
        />
        <label className="text-muted-foreground" htmlFor={`${path}-to`}>
          to
        </label>
        <input
          id={`${path}-to`}
          type="date"
          name="to"
          defaultValue={range.to}
          min={range.from}
          className="h-8 rounded-md border bg-background px-2 text-xs outline-none ring-ring focus:ring-2"
        />
        <button
          type="submit"
          className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted"
        >
          Apply
        </button>
      </form>

      {range.preset === null && (
        <span className="text-xs tabular-nums text-muted-foreground">custom range</span>
      )}
    </div>
  );
}
