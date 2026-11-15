// The wire into the Firefox the demo drives (T-0152): WebDriver BiDi over a WebSocket — pages,
// input, screenshots, the extension install. No dependency: Node 24 has WebSocket.

type Json = Record<string, unknown>;

export class BidiError extends Error {}

export class BidiClient {
  private readonly socket: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Map<string, ((params: Json) => void)[]>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as Json);
  }

  static connect(url: string): Promise<BidiClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.onopen = () => resolve(new BidiClient(socket));
      socket.onerror = () => reject(new BidiError(`cannot connect to ${url}`));
    });
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, listener: (params: Json) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  close(): void {
    this.socket.close();
  }

  private receive(message: Json): void {
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.type === "error") {
        waiter?.reject(new BidiError(`${message.error}: ${message.message}`));
      } else {
        waiter?.resolve(message.result as Json);
      }
      return;
    }
    if (message.type === "event") {
      for (const listener of this.listeners.get(String(message.method)) ?? []) {
        listener(message.params as Json);
      }
    }
  }
}

// ---------- BiDi value serialization (script.callFunction arguments and results) ----------

export interface RemoteValue {
  type: string;
  value?: unknown;
}

// plain data → LocalValue: what evaluate() hands a page function (the demo passes arrays,
// objects, strings and numbers; a Map or a Set never crosses — it would not survive Playwright either)
export function toLocalValue(value: unknown): RemoteValue {
  if (value === undefined) {
    return { type: "undefined" };
  }
  if (value === null) {
    return { type: "null" };
  }
  switch (typeof value) {
    case "string":
      return { type: "string", value };
    case "boolean":
      return { type: "boolean", value };
    case "number":
      if (Number.isNaN(value)) {
        return { type: "number", value: "NaN" };
      }
      if (value === Number.POSITIVE_INFINITY || value === Number.NEGATIVE_INFINITY) {
        return { type: "number", value: value > 0 ? "Infinity" : "-Infinity" };
      }
      return { type: "number", value: Object.is(value, -0) ? "-0" : value };
    default:
      break;
  }
  if (Array.isArray(value)) {
    return { type: "array", value: value.map(toLocalValue) };
  }
  if (typeof value === "object") {
    return { type: "object", value: Object.entries(value).map(([key, entry]) => [key, toLocalValue(entry)]) };
  }
  throw new BidiError(`cannot serialize a ${typeof value} for the page`);
}

// RemoteValue → plain data
export function fromRemoteValue(remote: RemoteValue): unknown {
  switch (remote.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "string":
    case "boolean":
      return remote.value;
    case "number": {
      const special: Record<string, number> = {
        NaN: Number.NaN,
        "-0": -0,
        Infinity: Number.POSITIVE_INFINITY,
        "-Infinity": Number.NEGATIVE_INFINITY,
      };
      return typeof remote.value === "string" ? special[remote.value] : remote.value;
    }
    case "array":
      return ((remote.value as RemoteValue[] | undefined) ?? []).map(fromRemoteValue);
    case "object":
      return Object.fromEntries(
        ((remote.value as [string, RemoteValue][] | undefined) ?? []).map(([key, entry]) => [
          key,
          fromRemoteValue(entry),
        ]),
      );
    case "map":
      return Object.fromEntries(
        ((remote.value as [RemoteValue | string, RemoteValue][] | undefined) ?? []).map(([key, entry]) => [
          typeof key === "string" ? key : String(fromRemoteValue(key)),
          fromRemoteValue(entry),
        ]),
      );
    default:
      return undefined; // a node, a function, a promise: nothing the demo reads back
  }
}
