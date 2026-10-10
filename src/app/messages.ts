// chrome.runtime messages the background service worker handles (sent by the
// side panel and options pages): the message union, the response map, and the
// typed send() built from them.
// Payload fields are exactly what handleMessage() in background/messages.ts reads.
import { createMessenger } from "../lib/messaging.ts";

export type { MessageError } from "../lib/messaging.ts";

export type Message =
  | { type: "snooze-tab"; tabId: number }
  | { type: "toggle-site-protection"; tabId: number }
  | { type: "protect-hosts"; hosts: string[] }
  | { type: "protect-urls"; urls: string[] }
  | { type: "unprotect-urls"; urls: string[] }
  | { type: "snooze-all-inactive" }
  | { type: "history-back" }
  | { type: "history-forward" }
  | { type: "history-jump"; index: number }
  | { type: "history-remove"; index: number }
  | { type: "panels-to-restore"; excludeWindowId: number }
  | { type: "panels-restore-dismiss"; windowIds: number[] }
  // empty / missing name clears it
  | { type: "window-rename"; windowId: number; name?: string }
  // null / empty color = back to the automatic color
  | { type: "window-set-color"; windowId: number; color?: string | null }
  | { type: "tabs-woken"; tabIds: number[] }
  | { type: "window-pin"; windowId: number; pinned?: boolean }
  // keep-it-alive marks for these tabs' pages (closed ids are skipped)
  | { type: "keep-alive-set"; tabIds: number[]; kept: boolean }
  | { type: "sidebar-focused" }
  | { type: "sidebar-no-focus" };

export type MessageType = Message["type"];

// handlers that resolve with nothing are answered with the generic ack
export interface MessageAck {
  ok: true;
}

// message type → what its handler answers with. Complete on purpose: a new
// Message member without an entry here fails createMessenger's constraint.
export interface MessageResponses {
  "snooze-tab": MessageAck;
  "toggle-site-protection": { protected: boolean };
  "protect-hosts": MessageAck;
  "protect-urls": MessageAck;
  "unprotect-urls": MessageAck;
  "snooze-all-inactive": MessageAck;
  "history-back": MessageAck;
  "history-forward": MessageAck;
  "history-jump": MessageAck;
  "history-remove": MessageAck;
  "panels-to-restore": { windows: number[] };
  "panels-restore-dismiss": MessageAck;
  "window-rename": MessageAck;
  "window-set-color": MessageAck;
  "tabs-woken": MessageAck;
  "window-pin": MessageAck;
  "keep-alive-set": MessageAck;
  "sidebar-focused": MessageAck;
  "sidebar-no-focus": MessageAck;
}

// resolves with the handler's answer, a MessageError when it threw, or
// undefined when no listener answered; rejects while the worker is unreachable
export const { send } = createMessenger<Message, MessageResponses>();
