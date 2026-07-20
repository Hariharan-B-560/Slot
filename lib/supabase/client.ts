import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client (uses the cookie session). Used for direct Storage
 * uploads from the delivery form so large files skip the server-action body
 * limit. Storage RLS still applies — a teacher can only write under a class
 * they own.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
