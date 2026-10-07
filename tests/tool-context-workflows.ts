import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export async function verifyToolContext(page: Page, screenshot: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const directory = join(initial.agentDir, "desktop");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "tool-context-control.mjs");
  await cp(
    new URL("./fixtures/tool-context-control.mjs", import.meta.url),
    path,
  );
  const control = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", { path, args });
  const command = (name: string) =>
    sdkAction(page, "prompt", { message: `/${name}` });
  const call = page.getByText(/^Context call /);
  const result = page.getByText(/^Context result /);
  try {
    for (const mode of [
      "success",
      "error",
      "nested",
      "abort",
      "abort-generation",
    ]) {
      await sdkAction(page, "session.new");
      await control({ action: "arm" });
      const sending = sdkAction(page, "prompt", {
        message: `context-lifecycle-${mode}`,
      });
      sending.catch(() => {});
      // Normal transcript mode discloses the SDK renderer through its tool row.
      await page.getByRole("button", { name: "展开 context_tool 输出", exact: true }).click();
      await expect(call).toContainText(
        "args=false; started=false; partial=true; error=false",
      );
      const live = await sdkAction<DesktopSnapshot>(page, "snapshot");
      const id = live.streaming!.content.find(
        (block) => block.type === "toolCall",
      )!.id!;
      if (mode === "abort-generation") {
        await sdkAction(page, "abort");
        await sending;
        await expect(result).toContainText("Operation aborted");
        await expect(call).toContainText(
          "args=false; started=false; partial=false; error=true",
        );
        await expect(result).toContainText(
          "args=false; started=false; partial=false; error=true",
        );
        continue;
      }
      await control({ action: "release" });
      if (mode === "nested") {
        await expect
          .poll(
            async () =>
              !!(await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
                "context-child"
              ],
          )
          .toBe(true);
        expect(
          (await sdkAction<DesktopSnapshot>(page, "snapshot")).activeTools.map(
            (tool) => tool.name,
          ),
        ).not.toContain("context_child");
        await command("context-child-finish");
      }
      await expect(call).toContainText(
        "args=true; started=true; partial=true; error=false",
      );
      await command("context-partial");
      await expect(result).toContainText("Context partial");
      await expect(result).toContainText(
        "args=true; started=true; partial=true; error=false",
      );
      await result.click({ position: { x: 6, y: 6 } });
      for (const [index, slot] of ["call", "result"].entries()) {
        const observation = await control({ action: "invalidate", id, slot });
        expect(observation).toMatchObject({
          synchronous: true,
          sameArguments: true,
        });
        await expect(call).toContainText(`tick=${index + 1}`);
        await expect(result).toContainText(`tick=${index + 1}`);
      }
      if (mode === "abort") await sdkAction(page, "abort");
      else await command("context-finish");
      await sending;
      const error = mode === "error" || mode === "abort";
      await expect(call).toContainText(
        `args=true; started=true; partial=false; error=${error}`,
      );
      await expect(result).toContainText(
        `args=true; started=true; partial=false; error=${error}`,
      );
      await expect(page.locator(".tool-running")).toHaveCount(0);
      if (mode === "error")
        await page.screenshot({ path: screenshot, animations: "disabled" });
      const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
      await sdkAction(page, "resources.reload");
      await expect(call).toContainText(
        `args=false; started=false; partial=false; error=${error}`,
      );
      await sdkAction(page, "session.new");
      await sdkAction(page, "session.switch", { path: saved.sessionFile });
      await expect(result).toContainText(
        `args=false; started=false; partial=false; error=${error}`,
      );
    }
  } finally {
    // Release the fixture's deliberately paused HTTP stream before aborting.
    // Otherwise cleanup can mask a UI assertion by waiting on that stream.
    await control({ action: "release" });
    await sdkAction(page, "abort");
  }
}
