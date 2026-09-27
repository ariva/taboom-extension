// Typed accessors over one chrome.storage area. Schema lists every key the
// extension keeps there; keys, patches and results are checked against it.

// chrome.storage[area] is looked up per call, not captured: tests swap the chrome global
export function createStorage<Schema extends object>(area: "local" | "session") {
  return {
    // values are optional on read — the area may hold none of the keys yet
    get<K extends keyof Schema & string>(keys: K | K[]): Promise<Partial<Pick<Schema, K>>> {
      return chrome.storage[area].get<Partial<Pick<Schema, K>>>(keys);
    },
    set(patch: Partial<Schema>): Promise<void> {
      return chrome.storage[area].set(patch);
    },
    remove<K extends keyof Schema & string>(keys: K | K[]): Promise<void> {
      return chrome.storage[area].remove(keys);
    },
  };
}
