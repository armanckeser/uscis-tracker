import { useEffect, useState } from "react";
import { BASE_PATH } from "../lib/mode";

export type RouteId = "home" | "connection";

// Relative to wherever the app is served: "/" self-hosted, "/uscis-tracker/" on GitHub Pages.
const ROUTE_PATHS: Record<RouteId, string> = {
  home: "",
  connection: "connection",
};

export function routeHref(route: RouteId, base = BASE_PATH): string {
  return base + ROUTE_PATHS[route];
}

export function routeFromPath(pathname: string, base = BASE_PATH): RouteId {
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const normalized = relative.replace(/^\/+|\/+$/g, "");
  const match = (Object.entries(ROUTE_PATHS) as Array<[RouteId, string]>).find(([, path]) => path === normalized);
  return match?.[0] ?? "home";
}

/** Minimal history-based router: no dependency, syncs with back/forward. */
export function useRoute() {
  const [route, setRoute] = useState<RouteId>(() => routeFromPath(window.location.pathname));

  useEffect(() => {
    const sync = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  function navigate(target: RouteId) {
    const path = routeHref(target);
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    setRoute(target);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  return { route, navigate };
}
