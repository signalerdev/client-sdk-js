import * as path from "jsr:@std/path";
import {
  App,
  AppOpts,
  FirewallClaims,
  PeerClaims,
} from "jsr:@signalerdev/server-sdk-js@^0.0.9/deno";

// default values are only used for testing only!!
const opts = new AppOpts();
opts.appId = Deno.env.get("APP_ID") || "app_e66Jb4zkt66nvlUKMRTSZ";
opts.appSecret = Deno.env.get("APP_SECRET") ||
  "sk_7317736f8a8d075a03cdea6b6b76094ae424cbf619a8e9273e633daed3f55c38";
opts.projectId = "p_kYhfp69c7HPEfE38lg5bz";
const app = new App(opts);

const dirname = path.dirname(path.fromFileUrl(import.meta.url));
const bundlePath = path.join(dirname, "dist", "index.js");

const handleHtml = async (): Promise<Response> => {
  const module = await Deno.readTextFile(bundlePath);

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
${module}
    </script>
  </body>
</html>
`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

const handleAuth = (url: URL): Response => {
  const id = url.searchParams.get("id");

  if (!id) {
    throw new Error("invalid arguments");
  }

  console.log({ id });
  const claims = new PeerClaims();
  claims.peerId = id;

  const rule = new FirewallClaims();
  rule.groupId = "*";
  rule.peerId = "*";
  claims.allowIncoming0 = rule;
  claims.allowOutgoing0 = rule;

  const token = app.createToken(claims, 3600);

  const resp = new Response(token, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });

  return resp;
};

const server = Deno.serve(
  { hostname: "localhost", port: 8080 },
  (req) => {
    const url = new URL(req.url);

    console.log(url.pathname);

    if (url.pathname === "/auth") {
      return handleAuth(url);
    } else {
      return handleHtml();
    }
  },
);
await server.finished;
