import { type NextRequest } from "next/server";
import { routeClient, seeOther } from "@/lib/supabase/route";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();

  if (email) {
    const { supabase } = routeClient(request);
    const redirectTo = new URL("/reset-password", request.url).toString();
    // Fire and don't reveal whether the email exists (no account enumeration).
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  }

  return seeOther(request, "/login", {
    msg: "If that email has an account, a reset link is on its way.",
  });
}
