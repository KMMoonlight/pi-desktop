import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "./editor-workflows.ts";
import type { DesktopSnapshot } from "../shared/types.ts";

export const projectTrustModes = [
  "extension",
  "once",
  "deny",
  "extension-dialog",
  "session-switch",
] as const;
export async function verifyProjectTrust(
  page: Page,
  mode: (typeof projectTrustModes)[number],
  screenshot?: string,
) {
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const initial = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const root = join(
    initial.agentDir,
    "desktop",
    `project-trust-${randomUUID()}`,
  );
  const cwd = join(root, "workspace");
  const loaded = join(root, "project-loaded.txt");
  const event = join(root, "event.json");
  const extension = join(
    initial.agentDir,
    "extensions",
    `project-trust-${randomUUID()}.ts`,
  );
  const module = join(root, "switch.mjs");
  const sessionPath = join(root, "target.jsonl");
  const uuid = randomUUID();
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ theme: "light" }),
  );
  await writeFile(
    join(cwd, ".pi", "extensions", "loaded.ts"),
    `import {writeFileSync} from "node:fs";
export default pi => {
  writeFileSync(${JSON.stringify(loaded)}, "loaded");
  pi.registerCommand("trusted-project-command", {handler:(_args, ctx) => ctx.ui.notify("Project command works")});
};`,
  );
  await writeFile(
    sessionPath,
    JSON.stringify({
      type: "session",
      version: 3,
      id: uuid,
      cwd,
      timestamp: new Date().toISOString(),
    }) + "\n",
  );
  await writeFile(
    module,
    `export default async ({runtime}) => runtime.switchSession(${JSON.stringify(sessionPath)});`,
  );
  await writeFile(
    extension,
    `import {writeFileSync} from "node:fs";
export default pi => {
  pi.on("project_trust", async (event, ctx) => {
    if (event.cwd !== ${JSON.stringify(cwd)}) return {trusted:"undecided"};
    writeFileSync(${JSON.stringify(event)}, JSON.stringify({cwd:ctx.cwd, mode:ctx.mode, hasUI:ctx.hasUI}));
    ${
      mode === "extension"
        ? 'ctx.ui.notify("Extension trust decision"); return {trusted:"yes"};'
        : mode === "extension-dialog"
          ? 'const passphrase = await ctx.ui.input("Trust policy input", "passphrase"); const confirmed = await ctx.ui.confirm("Trust policy confirm", passphrase); const choice = await ctx.ui.select("Trust policy choice", ["Allow", "Deny"]); return {trusted:confirmed && choice === "Allow" ? "yes" : "no"};'
          : 'return {trusted:"undecided"};'
    }
  });
  pi.registerCommand("trust-switch-command", {handler:async (_args, ctx) => ctx.switchSession(${JSON.stringify(sessionPath)})});
};`,
  );
  let pending: Promise<unknown> | undefined;
  try {
    if (mode === "session-switch") {
      await sdkAction(page, "resources.reload");
      pending = sdkAction(page, "prompt", { message: "/trust-switch-command" });
    } else pending = sdkAction(page, "initialize", { cwd });
    void pending.catch(() => {});
    const dialog = page.getByRole("dialog");
    if (mode === "extension-dialog") {
      await expect(
        dialog.getByRole("heading", {
          name: "Trust policy input",
          exact: true,
        }),
      ).toBeVisible();
      await dialog.getByRole("textbox").fill("approved project");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(
        dialog.getByRole("heading", {
          name: "Trust policy confirm",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByText("approved project", { exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(
        dialog.getByRole("heading", {
          name: "Trust policy choice",
          exact: true,
        }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Allow", exact: true }).click();
    } else if (mode !== "extension") {
      await expect(
        dialog.getByRole("button", {
          name: "Trust (this session only)",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", {
          name: "Do not trust (this session only)",
          exact: true,
        }),
      ).toBeVisible();
      if (screenshot)
        await page.screenshot({ path: screenshot, fullPage: true });
      await dialog
        .getByRole("button", {
          name:
            mode === "deny"
              ? "Do not trust (this session only)"
              : "Trust (this session only)",
          exact: true,
        })
        .click();
    }
    await pending;
    await expect
      .poll(
        async () => (await sdkAction<DesktopSnapshot>(page, "snapshot")).cwd,
      )
      .toBe(cwd);
    const snapshot = await sdkAction<DesktopSnapshot>(page, "snapshot");
    expect(snapshot.trusted).toBe(mode !== "deny");
    expect(
      snapshot.commands.some(
        (command) => command.name === "trusted-project-command",
      ),
    ).toBe(mode !== "deny");
    expect(await readFile(loaded, "utf8").catch(() => "")).toBe(
      mode === "deny" ? "" : "loaded",
    );
    expect(JSON.parse(await readFile(event, "utf8"))).toEqual({
      cwd,
      mode: "tui",
      hasUI: true,
    });
    const persisted = JSON.parse(
      await readFile(join(initial.agentDir, "trust.json"), "utf8").catch(
        () => "{}",
      ),
    );
    expect(
      Object.keys(persisted).some(
        (path) =>
          path.toLowerCase().replaceAll("\\", "/") ===
          cwd.toLowerCase().replaceAll("\\", "/"),
      ),
    ).toBe(false);
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await sdkAction(page, "session.new");
    expect((await sdkAction<DesktopSnapshot>(page, "snapshot")).trusted).toBe(
      mode !== "deny",
    );
    await expect(dialog).toBeHidden();
  } finally {
    let settled = pending === undefined;
    void pending?.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await expect
      .poll(
        async () => {
          const dialogs = await sdkAction<{ id: string }[]>(
            page,
            "dialog.list",
          );
          for (const dialog of dialogs)
            await sdkAction(page, "dialog.answer", { id: dialog.id });
          return settled;
        },
        { timeout: 5000 },
      )
      .toBe(true);
    await rm(extension, { force: true });
    await sdkAction(page, "initialize", { cwd: initial.cwd });
  }
}
