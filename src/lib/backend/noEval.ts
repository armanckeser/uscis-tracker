// zod probes for `new Function` to compile its parsers, at the moment a schema
// is built. The static site's Content-Security-Policy forbids eval, so the probe
// is refused and logged as a violation on every load. This has to run before any
// schema exists, which is why it is its own module, imported first.
import { z } from "zod";

z.config({ jitless: true });
