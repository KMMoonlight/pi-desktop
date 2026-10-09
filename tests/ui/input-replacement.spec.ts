import { test } from "@playwright/test";
import { verifyMultilineReplacement } from "../input-replacement-workflows.ts";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const width of [1440, 390]) {
  test(`mapped editor multiline replacement preserves selection, lines and undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const bindings = (value: Record<string, string>) =>
      sdkAction(page, "sdk.run", {
        path: `${agentDir}/desktop/editor-action.mjs`,
        args: { action: "bindings", bindings: value },
      });
    // The workflow explicitly uses Ctrl+Z; Pi's default differs on macOS/Linux.
    await bindings({ "tui.editor.undo": "ctrl+z" });
    try {
      await verifyMultilineReplacement(
        page,
        `.local/screenshots/input-replacement-${width}.png`,
      );
    } finally {
      await bindings({});
    }
  });
}
