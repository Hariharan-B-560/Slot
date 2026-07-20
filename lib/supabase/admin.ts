import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. SERVER-ONLY, and used ONLY for
 * admin-gated availability writes (an admin editing another teacher's
 * availability_blocks, which the RLS teacher-owns policy would otherwise
 * block). Callers MUST verify the acting user is an admin before using this.
 * Never import from client components.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
