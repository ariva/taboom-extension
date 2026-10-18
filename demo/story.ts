// The story pane of the MP4: the scene's title, the caption being shown, and the captions
// already shown (newest first, earlier scenes dimmed). A plain page served by the fake-site
// server as http://story.test/ — the recorder films it like any other page, and stage.ts
// feeds it through window.__story. System font, no requests: the run stays offline.
export function storyHtml(version: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Taboom demo</title>
<style>
:root{color-scheme:dark}
body{margin:0;height:100vh;box-sizing:border-box;padding:18px 24px;overflow:hidden;display:flex;flex-direction:column;background:#202124;color:#e8eaed;font:15px/1.4 system-ui,sans-serif}
header{display:flex;align-items:baseline;gap:10px;color:#9aa0a6;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
header b{color:#fff;font-size:16px;letter-spacing:0;text-transform:none}
h1{margin:6px 0 10px;font-size:22px;font-weight:700;min-height:1.2em}
#now{min-height:2.6em;padding:10px 16px;border-radius:10px;background:#2b2d31;border-left:4px solid #ff6b35;font-size:18px;font-weight:600;transition:opacity .25s}
#now:empty{opacity:0}
ol{list-style:none;margin:12px 0 0;padding:0;overflow:hidden;flex:1}
li{position:relative;padding:3px 0 3px 24px;color:#bdc1c6}
li::before{content:"✓";position:absolute;left:3px;color:#81c995}
li.scene{margin-top:6px;padding-left:0;color:#9aa0a6;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
li.scene::before{content:none}
li.old{opacity:.55}
</style></head><body>
<header><b>Taboom</b> v${version} · feature tour</header>
<h1 id="title"></h1>
<div id="now"></div>
<ol id="done"></ol>
<script>
const title = document.getElementById("title");
const now = document.getElementById("now");
const done = document.getElementById("done");
let current = "";
let sceneTitle = "";
const add = (text, className) => {
  const item = document.createElement("li");
  item.className = className;
  item.textContent = text;
  done.prepend(item);
  while (done.children.length > 14) {
    done.lastElementChild.remove();
  }
};
// the caption on screen moves to the list when the next one arrives (or the scene ends)
const settle = () => {
  if (current) {
    add(current, "");
    current = "";
  }
};
window.__story = {
  scene(next) {
    settle();
    if (sceneTitle) {
      for (const item of done.children) {
        item.classList.add("old");
      }
      add(sceneTitle, "scene old"); // a heading over the previous scene's captions
    }
    sceneTitle = next;
    title.textContent = next;
    now.textContent = "";
  },
  caption(text) {
    settle();
    current = text;
    now.textContent = text;
  },
};
</script></body></html>`;
}
