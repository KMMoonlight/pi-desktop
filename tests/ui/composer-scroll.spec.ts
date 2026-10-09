import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

for (const viewport of [
  { width: 1440, height: 940 },
  { width: 760, height: 580 },
])
  test(`typing preserves the transcript bottom and reading position at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    await sdkAction(page, "session.new");
    const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const seed = join(agentDir, "desktop", "composer-scroll-history.mjs");
    await writeFile(
      seed,
      `export default ({session}) => {
      session.sessionManager.appendMessage({role:"user",content:"Scroll fixture",timestamp:Date.now()});
      session.sessionManager.appendMessage({role:"assistant",content:[{type:"text",text:Array.from({length:40},(_,i)=>"Paragraph "+i+" with enough conversation content to scroll.").join("\\n\\n")}],api:"openai-completions",provider:"desktop-test",model:"desktop-test",stopReason:"stop",timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
      session.agent.state.messages=session.sessionManager.buildSessionContext().messages;
    };`,
    );
    await sdkAction(page, "sdk.run", { path: seed });
    const transcript = page.locator(".transcript");
    await expect(transcript).toContainText("Paragraph 39");
    await transcript.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect
      .poll(() =>
        transcript.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.evaluate(() => {
      const transcript = document.querySelector<HTMLElement>(".transcript")!;
      const probe = { active: true, gaps: [] as number[] };
      (window as any).composerScrollProbe = probe;
      const sample = () => {
        probe.gaps.push(
          transcript.scrollHeight -
            transcript.clientHeight -
            transcript.scrollTop,
        );
        if (probe.active) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await editor.pressSequentially("测试输入内容", { delay: 60 });
    await editor.fill("Draft line 0");
    for (let i = 1; i < 12; i++) {
      await editor.press("Shift+Enter");
      await editor.pressSequentially(`Draft line ${i}`);
    }
    await expect
      .poll(() =>
        editor.evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBeGreaterThan(200);
    await editor.pressSequentially("继续输入", { delay: 60 });
    await editor.fill("short draft");
    await expect
      .poll(() =>
        transcript.evaluate(
          (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
        ),
      )
      .toBeLessThanOrEqual(1);
    const gaps = await page.evaluate(() => {
      const probe = (window as any).composerScrollProbe;
      probe.active = false;
      return probe.gaps as number[];
    });
    expect(Math.max(...gaps), JSON.stringify(gaps)).toBeLessThanOrEqual(1);
    // A reader who has scrolled up must keep their place as the draft grows.
    await transcript.evaluate((node) => {
      node.scrollTop = 300;
    });
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeVisible();
    const before = await transcript.evaluate((node) => node.scrollTop);
    await editor.fill("Draft line 0");
    for (let i = 1; i < 12; i++) {
      await editor.press("Shift+Enter");
      await editor.pressSequentially(`Draft line ${i}`);
    }
    await expect
      .poll(() =>
        editor.evaluate((node) => node.getBoundingClientRect().height),
      )
      .toBeGreaterThan(200);
    await editor.fill("short draft");
    await expect
      .poll(() => transcript.evaluate((node) => node.scrollTop))
      .toBe(before);
  });
