import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    "service-worker": resolve(root, "src/service-worker.ts"),
    "static-extractor": resolve(root, "src/static-extractor.ts"),
    extractor: resolve(root, "src/extractor.ts"),
    options: resolve(root, "src/options.ts")
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: true,
  minify: false
});

await Promise.all([
  cp(resolve(root, "static/manifest.json"), resolve(dist, "manifest.json")),
  cp(resolve(root, "static/offscreen.html"), resolve(dist, "offscreen.html")),
  cp(resolve(root, "static/options.html"), resolve(dist, "options.html")),
  cp(resolve(root, "static/options.css"), resolve(dist, "options.css")),
  ...[16, 32, 48, 128].map((size) => cp(resolve(root, `static/icon-${size}.png`), resolve(dist, `icon-${size}.png`)))
]);
