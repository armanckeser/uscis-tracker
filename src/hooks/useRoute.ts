import { useEffect, useState } from "react";

export type RouteId = "home" | "connection";

const ROUTE_PATHS: Record<RouteId, string> = {
  home: "/",
  connection: "/connection",
};

export function routeFromPath(pathname: string): RouteId {
  const normalized = pathname.replace(/\/+$/, "") || "/";
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
    const path = ROUTE_PATHS[target];
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    setRoute(target);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  return { route, navigate };
}
