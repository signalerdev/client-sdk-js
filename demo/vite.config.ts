import { defineConfig } from "vite";
import deno from "@deno/vite-plugin";
import react from "@vitejs/plugin-react";
import { dirname, fromFileUrl, join } from "jsr:@std/path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [deno(), react()],
  resolve: {
    // TODO: this is a hack for the vite plugin with deno workspace
    // https://github.com/denoland/deno-vite-plugin/issues/19
    alias: {
      "@signalerdev/client": join(
        dirname(fromFileUrl(import.meta.url)),
        "../client/mod.ts",
      ),
    },
  },
});
