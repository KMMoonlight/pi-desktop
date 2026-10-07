import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import type { DesktopInputResult } from "../shared/desktop-ui.ts";

test("standard editor submission follows Pi whitespace and backslash Enter rules", async () => {
  for (const remapped of [false, true]) {
    const fixture = await createFixture();
    if (remapped)
      await writeFile(
        join(fixture.agentDir, "keybindings.json"),
        JSON.stringify({
          "tui.input.submit": "shift+enter",
          "tui.input.newLine": "enter",
        }),
      );
    const host = new DesktopHost(fixture.agentDir);
    try {
      await host.initialize(fixture.cwd);
      const ui = host.session.extensionRunner.getUIContext();
      const send = (
        id: string,
        data: string,
        controlText: string,
        start = controlText.length,
        end = start,
      ) =>
        host.action({
          action: "desktop.input",
          args: {
            dialogId: id,
            dialogTarget: "text",
            data,
            controlText,
            selection: { start, end },
          },
        }) as Promise<DesktopInputResult>;
      const submitted = ui.editor("Trim");
      await send(
        host.pendingDialogs[0].id,
        remapped ? "\x1b[13;2u" : "\r",
        "  first\nsecond \n",
      );
      assert.equal(await submitted, "first\nsecond");
      const slash = ui.editor("Backslash");
      const id = host.pendingDialogs[0].id;
      const result = await send(id, "\r", "one\\tail", 4);
      if (remapped) {
        assert.equal(host.pendingDialogs.length, 0);
        assert.equal(await slash, "onetail");
      } else {
        assert.equal(host.pendingDialogs.length, 1);
        assert.deepEqual(result.editor, {
          text: "one\ntail",
          selection: { start: 4, end: 4 },
        });
        await send(id, "\r", result.editor!.text);
        assert.equal(await slash, "one\ntail");
      }
      const selected = ui.editor("Selected newline");
      const selectedId = host.pendingDialogs[0].id;
      const newline = await send(
        selectedId,
        remapped ? "\r" : "\x1b[13;2u",
        "before OLD after",
        7,
        10,
      );
      assert.deepEqual(newline.editor, {
        text: "before \n after",
        selection: { start: 8, end: 8 },
      });
      host.answer(selectedId, undefined);
      assert.equal(await selected, undefined);
      const button = ui.editor("Button");
      await host.action({
        action: "dialog.answer",
        args: { id: host.pendingDialogs[0].id, value: "  accepted \n" },
      });
      assert.equal(await button, "accepted");
    } finally {
      await host.dispose();
      await fixture.close();
    }
  }
});

