import { test, expect, type Page } from "@playwright/test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows";
import { selectField, selectSettingsCategory } from "../select-field";
import { createMcpHttpFixture } from "../mcp-http-fixture";
import type { DesktopSnapshot, McpSettingsSnapshot } from "../../shared/types";
import type { DesktopNode } from "../../shared/desktop-ui";

function choice(
  node: DesktopNode,
  value: string,
): Extract<DesktopNode, { kind: "select" }> | undefined {
  if (
    node.kind === "select" &&
    node.options.some((option) => option.value === value)
  )
    return node;
  for (const child of "children" in node
    ? node.children
    : node.kind === "region"
      ? [node.child]
      : []) {
    const found = choice(child, value);
    if (found) return found;
  }
}
async function mcpMenu(page: Page, value: string) {
  let menu: { id: string; action: string; instanceId?: string } | undefined;
  await expect
    .poll(async () => {
      const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
      for (const surface of snapshot.desktopSurfaces.filter(
        (surface) => surface.slot === "dialog",
      )) {
        const control = choice(surface.view, value);
        if (control) {
          menu = {
            id: surface.id,
            action: control.action,
            instanceId: surface.instanceId,
          };
          break;
        }
      }
      return !!menu;
    })
    .toBe(true);
  return menu!;
}
async function chooseMcp(page: Page, value: string) {
  const menu = await mcpMenu(page, value);
  await sdkAction(page, "desktop.action", { ...menu, value });
  await sdkAction(page, "desktop.action", {
    ...menu,
    action: `${menu.action}:submit`,
  });
  return menu.id;
}

