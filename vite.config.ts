// One build for dev and prod: `vite build` writes a loadable extension into dist/<mode>.
// No dev server — what Chrome loads while developing is what ships (see `just dev`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { type BuildTarget, manifest } from "./src/manifest.ts";
import { devReloadPlugin } from "./tooling/dev-reload-plugin.ts";
import { manifestPlugin } from "./tooling/manifest-plugin.ts";
import { staticFilesPlugin } from "./tooling/static-files-plugin.ts";

const root = import.meta.dirname;
const packageJson = resolve(root, "package.json");
// read per build, not once: `just dev` must pick up a version bump without a restart
const packageVersion = (): string => JSON.parse(readFileSync(packageJson, "utf8")).version;

// TARGET picks the browser flavour: its manifest (src/manifest.ts), its output folder (dist/chrome,
// dist/firefox; dist/dev-chrome, dist/dev-firefox for `just dev`), esbuild target and the build-time
// constants. Same entries, same chunks — the platform seam's other-browser branch folds away (T-0152)
const target: BuildTarget = process.env.TARGET === "firefox" ? "firefox" : "chrome";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const outDir = isDev ? `dev-${target}` : target;
  return {
    // the build's browser as constants: a branch for the other browser folds away (src/lib/platform/build-target.d.ts)
    define: { __CHROME__: JSON.stringify(target === "chrome"), __FIREFOX__: JSON.stringify(target === "firefox") },
    // pages are the root so they land at sidepanel/index.html + options/index.html —
    // the paths the manifest (and users' open tabs) already use
    root: resolve(root, "src/pages"),
    base: "./", // chrome-extension:// origin — every URL relative
    publicDir: false, // icons/ go through staticFilesPlugin: prod always, dev only in development
    build: {
      outDir: resolve(root, "dist", outDir),
      emptyOutDir: true,
      // = the manifest's minimum: minimum_chrome_version / gecko.strict_min_version
      target: target === "firefox" ? "firefox140" : "chrome121",
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
      manifestPlugin(() => manifest(packageVersion(), target), [packageJson]),
      staticFilesPlugin([
        { from: resolve(root, "features.json"), to: "features.json" },
        { from: resolve(root, "CHANGES.md"), to: "CHANGES.md" },
        { from: resolve(root, "icons/prod"), to: "icons" },
        // the blue icons mark a dev-loaded extension; never in a production build (release snapshot audits it)
        { from: resolve(root, "icons/dev"), to: "icons/dev", devOnly: true },
      ]),
      // its own port per target, so `just dev` and `just dev-firefox` run side by side
      devReloadPlugin({ pageDirs: ["sidepanel", "options"], port: target === "firefox" ? 5184 : 5183 }),
    ],
  };
});
