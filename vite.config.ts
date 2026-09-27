// One build for dev and prod: `vite build` writes a loadable extension into dist/<mode>.
// No dev server — what Chrome loads while developing is what ships (see `just dev`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { manifest } from "./src/manifest.ts";
import { devReloadPlugin } from "./tooling/dev-reload-plugin.ts";
import { manifestPlugin } from "./tooling/manifest-plugin.ts";
import { staticFilesPlugin } from "./tooling/static-files-plugin.ts";

const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  return {
    // pages are the root so they land at sidepanel/index.html + options/index.html —
    // the paths the manifest (and users' open tabs) already use
    root: resolve(root, "src/pages"),
    base: "./", // chrome-extension:// origin — every URL relative
    publicDir: resolve(root, "public"),
    build: {
      outDir: resolve(root, isDev ? "dist/dev" : "dist/prod"),
      emptyOutDir: true,
      target: "chrome121", // = manifest minimum_chrome_version
      minify: process.env.MINIFY === "1", // D6: readable by default, `just build minify=true` opts in
      sourcemap: isDev,
      modulePreload: false, // no injected inline polyfill — MV3 CSP forbids inline script
      assetsInlineLimit: 0, // assets stay files a store reviewer can open
      rollupOptions: {
        input: {
          "sidepanel/index": resolve(root, "src/pages/sidepanel/index.html"),
          "options/index": resolve(root, "src/pages/options/index.html"),
          "background/service-worker": resolve(root, "src/background/service-worker.ts"),
        },
        output: {
          // stable, readable names: the manifest points at the worker by path, and an
          // unhashed file list keeps tests/structure/release-snapshot meaningful
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name].js",
          // page CSS is named after its page (sidepanel/index.html → assets/sidepanel.css);
          // CSS shared between pages gets the shared chunk's arbitrary name → "common"
          assetFileNames: (info) => {
            const isCss = info.names.some((name) => name.endsWith(".css"));
            const page = info.originalFileNames.find((file) => file.endsWith(".html"));
            if (isCss) {
              return page ? `assets/${page.split("/")[0]}.css` : "assets/common[extname]";
            }
            return "assets/[name][extname]";
          },
        },
      },
    },
    plugins: [
      manifestPlugin(() => manifest(version)),
      staticFilesPlugin([
        { from: resolve(root, "features.json"), to: "features.json" },
        { from: resolve(root, "CHANGES.md"), to: "CHANGES.md" },
        { from: resolve(root, "dev-assets/icons/dev"), to: "icons/dev", devOnly: true },
      ]),
      devReloadPlugin({ pageDirs: ["sidepanel", "options"] }),
    ],
  };
});
