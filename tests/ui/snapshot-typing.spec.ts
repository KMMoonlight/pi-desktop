import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sdkAction } from "../editor-workflows.ts";
import type { DesktopSnapshot } from "../../shared/types.ts";

test("typing after large tool output uses small patches, and reconnect restores a full baseline", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(editor).toBeVisible();
  await sdkAction(page, "session.new");
  const { agentDir } = await sdkAction<DesktopSnapshot>(page, "snapshot");
  const path = join(agentDir, "desktop", "large-tool-history.mjs");
  await writeFile(
    path,
    `export default ({session})=>{
    const usage={input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
    session.sessionManager.appendMessage({role:'user',content:'Large history fixture',timestamp:Date.now()});
    for(let i=0;i<16;i++){
      session.sessionManager.appendMessage({role:'assistant',content:[{type:'toolCall',id:'call-'+i,name:'read',arguments:{path:'fixture-'+i+'.txt'}}],api:'openai-completions',provider:'desktop-test',model:'desktop-test',stopReason:'toolUse',timestamp:Date.now(),usage});
      session.sessionManager.appendMessage({role:'toolResult',toolCallId:'call-'+i,toolName:'read',content:[{type:'text',text:'tool output line\\n'.repeat(5000)}],isError:false,timestamp:Date.now()});
    }
    session.sessionManager.appendMessage({role:'assistant',content:[{type:'text',text:'History restored.'}],api:'openai-completions',provider:'desktop-test',model:'desktop-test',stopReason:'stop',timestamp:Date.now(),usage});
    session.agent.state.messages=session.sessionManager.buildSessionContext().messages;
  }`,
  );
  await sdkAction(page, "sdk.run", { path });
  await expect(page.locator(".transcript")).toContainText("History restored.");
  await editor.fill("");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const snapshots: { type: string; bytes: number }[] = [];
  cdp.on("Network.eventSourceMessageReceived", (event) => {
    const { type } = JSON.parse(event.data);
    if (type === "snapshot" || type === "snapshot_patch")
      snapshots.push({ type, bytes: event.data.length });
  });
  await editor.pressSequentially("responsive input");
  await expect(editor).toHaveValue("responsive input");
  await expect
    .poll(() => snapshots.filter((s) => s.type === "snapshot_patch").length)
    .toBeGreaterThan(0);
  expect(snapshots.every((s) => s.type === "snapshot_patch")).toBe(true);
  expect(Math.max(...snapshots.map((s) => s.bytes))).toBeLessThan(100_000);
  await expect(editor).not.toHaveAttribute("data-pi-input-pending", "true");
  await expect
    .poll(
      async () =>
        (await sdkAction<DesktopSnapshot>(page, "snapshot")).editor.text,
    )
    .toBe("responsive input");
  await page.reload();
  await expect(page.locator(".transcript")).toContainText("History restored.");
  await expect(editor).toHaveValue("responsive input");
  await expect
    .poll(() => snapshots.some((s) => s.type === "snapshot"))
    .toBe(true);
  await editor.pressSequentially(" again");
  await expect(editor).toHaveValue("responsive input again");
  await cdp.detach();
});
