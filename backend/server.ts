import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { DesktopHost, record } from "./host.ts";
import type { ActionRequest } from "../shared/types.ts";
import { connectNativeChannel } from "./native-channel.ts";
import { TerminalHost } from "./terminal-host.ts";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "../shared/errors.ts";
import { actionResult } from "./action-result.ts";
import { loadStartupPolicyRuntime } from "./startup-policy-runtime.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

if (process.env.PI_DESKTOP_AGENT_DIR)
  process.env.PI_CODING_AGENT_DIR = process.env.PI_DESKTOP_AGENT_DIR;
if (process.env.PI_DESKTOP_PTY === "1" && !process.env.SHELL) {
  try {
    process.env.SHELL = getShellConfig().shell;
  } catch {
    /* Extensions receive their normal shell error when no shell is installed. */
  }
}
const nativeChannel = process.argv.includes("--desktop-channel")
  ? await connectNativeChannel()
  : undefined;
const host =
  process.argv.includes("--sdk-worker") || process.argv.includes("--stdio")
    ? new DesktopHost(process.env.PI_DESKTOP_AGENT_DIR, {
        legacyExampleAdapters:
          process.env.PI_DESKTOP_LEGACY_EXAMPLE_ADAPTERS === "1",
      })
    : new TerminalHost();
