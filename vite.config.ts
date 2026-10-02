import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from "vite";
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
 *
 * And it is the build strangers land on, so it gets the pitch: a title and
 * description that say what this is, a canonical URL, and the Open Graph and
 * Twitter tags a link preview is drawn from. Those need absolute URLs and only
 * the deployment knows its own address, so the Pages workflow passes it as
 * SITE_URL; without it the page keeps its plain title and gets no preview tags.
 */
const SHARE_TITLE = "USCIS Tracker: free, private case and priority date tracker";
const SHARE_DESCRIPTION =
  "See what changed on your USCIS cases, including the silent updates, and estimate when the visa bulletin reaches your priority date. Free, and nothing leaves your browser.";

function sharePreview(html: string, siteUrl: string): { html: string; tags: HtmlTagDescriptor[] } {
  const site = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
  const image = `${site}og.jpg`;
  const meta = (key: "property" | "name", id: string, content: string): HtmlTagDescriptor => ({
    tag: "meta",
    attrs: { [key]: id, content },
    injectTo: "head",
  });
  const pitched = html.replace(/<title>[^<]*<\/title>/, `<title>${SHARE_TITLE}</title>`);
  if (!pitched.includes(SHARE_TITLE)) throw new Error("index.html needs a <title> for the share preview to replace");
  return {
    html: pitched,
    tags: [
      meta("name", "description", SHARE_DESCRIPTION),
      { tag: "link", attrs: { rel: "canonical", href: site }, injectTo: "head" },
      meta("property", "og:type", "website"),
      meta("property", "og:site_name", "USCIS Tracker"),
      meta("property", "og:title", SHARE_TITLE),
      meta("property", "og:description", SHARE_DESCRIPTION),
      meta("property", "og:url", site),
      meta("property", "og:image", image),
      meta("property", "og:image:width", "1200"),
      meta("property", "og:image:height", "600"),
      meta("property", "og:image:alt", "USCIS Tracker: a phone showing your place in line, about 4 to 6 months to go, with the visa bulletin cutoff charted against your priority date."),
      meta("name", "twitter:card", "summary_large_image"),
      meta("name", "twitter:title", SHARE_TITLE),
      meta("name", "twitter:description", SHARE_DESCRIPTION),
      meta("name", "twitter:image", image),
    ],
  };
}

function staticSite(bulletinOrigin: string, siteUrl: string | undefined): Plugin {
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
      const secured = withoutInstall.replace(/(<meta charset="UTF-8" \/>\r?\n)/, `$1    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n`);
      return siteUrl ? sharePreview(secured, siteUrl) : secured;
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
    plugins: [react(), ...(local ? [staticSite(bulletinOrigin, process.env.SITE_URL)] : [])],
    server: {
      port: 5173,
      proxy: local ? undefined : { "/api": "http://localhost:4000" },
    },
  };
});
