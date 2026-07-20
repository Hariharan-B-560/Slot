"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  CalendarDays,
  Users,
  ClipboardCheck,
  BadgeCheck,
  GraduationCap,
  UserCog,
  BarChart3,
  CalendarClock,
  ShieldAlert,
  Menu,
  X,
} from "lucide-react";
import { UserMenu } from "@/components/UserMenu";
import { GlobalSearch } from "@/components/GlobalSearch";
import {
  VerifyBadge,
  IntegrityDot,
  usePendingVerify,
  usePendingReschedules,
  useIntegrityAlert,
} from "@/components/VerifyBadge";
import type { Profile } from "@/lib/current-user";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const ADMIN_NAV: NavItem[] = [
  { href: "/availability", label: "Availability", icon: LayoutGrid },
  { href: "/classes", label: "Classes", icon: CalendarDays },
  { href: "/roster", label: "Roster", icon: Users },
  { href: "/verify", label: "Verify", icon: BadgeCheck },
  { href: "/integrity", label: "Integrity", icon: ShieldAlert },
  { href: "/reschedules", label: "Reschedules", icon: CalendarClock },
  { href: "/students", label: "Students", icon: GraduationCap },
  { href: "/teachers", label: "Teachers", icon: UserCog },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
];
const TEACHER_NAV: NavItem[] = [
  { href: "/availability", label: "My availability", icon: LayoutGrid },
  { href: "/deliver", label: "Today's classes", icon: ClipboardCheck },
  { href: "/classes", label: "Class history", icon: CalendarDays },
  { href: "/students", label: "My students", icon: GraduationCap },
];

/**
 * The app frame: brand + sidebar navigation (role-aware, active-state) and a
 * topbar with the page title and user menu. Pages render inside; middleware has
 * already guaranteed an authenticated, permitted user.
 */
export function AppShell({
  profile,
  title,
  actions,
  children,
  width = "max-w-5xl",
}: {
  profile: Profile;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = profile.role === "admin" ? ADMIN_NAV : TEACHER_NAV;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  // Pending-verify count for the nav badge — admin only (teachers have no
  // Verify item, and the hook stays inert / query-free when disabled).
  const pending = usePendingVerify(profile.role === "admin");
  const reschedPending = usePendingReschedules(profile.role === "admin");
  const integrityAlert = useIntegrityAlert(profile.role === "admin");

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
        <Image src="/logo.png" alt="The Easy English" width={28} height={28} className="h-7 w-7 shrink-0" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">The Easy English</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Slot booking</div>
        </div>
        <button className="ml-auto md:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-4 w-4" />
        </button>
      </div>
      <SidebarNav
        items={items}
        isActive={isActive}
        pending={pending}
        reschedPending={reschedPending}
        integrityAlert={integrityAlert}
        onNavigate={() => setOpen(false)}
      />
      <div className="border-t p-3 text-[11px] text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{profile.name}</span>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card md:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r bg-card transition-transform duration-150 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="hidden shrink-0 truncate text-base font-semibold sm:block sm:text-lg">{title}</h1>
          <div className="flex flex-1 justify-center px-1 sm:px-4">
            <GlobalSearch />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {actions}
            <UserMenu profile={profile} />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <div key={pathname} className={`page-enter mx-auto ${width}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}

// --- sidebar nav with a shared-element (FLIP) active pill --------------------
// ONE pill element slides between items rather than two backgrounds crossfading.
// It lives in its own component because the sidebar markup renders twice
// (desktop rail + mobile drawer) — each instance measures its own DOM.
// Reduced motion is handled globally in globals.css (transition-duration is
// forced to ~0), so the pill lands instantly with no slide.
const PILL_MS = 260;
// ease-out with a small overshoot on arrival — settles, never bounces.
const PILL_EASE = "cubic-bezier(0.22, 1.2, 0.36, 1)";

function SidebarNav({
  items,
  isActive,
  pending,
  reschedPending,
  integrityAlert,
  onNavigate,
}: {
  items: NavItem[];
  isActive: (href: string) => boolean;
  pending: { count: number; flagged: boolean };
  reschedPending: number;
  integrityAlert: boolean;
  onNavigate: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Off for the first placement so the pill appears under the active item
  // instead of sliding in from the corner; on for every move after that.
  const [slide, setSlide] = useState(false);

  const activeHref = items.find((it) => isActive(it.href))?.href ?? null;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) return setPill(null);
      setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    };
    measure();
    const raf = requestAnimationFrame(() => setSlide(true));
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [activeHref, items]);

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      {/* No padding here: item offsets and the pill share this exact origin. */}
      <div ref={listRef} className="relative space-y-0.5">
        {pill && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 rounded-md bg-primary/10"
            style={{
              width: pill.w,
              height: pill.h,
              transform: `translate3d(${pill.x}px, ${pill.y}px, 0)`,
              transition: slide
                ? `transform ${PILL_MS}ms ${PILL_EASE}, width ${PILL_MS}ms ${PILL_EASE}, height ${PILL_MS}ms ${PILL_EASE}`
                : undefined,
            }}
          />
        )}

        {items.map((it) => {
          const Icon = it.icon;
          const active = isActive(it.href);
          const isVerify = it.href === "/verify";
          const isResched = it.href === "/reschedules";
          const badgeCount = isVerify ? pending.count : isResched ? reschedPending : 0;
          return (
            <Link
              key={it.href}
              href={it.href}
              data-active={active ? "true" : undefined}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={badgeCount > 0 ? `${it.label}, ${badgeCount} pending` : undefined}
              // `relative` keeps icon/label above the pill. Once the pill is
              // measured it IS the background; until then (SSR / pre-hydration)
              // the active item paints the same flat fill in the same place, so
              // the hand-off is invisible — never two backgrounds at once.
              className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[260ms] ease-[cubic-bezier(0.22,1.2,0.36,1)] ${
                active
                  ? `text-primary${pill ? "" : " bg-primary/10"}`
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {it.label}
              {isVerify && <VerifyBadge count={pending.count} flagged={pending.flagged} />}
              {isResched && <VerifyBadge count={reschedPending} flagged={false} />}
              {it.href === "/integrity" && <IntegrityDot show={integrityAlert} />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
