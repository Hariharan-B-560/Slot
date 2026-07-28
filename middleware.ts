import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Pages reachable while signed OUT.
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
// Prefixes only an admin may reach — enforced HERE, server-side, not by hiding nav.
const ADMIN_PREFIXES = ["/verify", "/teachers", "/counsellors", "/roster", "/dashboard", "/integrity", "/reschedules"];

function redirect(request: NextRequest, to: string, carry: NextResponse) {
  const res = NextResponse.redirect(new URL(to, request.url));
  // Carry any refreshed auth cookies onto the redirect.
  carry.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.includes(path);
  const isAuthApi = path.startsWith("/auth/");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // --- Signed out ------------------------------------------------------------
  if (!user) {
    if (isPublic || isAuthApi) return response;
    return redirect(request, "/login", response);
  }

  // --- Signed in: resolve identity from the DB (own row via RLS) -------------
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  // No profile, or retired → they can do nothing; send them out.
  if (!profile || profile.active === false) {
    if (isAuthApi) return response; // allow logout
    await supabase.auth.signOut();
    return redirect(request, "/login", response);
  }

  // --- Forced password change: locked to that screen -------------------------
  if (profile.must_change_password) {
    if (path === "/change-password" || isAuthApi) return response;
    return redirect(request, "/change-password", response);
  }

  // --- Normal, active session ------------------------------------------------
  const counsellorArea = path === "/counsellor" || path.startsWith("/counsellor/");

  // Counsellors are read-only and confined to their own area. Anything else
  // (login page while signed in, an admin/teacher route) sends them home —
  // except the auth API (logout must get through).
  if (profile.role === "counsellor") {
    if (isAuthApi) return response;
    if (!counsellorArea) return redirect(request, "/counsellor/availability", response);
    return response;
  }

  if (isPublic) return redirect(request, "/availability", response); // already signed in

  // The counsellor area is off-limits to admins and teachers.
  if (counsellorArea) return redirect(request, "/availability", response);

  const adminOnly = ADMIN_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  if (adminOnly && profile.role !== "admin") {
    // Teacher hitting an admin route — blocked server-side.
    return redirect(request, "/availability", response);
  }

  return response;
}

export const config = {
  // Skip Next internals and static brand assets (logo/favicon must load on the
  // signed-out login screen too).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png).*)"],
};
