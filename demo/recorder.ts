// Records the pages worth watching — the panel, the story pane and the Settings page — with
// the DevTools screencast, one JPEG per changed frame, into dist/demo/<version>/scenes/<id>/
// <stream>/. Not Playwright's recordVideo: that records every page of the context, and the
// world has 500 of them. A frame goes to the stream its url maps to (record.ts); a page with
// no stream is attached but never written. The timeline per stream is written as an ffmpeg
// concat list (durations between frames), which encode.sh turns into video.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

export const STREAMS = ["panel", "story", "settings"] as const;
export type Stream = (typeof STREAMS)[number];

interface Frame {
  at: number; // ms since the scene started
  file: string;
}

interface SceneTake {
  id: string;
  dir: string;
  startedAt: number;
  frames: Map<Stream, Frame[]>;
}

export class Recorder {
  private readonly sessions = new Map<Page, CDPSession>();
  private take: SceneTake | null = null;
  private panel: Page | null = null;
  hidden: string[] = []; // streams whose page reported itself hidden at a scene start (diagnostics)
  private readonly context: BrowserContext;
  private readonly outDir: string;
  private readonly streamOfUrl: (url: string) => Stream | undefined;
  private readonly activeUrls: () => Promise<Set<string>>;

  // activeUrls: the urls of the windows' active tabs (from the worker) — the only pages that
  // paint, and the only ones safe to talk to: a discarded tab's page never answers (the
  // recorded pages are all active tabs of their own windows; the guard stays for safety)
  constructor(
    context: BrowserContext,
    outDir: string,
    streamOfUrl: (url: string) => Stream | undefined,
    activeUrls: () => Promise<Set<string>>,
  ) {
    this.context = context;
    this.outDir = outDir;
    this.streamOfUrl = streamOfUrl;
    this.activeUrls = activeUrls;
  }

  // the panel is one page; every other page is attached as it appears (a woken tab is a new
  // target, so is a Settings page reopened by a scene — they map to a stream only if their url does)
  async start(panel: Page, log: (line: string) => void = () => {}): Promise<void> {
    this.panel = panel;
    for (const page of this.context.pages()) {
      await this.attach(page);
    }
    const counts = new Map<string, number>();
    for (const page of this.sessions.keys()) {
      const stream = this.streamOf(page) ?? "-";
      counts.set(stream, (counts.get(stream) ?? 0) + 1);
    }
    log(
      `recording ${this.sessions.size} of ${this.context.pages().length} pages: ${[...counts].map(([stream, count]) => `${stream}=${count}`).join(" ")}`,
    );
    this.context.on("page", (page) => {
      this.attach(page).catch(() => {});
    });
  }

  private streamOf(page: Page): Stream | undefined {
    return page === this.panel ? "panel" : this.streamOfUrl(page.url());
  }

  private async attach(page: Page): Promise<void> {
    if (this.sessions.has(page) || page.isClosed()) {
      return;
    }
    let session: CDPSession;
    try {
      session = await this.context.newCDPSession(page);
    } catch {
      return; // a discarded tab has no renderer to attach to; it comes back as a new page
    }
    this.sessions.set(page, session);
    page.on("close", () => this.sessions.delete(page));
    session.on("Page.screencastFrame", (event) => {
      session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
      this.keep(page, event.data);
    });
    try {
      await session.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 2 });
    } catch {
      this.sessions.delete(page);
    }
  }

  private keep(page: Page, base64: string): void {
    const take = this.take;
    const stream = this.streamOf(page);
    if (!take || !stream) {
      return;
    }
    const list = take.frames.get(stream) ?? [];
    take.frames.set(stream, list);
    const file = join(stream, `${String(list.length).padStart(5, "0")}.jpg`);
    writeFileSync(join(take.dir, file), Buffer.from(base64, "base64"));
    list.push({ at: Date.now() - take.startedAt, file });
  }

  // a scene starts with a still of every visible recorded page: the screencast only sends
  // frames when something changes, and a window that stays still for a scene must still show
  async startScene(id: string): Promise<void> {
    const dir = join(this.outDir, "scenes", id);
    for (const stream of STREAMS) {
      mkdirSync(join(dir, stream), { recursive: true });
    }
    this.take = { id, dir, startedAt: Date.now(), frames: new Map() };
    await this.baseline();
  }

  private async baseline(): Promise<void> {
    const active = await this.activeUrls();
    const done = new Set<Stream>();
    for (const [page, session] of this.sessions) {
      const stream = this.streamOf(page);
      if (!stream || done.has(stream) || page.isClosed() || (stream !== "panel" && !active.has(page.url()))) {
        continue;
      }
      try {
        const shot = await Promise.race([
          session.send("Page.captureScreenshot", { format: "jpeg", quality: 85 }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
        if (shot) {
          this.keep(page, shot.data);
          done.add(stream);
        } else {
          this.hidden.push(stream);
        }
      } catch {
        // a page mid-navigation: the screencast's next frame covers it
      }
    }
  }

  // closes the take: a concat list per stream (frame, how long it stays), the scene's length
  endScene(): { id: string; durationMs: number; streams: Stream[] } {
    const take = this.take;
    if (!take) {
      throw new Error("endScene without a scene");
    }
    this.take = null;
    const durationMs = Date.now() - take.startedAt;
    const streams: Stream[] = [];
    for (const [stream, frames] of take.frames) {
      if (frames.length === 0) {
        continue;
      }
      streams.push(stream);
      const lines: string[] = [];
      frames.forEach((frame, index) => {
        const next = frames[index + 1];
        const start = index === 0 ? 0 : frame.at; // the first frame stands from the scene's start
        const end = next ? next.at : durationMs;
        lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, (end - start) / 1000).toFixed(3)}`);
      });
      const last = frames[frames.length - 1];
      if (last) {
        lines.push(`file '${last.file}'`); // the concat demuxer needs the last file twice to honour its duration
      }
      writeFileSync(join(take.dir, `${stream}.txt`), `${lines.join("\n")}\n`);
    }
    return { id: take.id, durationMs, streams };
  }
}
