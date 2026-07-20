import type { Profile } from "@/lib/current-user";

/**
 * Signed-in identity + sign out. A plain form POST to the logout route handler,
 * so it works without JavaScript.
 */
export function UserMenu({ profile }: { profile: Profile | null }) {
  if (!profile) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        {profile.name}{" "}
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase">{profile.role}</span>
      </span>
      <form method="post" action="/auth/logout">
        <button className="rounded border px-2 py-1 text-sm hover:bg-muted">Sign out</button>
      </form>
    </div>
  );
}
