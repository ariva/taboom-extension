// `vite build --watch --mode development` + this plugin = the dev loop. After every
// rebuild, open extension pages learn about it over a long-poll and either reload
// themselves (page-only change) or call chrome.runtime.reload() (worker / manifest /
// shared code changed). Dev builds only: production output gets no client, no tag, no port
// (tests/structure/release-snapshot.test.ts audits the packed zip for it).
//
// Long-poll over plain HTTP instead of WebSocket: zero dependencies, works from any
// extension context, and reconnection is just "ask again".
import { createHash } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { classifyChange, diffBuilds, type ReloadKind } from "./dev-reload-core.ts";

export interface DevReloadOptions {
  port?: number;
  /** output directories that hold pages, e.g. ["sidepanel", "options"] */
  pageDirs: string[];
}

const CLIENT_FILE = "dev-reload-client.js";
const HOLD_MS = 25_000; // answer "none" before proxies / fetch timeouts get nervous

function clientSource(port: number): string {
  return `// DEV ONLY — injected by tooling/dev-reload-plugin.ts, never part of a production build.
let since = "";
async function poll() {
  try {
    const response = await fetch("http://localhost:${port}/poll?since=" + since);
    const { buildId, kind } = await response.json();
    const first = since === "";
    since = buildId;
    if (!first && kind === "extension") {
      chrome.runtime.reload();
      return;
    }
    if (!first && kind === "pages") {
      location.reload();
      return;
    }
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // watcher not running — retry quietly
  }
  poll();
}
poll();
`;
}

export function devReloadPlugin({ port = 5183, pageDirs }: DevReloadOptions): Plugin {
  let enabled = false;
  let buildId = 0;
  let lastKind: ReloadKind = "none";
  let hashes = new Map<string, string>();
  let waiting: ServerResponse[] = [];
  let started = false;

  const answer = (response: ServerResponse, kind: ReloadKind) => {
    response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    response.end(JSON.stringify({ buildId: String(buildId), kind }));
  };

  const startServer = () => {
    if (started) {
      return;
    }
    started = true;
    const server = createServer((request, response) => {
      const since = new URL(request.url ?? "/", "http://localhost").searchParams.get("since") ?? "";
      if (since !== String(buildId)) {
        // first contact, or a build happened while this page was not listening
        answer(response, since === "" ? "none" : lastKind === "none" ? "extension" : lastKind);
        return;
      }
      waiting.push(response);
      setTimeout(() => {
        if (waiting.includes(response)) {
          waiting = waiting.filter((held) => held !== response);
          answer(response, "none");
        }
      }, HOLD_MS);
    });
    // a second extension already in `dev` on this port must not kill the build with an
    // unhandled EADDRINUSE — the watch build keeps working, only self-reload is off
    server.on("error", (error) => {
      console.warn(
        `dev-reload: cannot listen on ${port} (${error.message}) — pass another { port } to devReloadPlugin`,
      );
    });
    server.listen(port, "127.0.0.1");
    server.unref(); // never keeps the build process alive on its own
  };

  return {
    name: "extension:dev-reload",
    apply: "build",
    configResolved(config) {
      enabled = config.mode === "development" && Boolean(config.build.watch);
    },
    generateBundle() {
      if (enabled) {
        this.emitFile({ type: "asset", fileName: CLIENT_FILE, source: clientSource(port) });
      }
    },
    transformIndexHtml: {
      order: "post",
      handler() {
        if (!enabled) {
          return [];
        }
        // pages live one directory deep (sidepanel/index.html) — see vite.config root
        return [{ tag: "script", attrs: { type: "module", src: `../${CLIENT_FILE}` }, injectTo: "head" }];
      },
    },
    writeBundle(_options, bundle) {
      if (!enabled) {
        return;
      }
      startServer();
      const next = new Map<string, string>();
      for (const [fileName, output] of Object.entries(bundle)) {
        const content = output.type === "chunk" ? output.code : output.source;
        next.set(fileName, createHash("sha1").update(content).digest("hex"));
      }
      const kind = hashes.size === 0 ? "none" : classifyChange(diffBuilds(hashes, next), pageDirs);
      hashes = next;
      if (kind === "none") {
        return;
      }
      buildId += 1;
      lastKind = kind;
      for (const response of waiting) {
        answer(response, kind);
      }
      waiting = [];
      this.info(`dev-reload: ${kind === "extension" ? "extension reload" : "page reload"} (build ${buildId})`);
    },
  };
}
