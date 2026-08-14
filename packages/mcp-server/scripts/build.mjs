import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: {
    index: "src/index.ts",
    broker: "src/broker.ts"
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  banner: { js: "#!/usr/bin/env node" }
});
