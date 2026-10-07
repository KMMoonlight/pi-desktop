import test from "node:test";
import assert from "node:assert/strict";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { createPackageNetworkFixture } from "./package-network-fixture.ts";
import { sdkPackageEnvironmentModes } from "./sdk-package-environment-workflows.ts";

for (const mode of sdkPackageEnvironmentModes)
  test(
    `original SDK default npm/legacy global behavior: ${mode}`,
    { timeout: 90000 },
    async () => {
      const fixture = await createFixture();
      const host = new DesktopHost(fixture.agentDir, {
        legacyExampleAdapters: false,
      });
      let network:
        Awaited<ReturnType<typeof createPackageNetworkFixture>> | undefined;
      try {
        network = await createPackageNetworkFixture();
        const path = join(
          fixture.agentDir,
          "desktop",
          "package-environment.mjs",
        );
        await cp(
          new URL("./fixtures/sdk-package-environment.mjs", import.meta.url),
          path,
        );
        await host.initialize(fixture.cwd);
        assert.deepEqual(
          await host.action({
            action: "sdk.run",
            args: { path, args: { mode, network: network.config } },
          }),
          { mode, complete: true },
        );
        await host.withSdk(({ session }) =>
          session.prompt("sdk-package-environment-recovery"),
        );
        assert.equal(host.snapshot().cwd, fixture.cwd);
        assert.ok(
          host
            .snapshot()
            .messages.some((message) => message.role === "assistant"),
        );
      } finally {
        await host.dispose();
        await network?.close();
        await fixture.close();
      }
    },
  );
