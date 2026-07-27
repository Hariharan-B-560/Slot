import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/current-user";

// Server-side gate for the whole counsellor area: only a counsellor may enter.
// Middleware also enforces this; the layout is the in-app second line of defence
// (matching how every other page resolves its own role before rendering).
export default async function CounsellorLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "counsellor") redirect("/availability");
  return <>{children}</>;
}
