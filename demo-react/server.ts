import * as esbuild from "npm:esbuild@0.20.2";
// Import the Wasm build on platforms where running subprocesses is not
// permitted, such as Deno Deploy, or when running without `--allow-run`.
// import * as esbuild from "https://deno.land/x/esbuild@0.20.2/wasm.js";

import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.0";

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
    const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"  
 />
    <title>Vite + Deno</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
${code}
    </script>
  </body>
</html>`;
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
);
await server.finished;
esbuild.stop();
