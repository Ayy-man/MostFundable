// Test-only resolver for Node's native TypeScript stripping. This stays .mjs
// because @types/node is pinned to v20 and does not type module.registerHooks;
// .mjs is outside tsconfig.json's include list and therefore escapes typecheck.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(import.meta.dirname, "..", "src");
const extensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  "/index.ts",
  "/index.tsx",
];

function resolveFile(basePath) {
  if (existsSync(basePath) && path.extname(basePath)) return basePath;

  for (const extension of extensions) {
    const candidate = basePath + extension;
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: "data:text/javascript,export%20{}",
        shortCircuit: true,
      };
    }

    if (specifier.startsWith("@/")) {
      const match = resolveFile(path.join(sourceRoot, specifier.slice(2)));
      if (match) {
        return { url: pathToFileURL(match).href, shortCircuit: true };
      }
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const parent = context.parentURL
        ? fileURLToPath(context.parentURL)
        : process.cwd();
      const match = resolveFile(path.resolve(path.dirname(parent), specifier));
      if (match) {
        return { url: pathToFileURL(match).href, shortCircuit: true };
      }
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && error.url) {
        const match = resolveFile(fileURLToPath(error.url));
        if (match) {
          return { url: pathToFileURL(match).href, shortCircuit: true };
        }
      }
      throw error;
    }
  },
});
