import type { Scene } from "./index.ts";

// the closing frame: nothing moves for ten seconds so the film does not cut off on the
// last click, and the story pane says the tour is over
export const outro: Scene = {
  id: "finished",
  title: "That's the tour",
  settings: "#page-title", // where the settings scene left the pane — same screen, no scroll
  async run(stage) {
    await stage.caption("Demo finished — thanks for watching", 10000);
  },
};
