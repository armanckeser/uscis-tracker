import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { setImportKey } from "../lib/importKey";

type Session = { enabled: boolean; signed_in: boolean; import_key: string | null };

/**
 * Shows the tracker only to someone signed in, when the server has a password (AUTH_PASSWORD). Without one,
 * the default, it renders the tracker straight away. The server enforces this on every /api route; this
 * only decides what to show.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const load = () =>
    fetch("/api/auth/session")
      .then((response) => response.json() as Promise<Session>)
      .then((next) => {
        setImportKey(next.import_key);
        setSession(next);
      })
      .catch(() => setSession({ enabled: false, signed_in: true, import_key: null }));

  useEffect(() => {
    void load();
    const signedOut = () => setSession((current) => (current ? { ...current, signed_in: false } : current));
    window.addEventListener("auth:signed-out", signedOut);
    return () => window.removeEventListener("auth:signed-out", signedOut);
  }, []);

  if (session === null) return null;
  if (session.signed_in) return <>{children}</>;
  return <SignIn onSignedIn={() => void load()} />;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) return onSignedIn();
    const said = (await response?.json().catch(() => null)) as { error?: string } | null;
    setError(said?.error ?? "Can't reach the tracker. Try again.");
  }

  return (
    <main className="sign-in">
      <form className="sign-in-form" onSubmit={submit}>
        <h1>USCIS Tracker</h1>
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
        />
        <button className="button button-primary" type="submit" disabled={busy || password === ""}>
          {busy ? <Loader2 className="spin" size={15} /> : null}
          Sign in
        </button>
        {error ? <p className="sign-in-error">{error}</p> : null}
      </form>
    </main>
  );
}
