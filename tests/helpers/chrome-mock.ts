// Browser-safe chrome.* stub — no node imports, so the same mock serves the happy-dom
// tier (tests/helpers/ui.ts) and the real-Chromium tier (tests/browser/).
// No runtime imports (type-only imports are erased): .private/testing/browser.mjs strips the
// types and injects this source as a classic script. There are no imports at all today — the
// stored shapes are type parameters, so the mock knows nothing about the extension it serves.
// Parameter types come from @types/chrome, so a mock that drifts from the real API stops
// compiling. Return values stay inferred — tests need only a slice of the real shapes.

// functions stay whole, so a fixture like { onDisconnect: { addListener: (fn) => … } } still types
type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;
/** a slice of an event payload: every argument optional and deep-partial */
export type Slice<Args extends unknown[]> = { [K in keyof Args]?: DeepPartial<Args[K]> };

/**
 * capturing event: tests can fire() to invoke everything the code registered.
 * Deliberately asymmetric: the code under test registers REAL listeners, so addListener keeps
 * the full chrome argument types (API drift = compile error), while tests fire only the slice
 * of the payload the listener reads ({} as activation info, an alarm with just a name,
 * onInstalled with nothing), so fire() takes every argument optional and deep-partial.
 */
export interface MockEvent<Args extends unknown[] = unknown[]> {
  addListener: (fn: (...args: Args) => unknown) => void;
  removeListener: (fn: (...args: Args) => unknown) => void;
  fire: (...args: Slice<Args>) => Promise<unknown[]>;
}

type RealEvent = { addListener: (callback: never) => unknown };
/** what a real chrome event hands its listeners, e.g. ListenerArgs<typeof chrome.tabs.onUpdated> */
type ListenerArgs<E extends RealEvent> = Parameters<Parameters<E["addListener"]>[0]>;

export interface ChromeMockOptions {
  tabs?: Partial<chrome.tabs.Tab>[];
  groups?: Partial<chrome.tabGroups.TabGroup>[];
  /** chrome.storage.local content — mutated in place by storage.local.set/remove */
  stored?: Record<string, unknown>;
  /** flat log of stubbed chrome calls, e.g. ["tabs.reload 3", "storage.set {...}"] */
  calls?: string[];
  experimental?: boolean;
}

export type ChromeMock<
  Local extends object = Record<string, unknown>,
  Session extends object = Record<string, unknown>,
> = ReturnType<typeof makeChrome<Local, Session>>;

// E = the real event being stubbed: makeEvent<typeof chrome.tabs.onUpdated>()
function makeEvent<E extends RealEvent>(): MockEvent<ListenerArgs<E>> {
  const fns: ((...args: ListenerArgs<E>) => unknown)[] = [];
  return {
    addListener: (fn) => fns.push(fn),
    removeListener: () => {},
    // `as`: the one place a fired slice meets the real listeners — see MockEvent
    fire: (...args) => Promise.all(fns.map((fn) => fn(...(args as ListenerArgs<E>)))),
  };
}

// chrome takes one id or a list in many places
function list<T>(value: T | T[]): T[] {
  return ([] as T[]).concat(value);
}

// experimental: inject ui.showExperimental so the code under test resolves flags the way
// the experimental test pass expects
// Local / Session: what storage.local.get() / storage.session.get() answer with, so tests read known
// keys back typed — the same promise the real chrome.storage.*.get<T>() makes. Bound by the harness
// (tests/helpers/ui.ts); the mock itself stays schema-agnostic. Fixtures (`stored`) stay loose on
// purpose: tests seed partial and legacy shapes.
export function makeChrome<
  Local extends object = Record<string, unknown>,
  Session extends object = Record<string, unknown>,
