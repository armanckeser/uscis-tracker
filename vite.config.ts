import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_BULLETIN_BASE_URL = "https://raw.githubusercontent.com/armanckeser/visa-bulletin-data/main/data";

/**
 * Shapes index.html for the browser-only build (`--mode static`).
 *
 * The install hooks go: an installed Home Screen copy on iOS has storage of its
 * own, apart from the Safari tab the refresh bookmark lands in, so "installing"
 * this build would hand people an app that never sees their refreshes.
 *
 * A Content-Security-Policy goes in: the page says nothing is uploaded, and this
 * makes the browser enforce it. Scripts can only reach this site and the public
 * bulletin dataset. Build only, because the dev server needs inline scripts and
 * a websocket.
 */
function staticSite(bulletinOrigin: string): Plugin {
  let outDir = "dist";
  let building = false;
  return {
    name: "uscis-tracker-static-site",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      building = config.command === "build";
    },
    transformIndexHtml(html) {
      const withoutInstall = html
        .replace(/[ \t]*<link rel="manifest"[^>]*>\r?\n/, "")
        .replace(/[ \t]*<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable)"[^>]*>\r?\n/g, "");
      if (!building) return withoutInstall;
      const policy = [
        "default-src 'self'",
        `connect-src 'self' ${bulletinOrigin}`,
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "base-uri 'self'",
        "form-action 'none'",
      ].join("; ");
      return withoutInstall.replace(/(<meta charset="UTF-8" \/>\r?\n)/, `$1    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n`);
    },
    // GitHub Pages serves 404.html for any path it has no file for, which is how
    // /connection loads the app when opened directly.
    closeBundle() {
      if (!building) return;
      const index = path.join(outDir, "index.html");
      if (fs.existsSync(index)) fs.copyFileSync(index, path.join(outDir, "404.html"));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const local = env.VITE_BACKEND === "local";
  const bulletinOrigin = new URL(env.VITE_BULLETIN_BASE_URL || DEFAULT_BULLETIN_BASE_URL).origin;

  return {
    plugins: [react(), ...(local ? [staticSite(bulletinOrigin)] : [])],
    server: {
      port: 5173,
      proxy: local ? undefined : { "/api": "http://localhost:4000" },
    },
  };
});