if (
  process.argv.includes("--sdk-worker") &&
  process.env.PI_DESKTOP_PTY === "1"
) {
  // Console Ctrl+C also reaches the worker when no raw input owner is active.
  // Keep its lifecycle alive; interactive children receive the same signal.
  process.on("SIGINT", () => {
    if (host.runtime)
      void host.action({ action: "abort" }).catch(console.error);
  });
}
const protocolOutput = nativeChannel ?? process.stdout;
let crashing = false;
process.on("uncaughtException", (error) => {
  if (crashing) process.exit(1);
  crashing = true;
  console.error("pi exiting due to uncaughtException:", error);
  void (async () => {
    const api = await loadStartupPolicyRuntime();
    if (host instanceof DesktopHost) {
      const hint = await host.startupPolicies.crashHint(error);
      if (hint) console.error(hint);
      if (await host.startupPolicies.recordCrash("uncaught_exception", error))
        console.error(
          host.startupPolicies.crashInstructions() ??
            "Run pi /bug to report this crash.",
        );
    } else {
      api.recordCrash(
        { kind: "uncaught_exception", error, cwd: process.cwd() },
        join(getAgentDir(), "crashes.json"),
      );
    }
    api.killChildren();
  })()
    .catch((error) => console.error(error))
    .finally(() => {
      // Fatal exit bypasses asynchronous session shutdown, as in native Pi.
      // Flush its explicit signal to the supervisor before closing the worker.
      if (
        nativeChannel &&
        !nativeChannel.destroyed &&
        !nativeChannel.writableEnded
      )
        nativeChannel.end(
          JSON.stringify({ event: { type: "shutdown", exitCode: 1 } }) + "\n",
          () => process.exit(1),
        );
      else process.exit(1);
    });
});
const protocolInput = nativeChannel ?? process.stdin;
const protocolWrite = protocolOutput.write.bind(protocolOutput);
console.log = (...values) => console.error(...values);
if (nativeChannel || process.argv.includes("--stdio")) {
  if (!nativeChannel)
    process.stdout.write = process.stderr.write.bind(process.stderr);
  const output = (value: unknown) =>
    !protocolOutput.destroyed &&
    !protocolOutput.writableEnded &&
    protocolWrite(JSON.stringify(value) + "\n");
  let finishing = false;
  let exitCode = 0;
  const finish = (code = 0) => {
    if (code) exitCode = code;
    if (finishing) return;
    finishing = true;
    // Joined disposal callers publish their event/response in promise
    // callbacks. Let all of them finish, then drain the protocol before exit.
    setImmediate(() => {
      if (protocolOutput.destroyed || protocolOutput.writableEnded)
        process.exit(exitCode);
      else if (nativeChannel) nativeChannel.end(() => process.exit(exitCode));
      else protocolWrite("", () => process.exit(exitCode));
    });
  };
  const disconnected = (code = 0) => {
    if (finishing) return;
    void host.dispose().then(
      () => finish(code),
      (error) => {
        console.error(error);
        finish(1);
      },
    );
  };
  host.on("event", (event) => {
    output({ event });
    if (event.type === "shutdown") disconnected(event.exitCode);
  });
  let input = "";
  protocolOutput.on("error", (error) => {
    console.error(error);
    disconnected(1);
  });
  nativeChannel?.on("close", () => disconnected());
  protocolInput.setEncoding("utf8");
  protocolInput.on("data", (chunk) => {
    input += chunk;
    let index: number;
    while ((index = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, index);
      input = input.slice(index + 1);
      try {
        const request = record(JSON.parse(line));
        if (request.action === "shutdown") {
          void host.dispose().then(
            () => {
              output({ id: request.id, data: null });
              finish();
            },
            (error) => {
              output({ id: request.id, error: errorMessage(error) });
              finish(1);
            },
          );
          continue;
        }
        void host
          .action(request as unknown as ActionRequest)
          .then((data) => output({ id: request.id, data: actionResult(data) }))
          .catch((error) =>
            output({ id: request.id, error: errorMessage(error) }),
          );
      } catch (error) {
        output({
          error: errorMessage(error),
        });
      }
    }
  });
  protocolInput.on("end", () => disconnected());
  if (!nativeChannel) protocolInput.on("error", () => disconnected(1));
  process.on("SIGTERM", () => disconnected());
  if (process.env.PI_DESKTOP_PTY !== "1")
    process.on("SIGINT", () => disconnected());
} else {
  const port = Number(process.env.PI_DESKTOP_PORT ?? 4319);
  const token = randomBytes(24).toString("hex");
  const clients = new Set<import("node:http").ServerResponse>();
  host.on("event", (event) => {
    for (const client of clients)
      client.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "shutdown") close(event.exitCode);
  });
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host ?? "")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const localOrigin = origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
    if (origin && !localOrigin) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/api/token") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ token }));
      return;
    }
    if (
      (req.headers["x-desktop-token"] ?? url.searchParams.get("token")) !==
      token
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      clients.add(res);
      res.write(": connected\n\n");
      if (host.runtime)
        res.write(
          `data: ${JSON.stringify({ type: "snapshot", data: host.snapshot() })}\n\n`,
        );
      for (const data of host.pendingDialogs)
        res.write(`data: ${JSON.stringify({ type: "dialog", data })}\n\n`);
      const timer = setInterval(() => res.write(": keepalive\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(timer);
        clients.delete(res);
      });
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/api/action") {
      res.writeHead(404);
      res.end();
      return;
    }
    let shutdownRequested = false;
    let failed = false;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 12 * 1024 * 1024) throw new Error("请求过大");
      }
      const request = record(JSON.parse(body));
      if (typeof request.action !== "string") throw new Error("操作格式错误");
      shutdownRequested = request.action === "shutdown";
      const data = shutdownRequested
        ? await host.dispose().then(() => null)
        : await host.action({
            action: request.action,
            args: record(request.args),
          });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: actionResult(data) }));
    } catch (error) {
      failed = true;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: errorMessage(error),
        }),
      );
    } finally {
      if (shutdownRequested) close(failed ? 1 : 0);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.error(
      `Pi SDK backend: http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`,
    );
  });
  let closing = false;
  let exitCode = 0;
  const close = (code = 0) => {
    if (code) exitCode = code;
    if (closing) return;
    closing = true;
    const drained = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    void (async () => {
      try {
        await host.dispose();
      } catch (error) {
        console.error(error);
        exitCode = 1;
      }
      for (const client of clients) client.end();
      // Stop accepting requests immediately, but drain existing responses and
      // SSE shutdown events before terminating the supervisor.
      await drained;
      process.exit(exitCode);
    })();
  };
  process.on("SIGINT", () => close());
  process.on("SIGTERM", () => close());
}
