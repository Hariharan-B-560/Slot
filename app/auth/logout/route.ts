import { type NextRequest } from "next/server";
import { routeClient, withCookies, seeOther } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const { supabase, bag } = routeClient(request);
  await supabase.auth.signOut();
  return withCookies(seeOther(request, "/login"), bag);
}
