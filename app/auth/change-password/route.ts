import { type NextRequest } from "next/server";
import { routeClient, withCookies, seeOther } from "@/lib/supabase/route";

/**
 * The signed-in user sets their own new password, then we clear
 * must_change_password so they can act. Both run as the user: updateUser hits
 * auth.users; the profiles flip goes through the self-update carve-out (the
 * guard trigger allows only must_change_password true -> false).
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password.length < 8) return seeOther(request, "/change-password", { error: "Use at least 8 characters" });
  if (password !== confirm) return seeOther(request, "/change-password", { error: "Passwords do not match" });

  const { supabase, bag } = routeClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return seeOther(request, "/login");

  const { error: pwErr } = await supabase.auth.updateUser({ password });
  if (pwErr) return seeOther(request, "/change-password", { error: pwErr.message });

  const { error: profErr } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);
  if (profErr) return seeOther(request, "/change-password", { error: profErr.message });

  return withCookies(seeOther(request, "/availability"), bag);
}
