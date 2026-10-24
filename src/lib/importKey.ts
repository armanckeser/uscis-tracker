// The key the refresh bookmark adds to its import URL when the tracker has a password (server/auth.ts).
// The bookmark posts from a my.uscis.gov tab, which carries no tracker cookie, so this key is how the server
// knows the snapshot came from a bookmark this tracker built. Set by AuthGate once signed in.
let key: string | null = null;

export const setImportKey = (value: string | null) => {
  key = value;
};

export const importPath = (path: string) => (key ? `${path}?key=${encodeURIComponent(key)}` : path);
