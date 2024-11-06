import { build, emptyDir } from "jsr:@deno/dnt@0.41.3";
import meta from "./deno.json" with { type: "json" };

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./npm",
  shims: {
    // see JS docs for overview and more options
    deno: true,
  },
  package: {
    // package.json properties
    name: meta.name,
    version: meta.version,
  },
  compilerOptions: {
    lib: [
      "ES2020",
      "DOM",
      "DOM.Iterable",
    ],
  },
  postBuild() {
    // steps to run after building and before running the tests
    Deno.copyFileSync("../LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
