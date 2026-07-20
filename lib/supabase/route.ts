import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client for Route Handlers. Session cookies written during sign-in /
 * sign-out are collected in `bag`; call withCookies() to attach them to the
 * final (redirect) response so the browser actually receives the session.
 */
export function routeClient(request: NextRequest) {
  const bag = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list: CookieToSet[]) {
          list.forEach(({ name, value, options }) => bag.cookies.set(name, value, options));
        },
      },
    },
  );
  return { supabase, bag };
}

export function withCookies(res: NextResponse, bag: NextResponse) {
  bag.cookies.getAll().forEach((c) => res.cookies.set(c));
  return res;
}

export function seeOther(request: NextRequest, to: string, params?: Record<string, string>) {
  const url = new URL(to, request.url);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url, { status: 303 });
}
