// The Firefox recorder (T-0152): BiDi has no screencast, so the recorded pages are polled with
// browsingContext.captureScreenshot — a JPEG every ~120 ms per stream, kept only when it differs
// from the previous one. Same output as the Chromium recorder (demo/recorder.ts): frames and a
// concat list per stream and scene, which encode.sh turns into video.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DemoPage, FrameRecorder, Stream } from "../page-api.ts";
import type { FirefoxPage } from "./page.ts";

const STREAMS: Stream[] = ["panel", "story", "settings"];
const FRAME_EVERY_MS = 120;

interface Frame {
  at: number;
  file: string;
}

interface SceneTake {
  id: string;
  dir: string;
  startedAt: number;
  frames: Map<Stream, Frame[]>;
  last: Map<Stream, string>; // the previous frame's data, to drop unchanged ones
}

export class FirefoxRecorder implements FrameRecorder {
  hidden: string[] = [];
  private take: SceneTake | null = null;
  private panel: FirefoxPage | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private readonly pages: () => FirefoxPage[];
  private readonly outDir: string;
  private readonly streamOfUrl: (url: string) => Stream | undefined;
  private readonly activeUrls: () => Promise<Set<string>>;

  constructor(
    pages: () => FirefoxPage[],
    outDir: string,
    streamOfUrl: (url: string) => Stream | undefined,
    activeUrls: () => Promise<Set<string>>,
  ) {
    this.pages = pages;
    this.outDir = outDir;
    this.streamOfUrl = streamOfUrl;
    this.activeUrls = activeUrls;
  }

  async start(panel: DemoPage, log: (line: string) => void = () => {}): Promise<void> {
    this.panel = panel as FirefoxPage; // `as`: the Firefox browser hands out FirefoxPage only
    log(`recording by screenshot polling, every ${FRAME_EVERY_MS} ms per stream`);
    this.timer = setInterval(() => {
      if (!this.polling) {
        this.polling = true;
        this.poll().finally(() => {
          this.polling = false;
        });
      }
    }, FRAME_EVERY_MS);
  }

  private streamOf(page: FirefoxPage): Stream | undefined {
    return page === this.panel ? "panel" : this.streamOfUrl(page.url());
  }

  // the page of each stream: the panel, and the active-tab page whose url maps to the stream
  private async targets(): Promise<Map<Stream, FirefoxPage>> {
    const active = await this.activeUrls();
    const targets = new Map<Stream, FirefoxPage>();
    for (const page of this.pages()) {
      const stream = this.streamOf(page);
      if (stream && !targets.has(stream) && !page.isClosed() && (stream === "panel" || active.has(page.url()))) {
        targets.set(stream, page);
      }
    }
    return targets;
  }

  private async poll(): Promise<void> {
    const take = this.take;
    if (!take) {
      return;
    }
    for (const [stream, page] of await this.targets()) {
      const data = await page.frame();
      if (data !== undefined && this.take === take) {
        this.keep(take, stream, data);
      }
    }
  }

  private keep(take: SceneTake, stream: Stream, data: string): void {
    if (take.last.get(stream) === data) {
      return; // nothing changed on that page
    }
    take.last.set(stream, data);
    const list = take.frames.get(stream) ?? [];
    take.frames.set(stream, list);
    const file = join(stream, `${String(list.length).padStart(5, "0")}.jpg`);
    writeFileSync(join(take.dir, file), Buffer.from(data, "base64"));
    list.push({ at: Date.now() - take.startedAt, file });
  }

  async startScene(id: string): Promise<void> {
    const dir = join(this.outDir, "scenes", id);
    for (const stream of STREAMS) {
      mkdirSync(join(dir, stream), { recursive: true });
    }
    this.take = { id, dir, startedAt: Date.now(), frames: new Map(), last: new Map() };
    // the first frame of every stream at once: a page that stays still for a scene must still show
    for (const [stream, page] of await this.targets()) {
      const data = await page.frame();
      if (data === undefined) {
        this.hidden.push(stream);
      } else {
        this.keep(this.take, stream, data);
      }
    }
  }

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
        const start = index === 0 ? 0 : frame.at;
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

  stop(): void {
    clearInterval(this.timer);
  }
}
