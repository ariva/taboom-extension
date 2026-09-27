// Typed chrome.runtime messaging. One factory call per extension binds the
// message union and its response map; send() is then checked per message type.

// a handler that threw (or an unknown message type): String(error)
export interface MessageError {
  error: string;
}

// M: union of { type: "…", …payload }. R: message type → what its handler answers with.
// send() resolves with undefined when no listener answered. No retries and no
// catching here — a sleeping worker rejects, and callers decide whether that matters.
export function createMessenger<M extends { type: string }, R extends Record<M["type"], unknown>>() {
  return {
    send<T extends M>(message: T): Promise<R[T["type"]] | MessageError | undefined> {
      return chrome.runtime.sendMessage<T, R[T["type"]] | MessageError | undefined>(message);
    },
  };
}
