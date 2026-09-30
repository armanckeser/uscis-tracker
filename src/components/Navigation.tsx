import { Activity, Shield } from "lucide-react";
import type { RouteId } from "../hooks/useRoute";
import { ageInDays, relativeFromNow } from "../lib/format";
import { Brand } from "./Brand";

const NAV_ITEMS: Array<{ id: RouteId; label: string; icon: typeof Activity }> = [
  { id: "home", label: "Timeline", icon: Activity },
  { id: "connection", label: "Connection", icon: Shield },
];

type NavProps = { route: RouteId; navigate: (route: RouteId) => void };

/** How stale the last read is: fresh under 3 days, amber from 3, red from 7. */
export function freshness(lastCheckedAt: string | null, now = Date.now()): { label: string; level: "fresh" | "stale" | "old" | "none" } {
  const days = ageInDays(lastCheckedAt, now);
  if (days === null) return { label: "Not checked yet", level: "none" };
  if (days >= 7) return { label: `Stale · ${days}d`, level: "old" };
  if (days >= 3) return { label: `Stale · ${days}d`, level: "stale" };
  return { label: `Checked ${relativeFromNow(lastCheckedAt)}`, level: "fresh" };
}

export function TopBar({
  route,
  navigate,
  lastCheckedAt,
  onOpenFreshness,
}: NavProps & { lastCheckedAt: string | null; onOpenFreshness: () => void }) {
  const fresh = freshness(lastCheckedAt);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <nav className="segmented" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.id === "home" ? "/" : "/connection"}
              aria-current={route === item.id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.id);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button type="button" className={`fresh-pill fresh-${fresh.level}`} onClick={onOpenFreshness} aria-haspopup="dialog">
          <span className="fresh-dot" aria-hidden="true" />
          {fresh.label}
        </button>
      </div>
    </header>
  );
}

export function MobileNav({ route, navigate }: NavProps) {
  return (
    <nav className="mobile-nav" aria-label="Mobile primary">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={item.id === "home" ? "/" : "/connection"}
          aria-current={route === item.id ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(item.id);
          }}
        >
          <item.icon size={20} aria-hidden="true" />
          {item.label}
        </a>
      ))}
    </nav>
  );
}
