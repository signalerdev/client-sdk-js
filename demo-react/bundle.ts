import * as esbuild from "npm:esbuild@0.20.2";
// Import the Wasm build on platforms where running subprocesses is not
// permitted, such as Deno Deploy, or when running without `--allow-run`.
// import * as esbuild from "https://deno.land/x/esbuild@0.20.2/wasm.js";

import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.0";

await esbuild.build({
  plugins: [...denoPlugins()],
  entryPoints: ["./index.tsx"],
  outfile: "./dist/index.js",
  bundle: true,
  minify: true,
  treeShaking: true,
  write: true,
  format: "esm",
});

esbuild.stop();
