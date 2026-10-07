import test from "node:test";
import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { sdkResourcesModes } from "./sdk-resources-workflows.ts";

for (const mode of sdkResourcesModes)
  test(
    `original SDK package/resources behavior through hosted module: ${mode}`,
    { timeout: 40000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir, {
        legacyExampleAdapters: false,
      });
      try {
        const path = join(fixture.agentDir, "desktop", "resources.mjs");
        await cp(
          new URL("./fixtures/sdk-resources.mjs", import.meta.url),
          path,
        );
        await host.initialize(fixture.cwd);
        assert.deepEqual(
          await host.action({
            action: "sdk.run",
            args: { path, args: { mode } },
          }),
          { mode, complete: true },
        );
        await host.withSdk(({ session }) =>
          session.prompt("sdk-resource-recovery"),
        );
        assert.equal(host.snapshot().cwd, fixture.cwd);
        assert.ok(
          host
            .snapshot()
            .messages.some((message) => message.role === "assistant"),
        );
      } finally {
        await host.dispose();
        await fixture.close();
      }
    },
  );
