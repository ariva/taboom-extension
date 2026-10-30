// Typed chrome.runtime messaging. One factory call per extension binds the
// message union and its response map; send() is then checked per message type.

// a handler that threw, an unknown message type, or a send that never reached the
// worker (asleep and failing to start, extension context invalidated): String(error)
export interface MessageError {
  error: string;
}

// M: union of { type: "…", …payload }. R: message type → what its handler answers with.
// send() resolves with undefined when no listener answered and never rejects: a
// rejection (the worker gone, the page outliving its extension context) comes back
// as an error answer, so a fire-and-forget call cannot leak an unhandled rejection
// and a loop over many sends runs to its end. No retries.
export function createMessenger<M extends { type: string }, R extends Record<M["type"], unknown>>() {
  return {
    send<T extends M>(message: T): Promise<R[T["type"]] | MessageError | undefined> {
      return chrome.runtime
        .sendMessage<T, R[T["type"]] | MessageError | undefined>(message)
        .catch((error: unknown): MessageError => ({ error: String(error) }));
    },
  };
}
