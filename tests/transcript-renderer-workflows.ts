import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

interface Observed {
  receiverId: number;
  native: boolean;
  rawIdentity: boolean;
  optionKeys: string[];
  options: { expanded: boolean; outputPad?: number };
}
interface Observation {
  observations: Record<string, Observed>;
  components: { id: number; disposed: number; submitted?: string }[];
}

export async function verifyTranscriptRenderers(
  page: Page,
  screenshot: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(
    initial.agentDir,
    "desktop",
    "transcript-renderer-control.mjs",
  );
  await cp(
    new URL("./fixtures/transcript-renderer-control.mjs", import.meta.url),
    path,
  );
  const run = (args: Record<string, unknown>) =>
    sdkAction(page, "sdk.run", { path, args });
  const command = (message: string) => sdkAction(page, "prompt", { message });
  const observe = async () => {
    await command("/transcript-renderer-observe");
    return JSON.parse(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "transcript-renderer-observe"
      ],
    ) as Observation;
  };
  const transcript = page.locator(".transcript");
  const input = transcript.getByRole("textbox", {
    name: "Message renderer input",
    exact: true,
  });
  const label = transcript.getByText(/^Message renderer;/);
  try {
    const image = (await readFile("src-tauri/icons/128x128.png")).toString(
      "base64",
    );
    await run({
      mode: "seed",
      image,
      outputPad: 0,
      codeBlockIndent: "    ",
      expanded: false,
    });
    await expect(input).toHaveValue("Original message input");
    await expect(label).toContainText("expanded=false; pad=0");
    for (const type of [
      "undefined-message",
      "throwing-message",
      "absent-message",
    ])
      await expect(
        transcript.getByText(`[${type}]`, { exact: true }),
      ).toBeVisible();
    await expect(
      transcript.getByText("[duplicate-message]", { exact: true }),
    ).toHaveCount(2);
    for (const text of [
      "Collision first",
      "Collision second",
      "Array fallback first",
      "Array fallback second",
    ])
      await expect(transcript.getByText(text, { exact: true })).toBeVisible();
    await expect(
      transcript.getByText(
        "[throwing-entry] renderer failed: Entry fixture failure",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(transcript.getByText(/hidden-message/)).toHaveCount(0);
    await expect(transcript.locator("img")).toHaveCount(0);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const empty = snapshot.desktopSurfaces.find(
      (surface) =>
        surface.slot === "entry" &&
        snapshot.messages.some(
          (message) =>
            message.customType === "undefined-entry" &&
            message.desktopSurfaceId === surface.id,
        ),
    )!;
    await expect
      .poll(() =>
        page
          .locator(`[data-surface-id="${empty.id}"]`)
          .evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBe(0);
    await input.fill("Desktop custom message");
    await input.press("Enter");
    await expect
      .poll(async () =>
        (await observe()).components.some(
          (component) => component.submitted === "Desktop custom message",
        ),
      )
      .toBe(true);
    const first = await observe();
    for (const [key, state] of Object.entries(first.observations)) {
      expect(state.native).toBe(true);
      expect(state.rawIdentity).toBe(true);
      expect(state.optionKeys).toEqual(
        key.endsWith("message") ? ["expanded", "outputPad"] : ["expanded"],
      );
    }
    await run({ expanded: true, outputPad: 1 });
    await expect(label).toContainText("expanded=true; pad=1");
    await sdkAction(page, "theme.set", { theme: "dark" });
    await expect(input).toHaveValue("Desktop custom message");
    const later = await observe();
    expect(later.observations["receiver-message"].receiverId).toBe(
      first.observations["receiver-message"].receiverId,
    );
    expect(later.observations["receiver-entry"].receiverId).toBe(
      first.observations["receiver-entry"].receiverId,
    );
    await command("/transcript-renderer-observe clear");
    await label.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await page.reload();
    await expect(input).toHaveValue("Desktop custom message");
    await command("/transcript-renderer-mode empty");
    await run({ mode: "invalidate" });
    await expect(input).toHaveCount(0);
    await expect(
      transcript.getByText("[receiver-message]", { exact: true }),
    ).toBeVisible();
    await expect(transcript.getByText(/^Entry renderer;/)).toHaveCount(0);
    await command("/transcript-renderer-mode error");
    await run({ mode: "invalidate" });
    await expect(
      transcript.getByText(
        "[receiver-entry] renderer failed: Reactive entry failure",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "Reactive message failure" }),
    ).toHaveCount(0);
    await command("/transcript-renderer-mode custom");
    await run({ mode: "invalidate" });
    await expect(input).toHaveValue("Original message input");
    const recovered = await observe();
    expect(recovered.observations["receiver-message"].receiverId).toBe(
      first.observations["receiver-message"].receiverId,
    );
    expect(
      recovered.components.filter((component) => component.disposed === 1),
    ).toHaveLength(1);
    const saved = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "resources.reload");
    await expect(input).toHaveValue("Original message input");
    await expect(label).toContainText("pad=1");
    await sdkAction(page, "session.new");
    await sdkAction(page, "session.switch", { path: saved.sessionFile });
    await expect(input).toHaveValue("Original message input");
    await expect(
      transcript.getByText("Collision second", { exact: true }),
    ).toBeVisible();
    await expect(
      transcript.getByText("[duplicate-message]", { exact: true }),
    ).toHaveCount(2);
    expect(
      await transcript.evaluate(
        (element) => element.scrollWidth > element.clientWidth + 1,
      ),
    ).toBe(false);
  } finally {
    if (!page.isClosed()) {
      await run({
        outputPad: initial.settings.outputPad ?? 1,
        expanded: false,
      });
      await sdkAction(page, "theme.set", {
        theme: initial.extensionUI.theme?.name ?? "system",
      });
    }
  }
}