for (const width of [1440, 390]) {
  test(`MCP inherited project overrides use native config behavior at ${width}px`, async ({
    page,
  }) => {
    const peer = await createMcpHttpFixture();
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "session.new");
    await sdkAction(page, "trust.set", { trusted: true });
    const originalGlobal = await sdkAction<string>(page, "config.read", {
      name: "mcp.json",
    });
    const originalProject = await sdkAction<string>(page, "config.read", {
      name: "mcp.json",
      local: true,
    });
    try {
      await sdkAction(page, "config.save", {
        name: "mcp.json",
        content: JSON.stringify({
          metadata: "global",
          mcpServers: { inherited: { ...peer.config, enabled: false } },
        }),
      });
      await sdkAction(page, "config.save", {
        name: "mcp.json",
        local: true,
        content: JSON.stringify({ metadata: "project", mcpServers: {} }),
      });
      const global = await sdkAction<string>(page, "config.read", {
        name: "mcp.json",
      });
      await page.keyboard.press("Control+,");
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await selectSettingsCategory(settings, "MCP");
      await selectField(
        settings.getByRole("combobox", { name: "配置范围", exact: true }),
        "project",
      );
      const row = settings
        .locator(".server-row")
        .filter({ hasText: "inherited" });
      await expect(row).toContainText("继承全局配置");
      await expect(row).toContainText(peer.config.url!);
      await expect(
        row.getByRole("button", { name: "登录 inherited", exact: true }),
      ).toBeVisible();
      await expect(row.getByRole("switch")).not.toBeChecked();
      await row.getByRole("switch").click();
      await expect(row.getByRole("switch")).toBeChecked();
      await expect(row).toContainText("项目覆盖");
      await expect
        .poll(() =>
          peer.requests.some((request) => request.method === "tools/list"),
        )
        .toBe(true);
      await expect(row.getByRole("combobox")).toBeEnabled();
      await selectField(row.getByRole("combobox"), "hidden");
      await expect
        .poll(
          async () =>
            JSON.parse(
              await sdkAction<string>(page, "config.read", {
                name: "mcp.json",
                local: true,
              }),
            ).mcpServers.inherited,
        )
        .toEqual({ enabled: true, exposure: "hidden" });
      expect(
        await sdkAction<string>(page, "config.read", { name: "mcp.json" }),
      ).toBe(global);
      await mkdir(".local/pi-120", { recursive: true });
      await page.screenshot({
        path: `.local/pi-120/mcp-project-override-${width}.png`,
      });
      expect(
        await row.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true);
      await row
        .getByRole("button", { name: "恢复 inherited 的全局配置", exact: true })
        .click();
      await expect(row).toContainText("继承全局配置");
      await expect(row.getByRole("switch")).not.toBeChecked();
      await expect(row.getByRole("combobox")).toHaveAttribute(
        "data-value",
        peer.config.exposure ?? "codemode",
      );
      const restored = JSON.parse(
        await sdkAction<string>(page, "config.read", {
          name: "mcp.json",
          local: true,
        }),
      );
      expect(restored.metadata).toBe("project");
      expect(restored.mcpServers.inherited).toBeUndefined();
      await settings
        .getByRole("button", { name: "检查连接", exact: true })
        .click();
      await chooseMcp(page, "inherited");
      const manager = await chooseMcp(page, "enable-project");
      await mcpMenu(page, "disable");
      await sdkAction(page, "desktop.input", {
        surfaceId: manager,
        data: "\x1b",
      });
      await mcpMenu(page, "inherited");
      await sdkAction(page, "desktop.input", {
        surfaceId: manager,
        data: "\x1b",
      });
      await expect(row).toContainText("项目覆盖");
      await expect(row.getByRole("switch")).toBeChecked();
      await expect(
        row.getByRole("button", {
          name: "恢复 inherited 的全局配置",
          exact: true,
        }),
      ).toBeEnabled();
      await row
        .getByRole("button", { name: "恢复 inherited 的全局配置", exact: true })
        .click();
      await expect(row).toContainText("继承全局配置");
      expect(
        await sdkAction<string>(page, "config.read", { name: "mcp.json" }),
      ).toBe(global);
      await selectField(
        settings.getByRole("combobox", { name: "配置范围", exact: true }),
        "global",
      );
      await expect(row).toContainText("全局配置");
      await row.getByRole("switch").click();
      await expect
        .poll(
          async () =>
            JSON.parse(
              await sdkAction<string>(page, "config.read", {
                name: "mcp.json",
              }),
            ).mcpServers.inherited.enabled,
        )
        .toBeUndefined();
      const view = await sdkAction<McpSettingsSnapshot>(page, "mcp.config");
      expect(view.servers[0].config.enabled).not.toBe(false);
      await expect
        .poll(async () =>
          (
            await sdkAction<{ callableTools: string[] }>(page, "sdk.inspect")
          ).callableTools.includes("mcp__inherited__echo"),
        )
        .toBe(true);
      await settings
        .getByRole("button", { name: "关闭设置", exact: true })
        .click();
    } finally {
      await sdkAction(page, "abort");
      await sdkAction(page, "config.save", {
        name: "mcp.json",
        content: originalGlobal,
      });
      await sdkAction(page, "config.save", {
        name: "mcp.json",
        local: true,
        content: originalProject,
      });
      await peer.close();
    }
  });

  test(`native transcript top/bottom keys preserve editing and follow custom bindings at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.goto("/");
    const editor = page.getByRole("textbox", { name: "消息", exact: true });
    await editor.waitFor();
    await sdkAction(page, "session.new");
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    const keysPath = join(snapshot.agentDir, "keybindings.json");
    const originalKeys = await readFile(keysPath, "utf8");
    const path = join(snapshot.agentDir, "desktop", "pi-ui-sync.mjs");
    try {
      await sdkAction(page, "settings.save", {
        scope: "global",
        settings: { ...snapshot.globalSettings, tuiMode: "fullscreen" },
      });
      await cp(new URL("../fixtures/pi-ui-sync.mjs", import.meta.url), path);
      await sdkAction(page, "sdk.run", { path });
      await expect(page.locator(".transcript-navigation-tick")).toHaveCount(8);
      const transcript = page.locator(".transcript");
      await editor.fill("first line\nsecond line");
      const caret = () =>
        editor.evaluate((e) => (e as HTMLTextAreaElement).selectionStart);
      await editor.press("Home");
      await expect.poll(caret).toBe(11);
      await editor.press("End");
      await expect.poll(caret).toBe(22);
      await editor.press("Control+Home");
      await expect.poll(() => transcript.evaluate((e) => e.scrollTop)).toBe(0);
      await expect(transcript).toHaveAttribute("data-follow-output", "false");
      expect(await caret()).toBe(22);
      await editor.press("Control+End");
      await expect
        .poll(() =>
          transcript.evaluate(
            (e) => e.scrollHeight - e.clientHeight - e.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
      await expect(transcript).toHaveAttribute("data-follow-output", "true");
      expect(await caret()).toBe(22);
      await sdkAction(page, "sdk.run", { path, args: { action: "keys" } });
      await sdkAction(page, "resources.reload");
      await editor.press("Control+Alt+ArrowUp");
      await expect.poll(() => transcript.evaluate((e) => e.scrollTop)).toBe(0);
      await expect(transcript).toHaveAttribute("data-follow-output", "false");
      await editor.press("Control+Alt+ArrowDown");
      await expect
        .poll(() =>
          transcript.evaluate(
            (e) => e.scrollHeight - e.clientHeight - e.scrollTop,
          ),
        )
        .toBeLessThanOrEqual(1);
      await expect(transcript).toHaveAttribute("data-follow-output", "true");
      await expect(editor).toHaveValue("first line\nsecond line");
      await editor.press("Control+Home");
      await expect(transcript).toHaveAttribute("data-follow-output", "true");
      await mkdir(".local/pi-120", { recursive: true });
      await page.screenshot({
        path: `.local/pi-120/transcript-keys-${width}.png`,
      });
    } finally {
      await writeFile(keysPath, originalKeys);
      await sdkAction(page, "resources.reload");
      await sdkAction(page, "settings.save", {
        scope: "global",
        settings: snapshot.globalSettings,
      });
    }
  });
}