test("dialog paste streams retain partial terminators, wrapper keys and trailing submission", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    for (const kind of ["input", "editor"] as const) {
      const answer =
        kind === "input" ? ui.input("Stream") : ui.editor("Stream");
      const id = host.pendingDialogs[0].id;
      const send = (data: string, controlText = "before OLD after") =>
        host.action({
          action: "desktop.input",
          args: {
            dialogId: id,
            dialogTarget: "text",
            data,
            controlText,
            selection: { start: 7, end: 10 },
          },
        }) as Promise<DesktopInputResult>;
      const opened = await send("\x1b[200~A");
      assert.equal(opened.consume, true);
      assert.equal(opened.editor, undefined);
      await send("\tB");
      if (kind === "editor") {
        await send("\r");
        assert.equal(host.pendingDialogs.length, 1);
      }
      const partial = await send("C\x1b[20");
      assert.equal(partial.consume, true);
      assert.equal(partial.editor, undefined);
      const completed = await send("1~");
      const expected =
        kind === "input" ? "before A    BC after" : "before A    B\nC after";
      assert.equal(completed.editor?.text, expected);
      await send("\r", expected);
      assert.equal(await answer, expected);
      assert.deepEqual(await send("\x1b[201~"), { consume: true });
    }
    for (const value of ["done", ""]) {
      const submitted = ui.editor("Trailing submit");
      await host.action({
        action: "desktop.input",
        args: {
          dialogId: host.pendingDialogs[0].id,
          dialogTarget: "text",
          controlText: "",
          selection: { start: 0, end: 0 },
          data: `\x1b[200~${value}\x1b[201~\r`,
        },
      });
      assert.equal(host.pendingDialogs.length, 0);
      assert.equal(await submitted, value);
    }
    const canceled = ui.editor("Cancel stream");
    const id = host.pendingDialogs[0].id;
    for (const data of ["\x1b[200~pending", "\x1b"])
      await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlText: "original",
          data,
        },
      });
    assert.equal(await canceled, undefined);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("standard dialogs paste through Pi normalization and retain expanded answers", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    for (const kind of ["input", "editor"] as const) {
      const answer = kind === "input" ? ui.input("Paste") : ui.editor("Paste");
      const id = host.pendingDialogs[0].id;
      const result = (await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlText: "before OLD after",
          selection: { start: 7, end: 10 },
          data: "\x1b[200~A\tB\r\nC\x1b[201~",
        },
      })) as DesktopInputResult;
      const inserted = kind === "input" ? "A    BC" : "A    B\nC";
      assert.deepEqual(result.editor, {
        text: `before ${inserted} after`,
        selection: { start: 7 + inserted.length, end: 7 + inserted.length },
      });
      const large = "row\tvalue\r\n".repeat(12);
      const pasted = (await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlText: "prefix suffix",
          selection: { start: 7, end: 7 },
          data: `\x1b[200~${large}\x1b[201~`,
        },
      })) as DesktopInputResult;
      const normalized =
        kind === "input"
          ? "row    value".repeat(12)
          : "row    value\n".repeat(12);
      assert.equal(pasted.editor?.text, `prefix ${normalized}suffix`);
      assert.deepEqual(pasted.editor?.selection, {
        start: 7 + normalized.length,
        end: 7 + normalized.length,
      });
      const stop = ui.onTerminalInput((data) =>
        data.includes("replace-paste")
          ? { data: "\x1b[200~changed\tvalue\x1b[201~" }
          : data.includes("consume-paste")
            ? { consume: true }
            : undefined,
      );
      const transformed = (await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlText: "old",
          selection: { start: 0, end: 3 },
          data: "\x1b[200~replace-paste\x1b[201~",
        },
      })) as DesktopInputResult;
      assert.equal(transformed.editor?.text, "changed    value");
      assert.deepEqual(
        await host.action({
          action: "desktop.input",
          args: {
            dialogId: id,
            dialogTarget: "text",
            controlText: "old",
            selection: { start: 0, end: 3 },
            data: "\x1b[200~consume-paste\x1b[201~",
          },
        }),
        { consume: true },
      );
      stop();
      if (kind === "editor") {
        const filtered = (await host.action({
          action: "desktop.input",
          args: {
            dialogId: id,
            dialogTarget: "text",
            controlText: "",
            selection: { start: 0, end: 0 },
            data: "\x1b[200~A\x00B\x1b[106;5uC\x1b[201~",
          },
        })) as DesktopInputResult;
        assert.equal(filtered.editor?.text, "AB\nC");
      }
      await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlText: pasted.editor!.text,
          data: "\r",
        },
      });
      assert.equal(await answer, `prefix ${normalized}suffix`);
    }
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("standard text dialogs retain Pi kill ring commands and isolate dialog state", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.agentDir, "keybindings.json"),
    JSON.stringify({ "tui.editor.deleteToLineEnd": "ctrl+l" }),
  );
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    const answer = ui.editor("Commands", "alpha beta\ngamma");
    const id = host.pendingDialogs[0].id;
    assert.deepEqual(
      await host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "text",
          controlReadOnly: true,
          controlText: "locked",
          selection: { start: 0, end: 0 },
          data: "\x0c",
        },
      }),
      { consume: true },
    );
    const send = (
      dialogId: string,
      data: string,
      controlText: string,
      start: number,
      end = start,
    ) =>
      host.action({
        action: "desktop.input",
        args: {
          dialogId,
          dialogTarget: "text",
          data,
          controlText,
          selection: { start, end },
        },
      }) as Promise<DesktopInputResult>;
    const killed = await send(id, "\x0c", "alpha beta\ngamma", 6);
    assert.equal(killed.consume, true);
    assert.deepEqual(killed.editor, {
      text: "alpha \ngamma",
      selection: { start: 6, end: 6 },
    });
    const restored = await send(id, "\x19", killed.editor!.text, 6);
    assert.deepEqual(restored.editor, {
      text: "alpha beta\ngamma",
      selection: { start: 10, end: 10 },
    });
    // Native selected deletion and undo use the desktop's existing transactions.
    const deletion = await send(id, "\x7f", "alpha beta", 0, 5);
    assert.equal(deletion.consume, false);
    assert.equal(deletion.data, "\x7f");
    const undo = await send(id, "\x1f", "alpha beta", 5);
    assert.equal(undo.consume, false);
    assert.equal(undo.data, "\x1a");
    host.answer(id, restored.editor!.text);
    assert.equal(await answer, "alpha beta\ngamma");
    assert.deepEqual(await send(id, "\x19", "stale", 5), { consume: true });
    const fresh = ui.editor("Fresh", "fresh");
    const freshId = host.pendingDialogs[0].id;
    const emptyRing = await send(freshId, "\x19", "fresh", 5);
    assert.equal(emptyRing.editor?.text, "fresh");
    host.answer(freshId, undefined);
    assert.equal(await fresh, undefined);
    const single = ui.input("Single-line commands");
    const singleId = host.pendingDialogs[0].id;
    const stop = ui.onTerminalInput((data) =>
      data === "K" ? { data: "\x0c" } : undefined,
    );
    const singleKill = await send(singleId, "K", "one two", 4);
    stop();
    assert.deepEqual(singleKill.editor, {
      text: "one ",
      selection: { start: 4, end: 4 },
    });
    const singleYank = await send(singleId, "\x19", "one ", 4);
    assert.deepEqual(singleYank.editor, {
      text: "one two",
      selection: { start: 7, end: 7 },
    });
    await send(singleId, "\r", singleYank.editor!.text, 7);
    assert.equal(await single, "one two");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("dialog keyboard honors configured Pi keys, input listeners and original answers", async () => {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.agentDir, "keybindings.json"),
    JSON.stringify({
      "tui.select.confirm": "ctrl+y",
      "tui.select.cancel": "ctrl+q",
      "tui.select.down": "ctrl+n",
      "tui.select.up": "ctrl+p",
      "tui.input.submit": "ctrl+s",
      "tui.input.newLine": "ctrl+j",
      "app.editor.external": "ctrl+e",
      "app.tools.expand": "ctrl+t",
    }),
  );
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    const selected = ui.select("Selection", ["first", "second"]);
    const id = host.pendingDialogs[0].id;
    const send = (data: string, extra = {}) =>
      host.action({
        action: "desktop.input",
        args: {
          dialogId: id,
          dialogTarget: "option",
          dialogIndex: 0,
          data,
          ...extra,
        },
      });
    assert.deepEqual(await send("\x0e"), {
      consume: true,
      dialogFocus: 1,
    });
    await send("\r");
    assert.equal(host.pendingDialogs.length, 1);
    assert.deepEqual(await send("\x1b", { dialogTarget: "native" }), {
      consume: true,
      dialogFocus: undefined,
    });
    assert.equal(host.pendingDialogs.length, 1);
    const stop = ui.onTerminalInput((data) =>
      data === "\x19" ? { consume: true } : undefined,
    );
    await send("\x19");
    assert.equal(host.pendingDialogs.length, 1);
    stop();
    const transform = ui.onTerminalInput((data) =>
      data === "x" ? { data: "\x19" } : undefined,
    );
    await send("x", { dialogIndex: 1 });
    assert.equal(await selected, "second");
    transform();
    const confirmation = ui.confirm("Confirm", "Choose");
    const confirmationId = host.pendingDialogs[0].id;
    const confirmKey = (data: string, index = 0) =>
      host.action({
        action: "desktop.input",
        args: {
          dialogId: confirmationId,
          dialogTarget: "option",
          dialogIndex: index,
          data,
        },
      });
    const expanded = ui.getToolsExpanded();
    await confirmKey("\x14");
    assert.equal(ui.getToolsExpanded(), !expanded);
    assert.equal(host.pendingDialogs.length, 1);
    assert.deepEqual(await confirmKey("\x0e"), {
      consume: true,
      dialogFocus: 1,
    });
    await confirmKey("\x19", 1);
    assert.equal(await confirmation, false);
    const accepted = ui.confirm("Accept", "Choose");
    await host.action({
      action: "desktop.input",
      args: {
        dialogId: host.pendingDialogs[0].id,
        dialogTarget: "option",
        dialogIndex: 0,
        data: "\x19",
      },
    });
    assert.equal(await accepted, true);
    const editor = ui.editor("Editor", "draft");
    const editorId = host.pendingDialogs[0].id;
    const editorKey = (data: string) =>
      host.action({
        action: "desktop.input",
        args: {
          dialogId: editorId,
          dialogTarget: "text",
          controlText: "final\ntext",
          data,
        },
      });
    assert.deepEqual(await editorKey("\x05"), {
      consume: true,
      dialogFocus: undefined,
      dialogExternal: true,
    });
    const newline = (await editorKey("\n")) as DesktopInputResult;
    assert.equal(newline.consume, true);
    assert.deepEqual(newline.editor, {
      text: "final\ntext\n",
      selection: { start: 11, end: 11 },
    });
    await editorKey("\x13");
    assert.equal(await editor, "final\ntext");
    const canceled = ui.input("Cancel");
    await host.action({
      action: "desktop.input",
      args: {
        dialogId: host.pendingDialogs[0].id,
        dialogTarget: "text",
        data: "\x11",
      },
    });
    assert.equal(await canceled, undefined);
    assert.deepEqual(await editorKey("\x13"), { consume: true });
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
