import { test, expect, type Page } from "@playwright/test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

async function setup(page: Page, width: number) {
  await page.setViewportSize({ width, height: 740 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const backdrop = page.getByRole("button", {
    name: "关闭侧边栏遮罩",
    exact: true,
  });
  if (await backdrop.isVisible())
    await backdrop.click({ position: { x: width - 5, y: 500 } });
  await sdkAction(page, "session.new");
  const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(
    snapshot.agentDir,
    "desktop",
    "transcript-scroll-control.mjs",
  );
  await cp(
    new URL("../fixtures/transcript-scroll-control.mjs", import.meta.url),
    path,
  );
  const run = (mode: string, count?: number) =>
    sdkAction<{ path: string }>(page, "sdk.run", {
      path,
      args: { mode, count },
    });
  await run("seed");
  const transcript = page.locator(".transcript");
  await expect(transcript).toContainText("History 39:");
  const bottom = () =>
    expect
      .poll(() =>
        transcript.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
  const up = async () => {
    await transcript.evaluate((node) => {
      node.scrollTop = 300;
    });
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeVisible();
  };
  return { run, transcript, bottom, up };
}

for (const width of [1440, 760]) {
  test(`bottom button clears when overflow changes without resizing the transcript at ${width}px`, async ({
    page,
  }) => {
    const { transcript, bottom, up } = await setup(page, width);
    await bottom();
    await up();
    // Positioned extension content can change scrollHeight without changing
    // either box observed by ResizeObserver.
    await transcript.evaluate((node) => {
      const inner = node.querySelector<HTMLElement>(".transcript-inner")!;
      inner.style.position = "relative";
      const overflow = document.createElement("div");
      overflow.dataset.scrollOverflowProbe = "";
      Object.assign(overflow.style, {
        position: "absolute",
        top: "100%",
        height: "200px",
        width: "1px",
      });
      inner.append(overflow);
      node.scrollTop = node.scrollHeight;
    });
    await bottom();
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeHidden();
    await transcript.evaluate((node) => {
      node.querySelector("[data-scroll-overflow-probe]")?.remove();
    });
    await bottom();
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeHidden();
    await up();
  });

  test(`returning to live output keeps following growth and shrinkage at ${width}px`, async ({
    page,
  }) => {
    const { run, transcript, bottom, up } = await setup(page, width);
    try {
      await run("stream", 30);
      await bottom();
      await up();
      const readingTop = await transcript.evaluate((node) => node.scrollTop);
      await run("stream", 40);
      await expect(transcript).toContainText("Streaming 39:");
      expect(await transcript.evaluate((node) => node.scrollTop)).toBe(
        readingTop,
      );
      await page
        .getByRole("button", { name: "回到最新消息", exact: true })
        .click();
      // New chunks arrive before a smooth scroll could reach its old destination.
      await run("stream", 60);
      await run("stream", 80);
      await bottom();
      await expect(
        page.getByRole("button", { name: "回到最新消息", exact: true }),
      ).toBeHidden();
      await run("stream", 5);
      await bottom();
      await run("stream", 90);
      await bottom();
      await transcript.hover();
      await page.mouse.wheel(0, -500);
      await expect(
        page.getByRole("button", { name: "回到最新消息", exact: true }),
      ).toBeVisible();
      await run("stream", 100);
      await expect
        .poll(() =>
          transcript.evaluate(
            (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
          ),
        )
        .toBeGreaterThan(100);
    } finally {
      await run("clear");
    }
  });

  test(`switching sessions and sending a new turn reset output following at ${width}px`, async ({
    page,
  }) => {
    const { run, transcript, bottom, up } = await setup(page, width);
    const first = await sdkAction<DesktopSnapshot>(page, "snapshot");
    await sdkAction(page, "session.new");
    await run("seed");
    await bottom();
    await up();
    await sdkAction(page, "session.switch", { path: first.sessionFile });
    await bottom();
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeHidden();
    await up();
    try {
      await run("turn");
      await run("stream", 20);
      await expect(transcript).toContainText("Streaming 19:");
      await bottom();
    } finally {
      await run("clear");
    }
  });
}
