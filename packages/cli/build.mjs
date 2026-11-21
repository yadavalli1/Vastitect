// Bundles the CLI into one file that runs on plain Node 20+ (no TypeScript loader needed).
import { build } from "esbuild";
await build({
  entryPoints: [new URL("./src/main.ts", import.meta.url).pathname],
  outfile: new URL("./dist/vastitecture.mjs", import.meta.url).pathname,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  loader: { ".json": "json" },
  logLevel: "warning",
});
