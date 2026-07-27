import { type NextRequest } from "next/server";
import { routeClient, withCookies, seeOther } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return seeOther(request, "/login", { error: "Enter your email and password" });

  const { supabase, bag } = routeClient(request);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return seeOther(request, "/login", { error: "Invalid email or password" });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("active, must_change_password, role")
    .eq("id", user!.id)
    .maybeSingle();

  if (!profile || profile.active === false) {
    await supabase.auth.signOut();
    return seeOther(request, "/login", { error: "This account is not active. Contact your admin." });
  }

  // Counsellors live in their own read-only area; everyone else lands on availability.
  const home = profile.role === "counsellor" ? "/counsellor/availability" : "/availability";
  const dest = profile.must_change_password ? "/change-password" : home;
  return withCookies(seeOther(request, dest), bag);
}
