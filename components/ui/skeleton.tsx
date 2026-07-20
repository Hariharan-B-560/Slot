import { cn } from "@/lib/utils";

// A neutral placeholder block that matches the final layout's shape, so data
// landing causes no layout shift. Pulse respects prefers-reduced-motion (the
// keyframe is disabled in globals.css under the media query).
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("motion-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
