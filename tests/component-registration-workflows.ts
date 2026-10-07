import { expect, type Page } from "@playwright/test";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";
import type { DesktopNode } from "../shared/desktop-ui.ts";

function nodes(node: DesktopNode): DesktopNode[] {
  return [
    node,
    ...("children" in node
      ? node.children
      : node.kind === "region"
        ? [node.child]
        : []
    ).flatMap(nodes),
  ];
}

export const registrationModes = [
  "mutation",
  "duplicates",
  "shared",
  "immutable",
  "terminal",
] as const;
async function verifyRegistration(
  page: Page,
  mode: (typeof registrationModes)[number],
  screenshot?: string,
) {
  await sdkAction(page, "prompt", { message: `/registered-tui-probe ${mode}` });
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Hosted registration root", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Registered branch", { exact: true }),
  ).toBeVisible();
  const command = dialog.getByRole("textbox", {
    name: "Registration command",
    exact: true,
  });
  const fields = page.getByRole("textbox", {
    name: "Registered field",
    exact: true,
  });
  const counts = async () =>
    JSON.parse(
      (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
        "registered-tui"
      ],
    );
  const submit = async (value: string) => {
    await command.focus();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(command).toBeFocused();
    await command.fill(value);
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
        const input = snapshot.desktopSurfaces
          .flatMap((surface) => nodes(surface.view))
          .find(
            (node) =>
              node.kind === "input" && node.label === "Registration command",
          );
        return (
          input?.kind === "input" &&
          input.value === value &&
          Number(await command.getAttribute("data-control-version")) ===
            input.controlVersion
        );
      })
      .toBe(true);
    await expect(command).toHaveValue(value);
    await command.press("Enter");
    if (value !== "finished" && value !== "pause")
      await expect(command).toHaveValue("");
  };
  if (mode === "terminal") {
    const fallback = page.getByLabel("扩展终端组件");
    const terminal = fallback.locator(".xterm-helper-textarea");
    await expect(terminal).toBeFocused();
    await terminal.pressSequentially("native");
    await expect
      .poll(async () =>
        (
          await sdkAction<DesktopSnapshot>(page, "snapshot")
        ).desktopSurfaces.some((surface) =>
          JSON.stringify(surface.view).includes("Registered terminal: native"),
        ),
      )
      .toBe(true);
    await expect(fallback.locator(".xterm-screen")).toBeVisible();
    await expect(fallback.locator(".xterm-rows")).toContainText(
      "Registered terminal: native",
    );
    expect((await counts()).inputs).toBeGreaterThanOrEqual(6);
  } else {
    const expected = mode === "mutation" ? 1 : 2;
    await expect(fields).toHaveCount(expected);
    await expect(fields.first()).toBeFocused();
    await fields.first().pressSequentially("original");
    for (let index = 0; index < expected; index++)
      await expect(fields.nth(index)).toHaveValue("original");
    expect((await counts()).inputs).toBeGreaterThanOrEqual(8);
    if (mode === "mutation") {
      await submit("pause");
      await expect
        .poll(() => command.evaluate((element) => !!element.closest("[inert]")))
        .toBe(true);
      await sdkAction(page, "prompt", { message: "/registered-tui-resume" });
      await expect(command).toHaveValue("");
      await expect(fields).toHaveValue("Paused original state");
      await expect
        .poll(() => command.evaluate((element) => !!element.closest("[inert]")))
        .toBe(false);
      await submit("direct");
      await submit("focus");
      await expect(fields).toBeFocused();
    } else if (mode === "duplicates") {
      await submit("remove");
      await expect(fields).toHaveCount(1);
      expect((await counts()).field).toBe(0);
      await submit("add");
      await expect(fields).toHaveCount(2);
      for (let index = 0; index < 2; index++)
        await expect(fields.nth(index)).toHaveValue("original");
    }
  }
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  await submit("clear");
  await expect(
    page.getByText("Registered branch", { exact: true }),
  ).toHaveCount(0);
  const shared = mode === "shared" || mode === "immutable";
  await expect(fields).toHaveCount(shared ? 1 : 0);
  await expect.poll(async () => (await counts()).field).toBe(shared ? 0 : 1);
  if (shared) {
    await expect(fields).toHaveValue("original");
    await fields.press("End");
    await fields.pressSequentially(" kept");
    await expect(fields).toHaveValue("original kept");
  }
  await submit("finished");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).statuses[
          "registered-tui-result"
        ],
    )
    .toBe(`${mode}:finished`);
  expect(await counts()).toMatchObject({
    field: 1,
    wrapper: 1,
    label: 1,
    root: 1,
  });
}

export async function verifyComponentRegistration(
  page: Page,
  mode: (typeof registrationModes)[number],
  screenshot?: string,
) {
  try {
    await verifyRegistration(page, mode, screenshot);
  } finally {
    // A failed assertion during the pause phase must not leave the shared
    // renderer stopped for every subsequent extension fixture.
    await sdkAction(page, "prompt", { message: "/registered-tui-resume" });
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    for (const surface of snapshot.desktopSurfaces)
      if (
        surface.slot === "dialog" &&
        JSON.stringify(surface.view).includes("Hosted registration root")
      )
        await sdkAction(page, "desktop.close", { id: surface.id });
  }
}