>({ tabs = [], stored = {}, calls = [], groups = [], experimental = false }: ChromeMockOptions) {
  if (experimental) {
    const ui = stored.ui;
    stored.ui = { ...(typeof ui === "object" ? ui : {}), showExperimental: true };
  }
  let nextTabId = 1000;
  return {
    tabs: {
      query: async (opts: chrome.tabs.QueryInfo = {}) => {
        let result = tabs;
        if (opts.windowId != null) {
          result = result.filter((t) => t.windowId === opts.windowId);
        }
        if (opts.active) {
          result = result.filter((t) => t.active);
        }
        return result;
      },
      get: async (id: number) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) {
          throw new Error(`no tab ${id}`);
        }
        return tab;
      },
      update: async (id: number, props?: chrome.tabs.UpdateProperties) => {
        calls.push(`tabs.update ${id} ${JSON.stringify(props ?? {})}`);
        const tab = tabs.find((t) => t.id === id);
        if (tab) {
          Object.assign(tab, props);
        }
        return tab;
      },
      remove: async (ids: number | number[]) => calls.push(`tabs.remove ${list(ids)}`),
      reload: async (id: number) => calls.push(`tabs.reload ${id}`),
      move: async (ids: number | number[], props?: chrome.tabs.MoveProperties) => {
        calls.push(`tabs.move ${list(ids)} ${JSON.stringify(props ?? {})}`);
        for (const id of list(ids)) {
          const tab = tabs.find((t) => t.id === id);
          if (tab && props?.windowId != null) {
            if (tab.windowId !== props.windowId) {
              tab.pinned = false; // like Chrome: a cross-window move unpins
            }
            tab.windowId = props.windowId;
          }
        }
      },
      create: async (opts: chrome.tabs.CreateProperties = {}) => {
        calls.push(`tabs.create ${JSON.stringify(opts)}`);
        const tab = { id: nextTabId++, active: !!opts.active, windowId: opts.windowId, url: "chrome://newtab/" };
        tabs.push(tab);
        return tab;
      },
      discard: async (id: number) => {
        calls.push(`tabs.discard ${id}`);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) {
          throw new Error(`no tab ${id}`);
        }
        tab.discarded = true;
        tab.active = false;
        return { ...tab };
      },
      onCreated: makeEvent<typeof chrome.tabs.onCreated>(),
      onUpdated: makeEvent<typeof chrome.tabs.onUpdated>(),
      onActivated: makeEvent<typeof chrome.tabs.onActivated>(),
      onRemoved: makeEvent<typeof chrome.tabs.onRemoved>(),
      onMoved: makeEvent<typeof chrome.tabs.onMoved>(),
      onAttached: makeEvent<typeof chrome.tabs.onAttached>(),
      onDetached: makeEvent<typeof chrome.tabs.onDetached>(),
      onReplaced: makeEvent<typeof chrome.tabs.onReplaced>(),
      group: async ({ tabIds, groupId }: chrome.tabs.GroupOptions) => {
        calls.push(`tabs.group ${list<number>(tabIds ?? [])} ${groupId ?? "new"}`);
        const gid = groupId ?? 900;
        for (const id of list<number>(tabIds ?? [])) {
          const tab = tabs.find((t) => t.id === id);
          if (tab) {
            tab.groupId = gid;
          }
        }
        return gid;
      },
      ungroup: async (tabIds: number | [number, ...number[]]) => {
        calls.push(`tabs.ungroup ${list<number>(tabIds)}`);
        for (const id of list<number>(tabIds)) {
          const tab = tabs.find((t) => t.id === id);
          if (tab) {
            tab.groupId = -1;
          }
        }
      },
    },
    tabGroups: {
      query: async () => groups.map((g) => ({ ...g })),
      update: async (groupId: number, props: chrome.tabGroups.UpdateProperties) => {
        calls.push(`tabGroups.update ${groupId} ${JSON.stringify(props)}`);
        const group = groups.find((g) => g.id === groupId);
        if (group) {
          Object.assign(group, props);
        }
        return group;
      },
      onCreated: makeEvent<typeof chrome.tabGroups.onCreated>(),
      onRemoved: makeEvent<typeof chrome.tabGroups.onRemoved>(),
      onUpdated: makeEvent<typeof chrome.tabGroups.onUpdated>(),
      onMoved: makeEvent<typeof chrome.tabGroups.onMoved>(),
    },
    windows: {
      WINDOW_ID_NONE: -1,
      getLastFocused: async () => ({ id: 1 }),
      getCurrent: async () => ({ id: 1 }),
      getAll: async () =>
        [...new Set(tabs.map((t) => t.windowId))].map((id) => ({
          id,
          left: 0,
          top: 0,
          width: 1280,
          height: 800,
        })),
      onCreated: makeEvent<typeof chrome.windows.onCreated>(),
      onRemoved: makeEvent<typeof chrome.windows.onRemoved>(),
      update: async (id: number) => calls.push(`windows.update ${id}`),
      create: async (opts: chrome.windows.CreateData = {}) => {
        calls.push(`windows.create ${JSON.stringify(opts)}`);
        const win = { id: 900 };
        if (opts.tabId != null) {
          const tab = tabs.find((t) => t.id === opts.tabId);
          if (tab) {
            tab.pinned = false; // like Chrome: a cross-window move unpins
            tab.windowId = win.id;
          }
        }
        return win;
      },
      onFocusChanged: makeEvent<typeof chrome.windows.onFocusChanged>(),
    },
    alarms: {
      create: async (name: string, info: chrome.alarms.AlarmCreateInfo) =>
        calls.push(`alarms.create ${name} ${JSON.stringify(info)}`),
      onAlarm: makeEvent<typeof chrome.alarms.onAlarm>(),
    },
    commands: { onCommand: makeEvent<typeof chrome.commands.onCommand>() },
    contextMenus: {
      removeAll: async () => calls.push("contextMenus.removeAll"),
      create: (props: chrome.contextMenus.CreateProperties) => calls.push(`contextMenus.create ${props.id}`),
      update: (id: string | number, props: Omit<chrome.contextMenus.CreateProperties, "id">, done?: () => void) => {
        calls.push(`contextMenus.update ${id} ${JSON.stringify(props)}`);
        done?.();
      },
      remove: (id: string | number, done?: () => void) => {
        calls.push(`contextMenus.remove ${id}`);
        done?.();
      },
      onClicked: makeEvent<typeof chrome.contextMenus.onClicked>(),
    },
    storage: {
      local: {
        // keys is accepted like the real API and ignored: the mock always returns everything
        // `as`: storage is untyped at runtime; Local is the caller's claim, as with chrome's get<T>()
        get: async (_keys?: string | string[] | null) => structuredClone(stored) as Local,
        set: async (patch: Record<string, unknown>) => {
          calls.push(`storage.set ${JSON.stringify(patch)}`);
          Object.assign(stored, structuredClone(patch));
        },
        clear: async () => calls.push("storage.clear"),
        remove: async (key: string | string[]) => {
          calls.push(`storage.remove ${key}`);
          for (const k of list(key)) {
            delete stored[k];
          }
        },
      },
      onChanged: makeEvent<typeof chrome.storage.onChanged>(),
      session: (() => {
        const sessionStored: Record<string, unknown> = {};
        return {
          // keys ignored and `as`, both as in storage.local.get
          get: async (_keys?: string | string[] | null) => structuredClone(sessionStored) as Session,
          set: async (patch: Record<string, unknown>) => {
            calls.push(`storage.session.set ${JSON.stringify(patch)}`);
            Object.assign(sessionStored, structuredClone(patch));
          },
        };
      })(),
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test${path}`,
      sendMessage: async (msg: { type: string }) => {
        calls.push(`sendMessage ${msg.type}`);
        return {};
      },
      connect: (info?: chrome.runtime.ConnectInfo) => {
        calls.push(`runtime.connect ${info?.name ?? ""}`);
        return {
          name: info?.name,
          onDisconnect: makeEvent<chrome.runtime.Port["onDisconnect"]>(),
          disconnect: () => {},
        };
      },
      onConnect: makeEvent<typeof chrome.runtime.onConnect>(),
      openOptionsPage: () => calls.push("openOptionsPage"),
      // update_url = store install; tests exercise the shipped (non-DEV) behaviour
      getManifest: () => ({ version: "0.0.0-test", update_url: "https://clients2.google.com/service/update2/crx" }),
      onMessage: makeEvent<typeof chrome.runtime.onMessage>(),
      onInstalled: makeEvent<typeof chrome.runtime.onInstalled>(),
      onStartup: makeEvent<typeof chrome.runtime.onStartup>(),
      onUpdateAvailable: makeEvent<typeof chrome.runtime.onUpdateAvailable>(),
      reload: () => calls.push("runtime.reload"),
    },
    action: {
      setBadgeText: async (opts: chrome.action.BadgeTextDetails) =>
        calls.push(`action.setBadgeText ${JSON.stringify(opts)}`),
      setBadgeBackgroundColor: async () => {},
      setIcon: async () => {},
    },
    sidePanel: {
      open: async (opts?: chrome.sidePanel.OpenOptions) => calls.push(`sidePanel.open ${JSON.stringify(opts ?? {})}`),
      setPanelBehavior: async (opts: chrome.sidePanel.PanelBehavior) =>
        calls.push(`sidePanel.setPanelBehavior ${JSON.stringify(opts)}`),
    },
  };
}
