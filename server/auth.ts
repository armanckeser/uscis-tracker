// Who may use this tracker, and the secrets a self-hosted install creates for itself.
//
// Auth is OFF unless AUTH_PASSWORD is set, so `docker compose up` on a laptop needs no step. With it set,
// every /api route needs one of:
//   - the session cookie the login sets (the browser),
//   - `Authorization: Bearer <API_TOKEN>` (an AI agent or script),
//   - for POST /api/snapshots/import only: `?key=<IMPORT_KEY>`. The refresh bookmark posts from a my.uscis.gov
//     tab, a cross-site request that carries no cookie, so the bookmark the signed-in app builds embeds this
//     key instead. It can only add snapshots for cases already tracked.
//
// SESSION_SECRET, API_TOKEN, IMPORT_KEY and the Web Push keys are generated on first start into
// instance_secrets unless the environment sets them.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type pg from "pg";
import webpush from "web-push";

const isSet = (name: string) => (process.env[name] ?? "").length > 0;

async function stored(pool: pg.Pool, key: string, generate: () => string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    `INSERT INTO instance_secrets (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key RETURNING value`,
    [key, generate()],
  );
  return rows[0].value;
}

/** Fill process.env with the instance secrets. Call after the schema is applied, before reading them. */
export async function loadInstanceSecrets(pool: pg.Pool): Promise<void> {
  const token = () => randomBytes(32).toString("base64url");
  for (const [env, key] of [["SESSION_SECRET", "session_secret"], ["API_TOKEN", "api_token"], ["IMPORT_KEY", "import_key"]]) {
    if (!isSet(env)) process.env[env] = await stored(pool, key, token);
  }
  if (!isSet("VAPID_PUBLIC_KEY") || !isSet("VAPID_PRIVATE_KEY")) {
    const pair: { publicKey: string; privateKey: string } = JSON.parse(
      await stored(pool, "vapid", () => JSON.stringify(webpush.generateVAPIDKeys())),
    );
    process.env.VAPID_PUBLIC_KEY = pair.publicKey;
    process.env.VAPID_PRIVATE_KEY = pair.privateKey;
  }
}

/** Retry until Postgres answers: a store may start the app before the database. */
export async function waitForDatabase(pool: pg.Pool): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt >= 90) throw error;
      console.log("Waiting for Postgres...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const COOKIE = "session";
const SESSION_DAYS = 180;

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const sign = (payload: string) => createHmac("sha256", process.env.SESSION_SECRET ?? "").update(payload).digest("base64url");

const authEnabled = () => isSet("AUTH_PASSWORD");

const signedIn = (c: Context) => {
  const [expiry, signature] = (getCookie(c, COOKIE) ?? "").split(".");
  return Boolean(expiry && signature && sameText(signature, sign(expiry)) && Number(expiry) > Date.now());
};

const bearer = (c: Context) => {
  const match = /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "");
  return match !== null && isSet("API_TOKEN") && sameText(match[1].trim(), process.env.API_TOKEN!);
};

const importKey = (c: Context) =>
  c.req.method === "POST" && c.req.path === "/api/snapshots/import" && isSet("IMPORT_KEY") && sameText(c.req.query("key") ?? "", process.env.IMPORT_KEY!);

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) return next();
  if (c.req.path === "/api/health" || c.req.path.startsWith("/api/auth/")) return next();
  if (signedIn(c) || bearer(c) || importKey(c)) return next();
  return c.json({ error: "Sign in to use the tracker." }, 401);
};

export function registerAuthRoutes(app: Hono) {
  // The signed-in app reads the import key here to build the refresh bookmark; never shown signed out.
  app.get("/api/auth/session", (c) => {
    const ok = !authEnabled() || signedIn(c);
    return c.json({ enabled: authEnabled(), signed_in: ok, import_key: authEnabled() && ok ? process.env.IMPORT_KEY : null });
  });

  app.get("/api/auth/token", (c) =>
    authEnabled() && !signedIn(c) ? c.json({ error: "Sign in to see the token." }, 401) : c.json({ token: authEnabled() ? process.env.API_TOKEN : null }),
  );

  app.post("/api/auth/login", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const given = typeof body === "object" && body !== null && "password" in body && typeof body.password === "string" ? body.password : "";
    if (!authEnabled() || !sameText(digest(given), digest(process.env.AUTH_PASSWORD!))) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return c.json({ error: "That password is wrong." }, 401);
    }
    const expiry = String(Date.now() + SESSION_DAYS * 86_400_000);
    const https = (c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol).startsWith("https");
    setCookie(c, COOKIE, `${expiry}.${sign(expiry)}`, { httpOnly: true, sameSite: "Lax", secure: https, path: "/", maxAge: SESSION_DAYS * 86_400 });
    return c.json({ signed_in: true });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ signed_in: false });
  });
}
