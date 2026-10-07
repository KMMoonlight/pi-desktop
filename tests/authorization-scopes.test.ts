import test from "node:test";
import assert from "node:assert/strict";
import { AuthorizationScopes } from "../backend/authorization-scopes.ts";
import { bindSessionPrompt } from "../backend/session-prompt.ts";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopEvent } from "../shared/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("authorization settlement preserves result timing and closes ownership before observers", async () => {
  const events: string[] = [];
  const scopes = new AuthorizationScopes(
    () => {},
    (error) => {
      throw error;
    },
  );
  const waiting = deferred();
  let active!: AbortSignal;
  const pending = scopes.run(new AbortController().signal, (scope) => {
    active = scope.signal;
    return waiting.promise;
  });
  const observed = pending.then(() => {
    assert.equal(active.aborted, true);
    events.push("result");
  });
  waiting.resolve();
  queueMicrotask(() => events.push("microtask"));
  await observed;
  assert.deepEqual(events, ["result", "microtask"]);
});

test("authorization scopes retain synchronous and asynchronous original failures", async (t) => {
  for (const synchronous of [false, true])
    await t.test(synchronous ? "throw" : "reject", async () => {
      const events: DesktopEvent[] = [];
      const scopes = new AuthorizationScopes(
        (event) => events.push(event),
        (error) => {
          throw error;
        },
      );
      const failure = new Error("Original operation failure");
      let active!: AbortSignal;
      const pending = scopes.run(new AbortController().signal, (scope) => {
        active = scope.signal;
        scopes.open("https://example.invalid/failing-operation");
        if (synchronous) throw failure;
        return Promise.reject(failure);
      });
      await assert.rejects(pending, (error) => error === failure);
      assert.equal(active.aborted, true);
      assert.equal(
        events.filter((event) => event.type === "activity").length,
        1,
      );
      assert.equal(
        events.filter((event) => event.type === "auth_url").length,
        synchronous ? 0 : 1,
      );
    });
});

test("mapped authorization links own only their browser interaction and preserve subsequent prompts", async () => {
  const events: DesktopEvent[] = [];
  const scopes = new AuthorizationScopes(
    (event) => events.push(event),
    (error) => {
      throw error;
    },
  );
  let visible = new Set<string>();
  let cancelled = 0;
  const firstUrl = "https://example.invalid/first";
  const nextUrl = "https://example.invalid/next";
  await scopes.run(
    new AbortController().signal,
    async (scope) => {
      scopes.open(firstUrl);
      await Promise.resolve();
      scopes.refreshPresentations();
      assert.equal(
        events.filter((event) => event.type === "activity").length,
        0,
        "A link not rendered yet is not a completed interaction",
      );
      visible.add(firstUrl);
      scopes.refreshPresentations();
      scopes.refreshPresentations();
      assert.equal(
        events.filter((event) => event.type === "activity").length,
        0,
      );
      visible.delete(firstUrl);
      scopes.refreshPresentations();
      scopes.refreshPresentations();
      assert.equal(
        events.filter((event) => event.type === "activity").length,
        1,
      );
      assert.equal(
        scope.signal.aborted,
        false,
        "Login work survives closing its browser request",
      );
      assert.equal(
        cancelled,
        0,
        "Returning to another control must not receive a stale cancel key",
      );
      visible.add(nextUrl);
      scopes.open(nextUrl);
      await Promise.resolve();
      scopes.refreshPresentations();
      assert.equal(
        events.filter((event) => event.type === "activity").length,
        1,
      );
      scopes.cancel();
      assert.equal(cancelled, 1);
    },
    () => {
      cancelled++;
    },
    (url) => visible.has(url),
  );
  assert.equal(events.filter((event) => event.type === "activity").length, 2);
});

test("credential completion retains its authorization identity and does not cancel the original component", async () => {
  const events: DesktopEvent[] = [];
  let cancellations = 0;
  const scopes = new AuthorizationScopes(
    (event) => events.push(event),
    (error) => {
      throw error;
    },
  );
  await scopes.run(
    new AbortController().signal,
    async () => {
      scopes.open("https://example.invalid/first");
      await Promise.resolve();
      const completeFirst = scopes.completion();
      scopes.open("https://example.invalid/second");
      await Promise.resolve();
      const completeSecond = scopes.completion();
      const signal = scopes.signal!;
      const cancelledBefore = cancellations;
      completeFirst();
      assert.equal(signal.aborted, false);
      completeSecond();
      completeSecond();
      assert.equal(signal.aborted, true);
      assert.equal(cancellations, cancelledBefore);
    },
    () => {
      cancellations++;
    },
  );
  assert.equal(events.filter((event) => event.type === "auth_url").length, 2);
  assert.equal(events.filter((event) => event.type === "activity").length, 2);
});

test("retiring an old authorization closes only its own banner and preserves the newer input", async () => {
  const events: DesktopEvent[] = [];
  const errors: unknown[] = [];
  const scopes = new AuthorizationScopes(
    (event) => events.push(event),
    (error) => errors.push(error),
  );
  const lifetime = new AbortController();
  const first = deferred(),
    second = deferred();
  let newerSignal: AbortSignal | undefined;
  const a = scopes.run(lifetime.signal, async () => {
    scopes.open("https://example.invalid/first");
    await first.promise;
  });
  const b = scopes.run(lifetime.signal, async () => {
    scopes.open("https://example.invalid/second");
    newerSignal = scopes.signal;
    await second.promise;
  });
  await Promise.resolve();
  const opened = events.filter((event) => event.type === "auth_url");
  assert.notEqual(opened[0].id, opened[1].id);
  first.resolve();
  await a;
  assert.equal(newerSignal?.aborted, false);
  scopes.cancel();
  // The most recently opened authorization owns the global cancel action.
  assert.equal(newerSignal?.aborted, true);
  second.resolve();
  await b;
  assert.deepEqual(errors, []);
});

test("aborted authorization scope rejects late URLs and still completes after a throwing cancel handler", async () => {
  const events: DesktopEvent[] = [],
    errors: unknown[] = [];
  const scopes = new AuthorizationScopes(
    (event) => events.push(event),
    (error) => errors.push(error),
  );
  const lifetime = new AbortController();
  await scopes.run(
    lifetime.signal,
    async () => {
      scopes.open("https://example.invalid/active");
      await Promise.resolve();
      lifetime.abort();
      scopes.open("https://example.invalid/stale");
    },
    () => {
      throw new Error("original cancel failure");
    },
  );
  assert.equal(events.filter((event) => event.type === "auth_url").length, 1);
  assert.equal(events.filter((event) => event.type === "activity").length, 1);
  assert.equal(errors.length, 1);
});

test("hosted prompt scoping preserves original SDK method identity and restores custom methods", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const prototype = AgentSession.prototype.prompt;
  try {
    await host.initialize(fixture.cwd);
    const session = host.session;
    assert.notEqual(session.prompt, prototype);
    await session.prompt("scoped prompt");
    await host.dispose();
    assert.equal(session.prompt, prototype);
    assert.equal(AgentSession.prototype.prompt, prototype);
    let calls = 0;
    const custom: AgentSession["prompt"] = async () => {
      calls++;
    };
    Object.defineProperty(session, "prompt", {
      value: custom,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    const before = Object.getOwnPropertyDescriptor(session, "prompt");
    const unbind = bindSessionPrompt(session, (operation) => operation());
    await session.prompt("custom");
    unbind();
    assert.equal(calls, 1);
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(session, "prompt"),
      before,
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
