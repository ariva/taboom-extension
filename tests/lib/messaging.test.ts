import assert from "node:assert/strict";
import { test } from "vitest";
import { createMessenger } from "../../src/lib/messaging.ts";

type Msg = { type: "ping"; n: number } | { type: "boom" };
interface Responses {
  ping: { pong: number };
  boom: { ok: true };
}

// hand-rolled fake: only what the unit touches (`as`: a one-method stand-in for the chrome global)
function fakeChrome(sendMessage: (message: unknown) => Promise<unknown>): void {
  globalThis.chrome = { runtime: { sendMessage } } as unknown as typeof chrome;
}

test("Lib - Messaging - send passes the message object through untouched and resolves with the answer", async () => {
  const sent: unknown[] = [];
  fakeChrome(async (message) => {
    sent.push(message);
    return { pong: 2 };
  });
  const { send } = createMessenger<Msg, Responses>();
  const message: Msg = { type: "ping", n: 1 };

  const response = await send(message);

  assert.equal(sent.length, 1);
  assert.equal(sent[0], message, "same object, no envelope");
  assert.ok(response && "pong" in response, "data side readable after narrowing");
  assert.equal(response.pong, 2);
});

test("Lib - Messaging - An error answer and a missing listener come back as they are", async () => {
  fakeChrome(async () => ({ error: "Error: nope" }));
  const { send } = createMessenger<Msg, Responses>();
  const failed = await send({ type: "boom" });
  assert.ok(failed && "error" in failed);
  assert.equal(failed.error, "Error: nope");

  fakeChrome(async () => undefined);
  assert.equal(await send({ type: "boom" }), undefined, "no listener answered");
});

test("Lib - Messaging - A rejection reaches the caller (no catching, no retry)", async () => {
  let attempts = 0;
  fakeChrome(async () => {
    attempts++;
    throw new Error("Could not establish connection");
  });
  const { send } = createMessenger<Msg, Responses>();
  await assert.rejects(send({ type: "boom" }), /Could not establish connection/);
  assert.equal(attempts, 1);
});
