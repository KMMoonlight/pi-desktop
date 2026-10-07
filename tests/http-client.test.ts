import assert from "node:assert/strict";
import test from "node:test";
import { BrowserTransport } from "../src/http-client.ts";

test("concurrent callers share token renewal and only unauthorized actions retry", async (context) => {
  let currentToken = "first";
  let tokenRequests = 0;
  const invocations: string[] = [];
  const attempts: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: string, options?: RequestInit) => {
      if (input === "/api/token") {
        tokenRequests++;
        await Promise.resolve();
        return Response.json({ token: currentToken });
      }
      const { action } = JSON.parse(options!.body as string);
      attempts.push(action);
      if (
        (options!.headers as Record<string, string>)["x-desktop-token"] !==
        currentToken
      )
        return new Response(null, { status: 403 });
      invocations.push(action);
      if (action === "reject")
        return Response.json({ error: "Original failure" }, { status: 400 });
      if (action === "unavailable") return new Response(null, { status: 503 });
      return Response.json({ data: action });
    },
  );
  const transport = new BrowserTransport();
  assert.deepEqual(
    await Promise.all([transport.action("a"), transport.action("b")]),
    ["a", "b"],
  );
  assert.equal(tokenRequests, 1);
  currentToken = "second";
  assert.deepEqual(
    await Promise.all([transport.action("c"), transport.action("d")]),
    ["c", "d"],
  );
  assert.equal(tokenRequests, 2);
  assert.deepEqual(invocations, ["a", "b", "c", "d"]);
  assert.equal(attempts.filter((name) => name === "c").length, 2);
  await assert.rejects(transport.action("reject"), {
    message: "Original failure",
  });
  await assert.rejects(transport.action("unavailable"), {
    message: "后台请求失败",
  });
  assert.equal(attempts.filter((name) => name === "reject").length, 1);
  assert.equal(attempts.filter((name) => name === "unavailable").length, 1);
});

test("subscriptions renew credentials, discard retired streams and stop all retry paths", async (context) => {
  let currentToken = "first";
  let unavailable = false;
  const sources: FakeSource[] = [];
  class FakeSource {
    onopen?: () => void;
    onerror?: () => void;
    onmessage?: (value: { data: string }) => void;
    closed = false;
    constructor(readonly url: string) {
      sources.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeSource,
  });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "EventSource", original);
    else Reflect.deleteProperty(globalThis, "EventSource");
  });
  context.mock.method(globalThis, "fetch", async () => {
    if (unavailable) throw new Error("offline");
    return Response.json({ token: currentToken });
  });
  const connections: [boolean, boolean][] = [];
  const events: unknown[] = [];
  const transport = new BrowserTransport();
  const stop = transport.subscribe(
    (event) => events.push(event),
    (connected, restarted) => connections.push([connected, restarted]),
  );
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 10));
    assert.ok(predicate());
  };
  await until(() => sources.length === 1);
  const first = sources[0];
  first.onopen?.();
  first.onerror?.();
  currentToken = "second";
  await until(() => sources.length === 2);
  const second = sources[1];
  assert.ok(first.closed);
  assert.match(second.url, /token=second$/);
  second.onopen?.();
  first.onmessage?.({
    data: JSON.stringify({ type: "notice", message: "retired" }),
  });
  assert.deepEqual(events, []);
  assert.deepEqual(connections, [
    [true, false],
    [false, false],
    [true, true],
  ]);
  second.onmessage?.({ data: JSON.stringify({ type: "shutdown" }) });
  assert.ok(second.closed);
  second.onerror?.();
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(sources.length, 2);
  assert.deepEqual(events, [{ type: "shutdown" }]);
  stop();
  unavailable = true;
  const stopOffline = transport.subscribe(
    () => {},
    () => {},
  );
  await until(() => sources.length === 3);
  sources[2].onerror?.();
  await new Promise((done) => setTimeout(done, 300));
  stopOffline();
  unavailable = false;
  await new Promise((done) => setTimeout(done, 600));
  assert.equal(sources.length, 3);
});
