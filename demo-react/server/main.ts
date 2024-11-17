import * as path from "jsr:@std/path";
import { serveDir } from "jsr:@std/http/file-server";
import {
  App,
  AppOpts,
  FirewallClaims,
  PeerClaims,
} from "jsr:@signalerdev/server-sdk-js@^0.0.10/deno";

// default values are only used for testing only!!
const opts = new AppOpts();
opts.appId = Deno.env.get("APP_ID") || "app_e66Jb4zkt66nvlUKMRTSZ";
opts.appSecret = Deno.env.get("APP_SECRET") ||
  "sk_7317736f8a8d075a03cdea6b6b76094ae424cbf619a8e9273e633daed3f55c38";
const app = new App(opts);

const handleAuth = (url: URL): Response => {
  const id = url.searchParams.get("id");

  if (!id) {
    throw new Error("invalid arguments");
  }

  console.log({ id });
  const claims = new PeerClaims();
  claims.groupId = "default";
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
    }

    return serveDir(req, {
      fsRoot: "dist",
    });
  },
);
await server.finished;
