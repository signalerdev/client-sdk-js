import * as esbuild from "npm:esbuild@0.20.2";
// Import the Wasm build on platforms where running subprocesses is not
// permitted, such as Deno Deploy, or when running without `--allow-run`.
// import * as esbuild from "https://deno.land/x/esbuild@0.20.2/wasm.js";

import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.0";
import { App, TokenOpts } from "jsr:@signalerdev/server-sdk-js@^0.0.5/deno";

// default values are only used for testing only!!
const app = new App(
  Deno.env.get("APP_ID") || "347da29c4d3b4d2398237ed99dcd7eb8",
  Deno.env.get("APP_SECRET") ||
    "61eb06aa1a3a4ef80dd2a77503e226cc9afb667bed2dde38b31852ac781ea68a",
);

const server = Deno.serve(
  { hostname: "localhost", port: 8080 },
  async (_request) => {
    const result = await esbuild.build({
      plugins: [...denoPlugins()],
      entryPoints: ["./index.tsx"],
      bundle: true,
      minify: true,
      treeShaking: true,
      write: false,
      format: "esm",
    });

    const code = result.outputFiles[0].text;
    const opts = new TokenOpts();
    opts.subject = "alice";
    opts.groupId = "0";
    console.log(app.createToken(opts));

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <link href="https://cdn.jsdelivr.net/npm/beercss@3.7.12/dist/cdn/beer.min.css" rel="stylesheet">
    <script type="module" src="https://cdn.jsdelivr.net/npm/beercss@3.7.12/dist/cdn/beer.min.js"></script>
    <title>Hello world!</title>
  </head>
  <body>
    <main class="responsive max" id="root"></main>
    <script type="module">
${code}
    </script>
  </body>
</html>
`;
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
);
await server.finished;
esbuild.stop();
