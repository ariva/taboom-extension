// The story pane of the MP4: the scene's title, the caption being shown, and the captions
// already shown (newest first, earlier scenes dimmed). Before every scene it turns into the
// feature checklist for a few seconds (scenes/index.ts checklist): what was shown, what is next. A plain page served by the fake-site
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
.progress{margin-left:auto;font-variant-numeric:tabular-nums}
#list{position:fixed;inset:0;box-sizing:border-box;padding:12px 24px;background:#202124;display:flex;flex-direction:column}
#list[hidden]{display:none}
#beat{position:absolute;right:0;bottom:0;width:1px;height:1px}
#list .cols{flex:1;min-height:0;margin-top:6px;columns:2;column-gap:28px;column-fill:auto}
#list .cols div.own{break-before:column}
#list .cols div+div:not(.own) h2{margin-top:6px}
#list h2{break-after:avoid}
#list h2{margin:0 0 2px;color:#9aa0a6;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;line-height:18px}
#list p{position:relative;margin:0;padding-left:22px;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8eaed}
#list p::before{content:"○";position:absolute;left:2px;color:#5f6368}
#list p.done{color:#80868b}
#list p.done::before{content:"✓";color:#81c995}
#list p.now{color:#fff;font-weight:700}
#list p.now::before{content:"▶";color:#ff6b35;font-size:11px}
</style></head><body>
<header><b>Taboom</b> v${version} · feature tour<span id="progress" class="progress"></span></header>
<h1 id="title"></h1>
<div id="now"></div>
<ol id="done"></ol>
<div id="list" hidden><header><b>Taboom</b> v${version} · the features in this tour<span id="list-progress" class="progress"></span></header><div class="cols"></div><i id="beat"></i></div>
<script>
const title = document.getElementById("title");
const now = document.getElementById("now");
const done = document.getElementById("done");
let current = "";
let sceneTitle = "";
let beatTimer = 0;
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
  // the checklist over the whole pane (null: back to the story); built with textContent only
  checklist(state) {
    const list = document.getElementById("list");
    list.hidden = !state;
    // The recorder gets a frame only when the page changes, and drops one that lands while the
    // previous is still on its way: a card that then stands still for seconds would never show.
    // One pixel in the corner flips twice a second between two shades nobody can tell apart
    // (a timer, not a CSS animation: that would send a frame per refresh)
    clearInterval(beatTimer);
    if (!state) {
      return;
    }
    const beat = document.getElementById("beat");
    beatTimer = setInterval(() => {
      beat.style.background = beat.style.background ? "" : "#212225";
    }, 500);
    document.getElementById("list-progress").textContent = state.done + " of " + state.total + " shown";
    const cols = list.querySelector(".cols");
    cols.textContent = "";
    // a column holds 11 lines under a heading: groups that each fit get a column of their own;
    // a longer one starts under the group before it and runs on into the second column
    const ownColumns = state.groups.every((group) => group.items.length <= 11);
    for (const group of state.groups) {
      const col = document.createElement("div");
      col.className = ownColumns ? "own" : "";
      const heading = document.createElement("h2");
      heading.textContent = group.heading;
      col.append(heading);
      for (const item of group.items) {
        const line = document.createElement("p");
        line.className = item.state;
        line.textContent = item.label;
        col.append(line);
      }
      cols.append(col);
    }
  },
  scene(next, progress) {
    document.getElementById("progress").textContent = progress || "";
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
