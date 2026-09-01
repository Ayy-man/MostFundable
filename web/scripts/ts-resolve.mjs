import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");
globalThis.AsyncLocalStorage ??= (await import("node:async_hooks")).AsyncLocalStorage;

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith("@/")) {
      const base = path.join(SRC, spec.slice(2));
      for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (existsSync(c)) return next(pathToFileURL(c).href, ctx);
      }
    }
    if (spec.startsWith("next/") && !spec.endsWith(".js")) {
      try { return next(`${spec}.js`, ctx); } catch { /* fall through */ }
    }
    return next(spec, ctx);
  },
});
