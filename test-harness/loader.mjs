// Node loader hook: redirect bare imports of @supabase/supabase-js and uuid
// to local test stubs, and add .js to extensionless relative imports so the
// kernel can be imported without a bundler.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve } from "node:path";
import { existsSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const STUBS = {
  "@supabase/supabase-js": pathToFileURL(
    pathResolve(__dirname, "stubs/@supabase/supabase-js/index.js")
  ).href,
  "uuid": pathToFileURL(
    pathResolve(__dirname, "stubs/uuid/index.js")
  ).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: STUBS[specifier], shortCircuit: true, format: "module" };
  }

  // Add .js to extensionless relative imports
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    const parentURL = context.parentURL ? new URL(context.parentURL) : null;
    if (parentURL && parentURL.protocol === "file:") {
      const parentPath = fileURLToPath(parentURL);
      const candidate = pathResolve(dirname(parentPath), specifier);
      const tryPaths = [`${candidate}.js`, `${candidate}.mjs`, `${candidate}/index.js`];
      for (const p of tryPaths) {
        if (existsSync(p) && statSync(p).isFile()) {
          return {
            url: pathToFileURL(p).href,
            shortCircuit: true,
            format: "module",
          };
        }
      }
    }
  }

  return nextResolve(specifier, context);
}

// Force .js files to be loaded as ES modules (project package.json has no type field)
export async function load(url, context, nextLoad) {
  if (url.endsWith(".js") && !context.format) {
    return nextLoad(url, { ...context, format: "module" });
  }
  return nextLoad(url, context);
}
