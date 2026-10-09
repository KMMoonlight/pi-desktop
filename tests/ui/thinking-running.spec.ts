import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("thinking level is locked while output runs and becomes editable after stopping", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await sdkAction(page, "session.new");
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(initial.agentDir, "models.json");
  const original = await readFile(path, "utf8");
  const config = JSON.parse(original);
  config.providers["desktop-test"].models[0].reasoning = true;
  try {
    await writeFile(path, JSON.stringify(config));
    await sdkAction(page, "models.refresh");
    await sdkAction(page, "model.set", { provider: "desktop-test", id: "desktop-test" });
    await sdkAction(page, "thinking.set", { level: "low" });
    const thinking = page.getByRole("combobox", { name: "思考等级", exact: true });
    await expect(thinking).toBeEnabled();
    await thinking.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await sdkAction(page, "prompt", { message: "application-status-gate" });
    await expect(thinking).toBeDisabled();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(sdkAction(page, "thinking.set", { level: "high" })).rejects.toThrow("请先停止当前任务");
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).thinking).toBe("low");
    await sdkAction(page, "abort");
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).running).toBe(false);
    await expect(thinking).toBeEnabled();
    await thinking.click();
    await page.getByRole("option", { name: "high", exact: true }).click();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).thinking).toBe("high");
    await sdkAction(page, "prompt", { message: "slow-response" });
    await expect(thinking).toBeDisabled();
    await expect.poll(async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).running).toBe(false);
    await expect(thinking).toBeEnabled();
  } finally {
    await sdkAction(page, "abort");
    await writeFile(path, original);
    await sdkAction(page, "models.refresh");
  }
});
