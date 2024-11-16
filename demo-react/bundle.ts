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
  minify: false,
  treeShaking: false,
  sourcemap: "inline",
  write: true,
  format: "esm",
  target: "chrome109 edge128 firefox115 ios15.6 opera112 safari15.6".split(" "),
});

esbuild.stop();
