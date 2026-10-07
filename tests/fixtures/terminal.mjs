import { spawnSync } from "node:child_process";
import { Container, MouseRegion, Text, Input } from "@earendil-works/pi-tui";

export default function (pi) {
  let mouseState;
  pi.registerCommand("terminal-mouse-state", {
    handler: (_args, ctx) => {
      const focused = mouseState?.tui.getFocusedComponent();
      ctx.ui.setStatus("terminal-mouse-focus", JSON.stringify({
        target: focused === mouseState?.target,
        name: focused?.constructor?.name,
        input: !!focused?.handleInput,
      }));
    },
  });
  pi.registerCommand("terminal-focus-probe", {
    handler: async (_args, ctx) => {
      await ctx.ui.custom((tui, _theme, _keys, done) => {
        const terminal = {
          render: () => ["Programmatic terminal focus"],
          invalidate() {},
          handleInput: (data) => {
            ctx.ui.setStatus("terminal-focus-key", data);
            done(data);
          },
        };
        const container = new Container();
        container.addChild(new Input());
        container.addChild(terminal);
        tui.setFocus(terminal);
        return container;
      });
    },
  });
  pi.registerCommand("terminal-mouse-probe", {
    handler: async (args, ctx) => {
      const events = [];
      const record = (owner, event) => {
        events.push({ owner, ...event });
        ctx.ui.setStatus(
          "terminal-mouse-events",
          JSON.stringify(events.slice(-50)),
        );
      };
      ctx.ui.setStatus("terminal-mouse-events", "[]");
      await ctx.ui.custom((tui, _theme, _keys, done) => {
        const target = {
          render: (width) => [
            "Terminal mouse grid",
            `width=${width}`,
            "drag target",
            "last row",
          ],
          invalidate() {},
          handleMouse: (event) => {
            record("child", event);
            if (event.type === "wheel") return;
            return {
              handled: true,
              focus: event.type === "press",
              capture: event.type === "press",
              render: false,
            };
          },
          handleInput: (data) => {
            ctx.ui.setStatus("terminal-mouse-key", data);
            if (data === "\r") done("mouse-ok");
          },
        };
        mouseState = { tui, target };
        if (args.trim() !== "nested") return target;
        const container = new Container();
        container.addChild(new Text("Parent content", 0, 0));
        container.addChild(target);
        return new MouseRegion(container, (event) => {
          record("parent", event);
          return { handled: true, render: false };
        });
      });
    },
  });
  pi.registerCommand("terminal-colors-change", {
    handler: async () => {
      process.stdout.write(
        "\x1b]10;#102030\x07\x1b]11;#405060\x07\x1b]4;1;#708090\x07COLOR_THEME_CHANGED\r\n",
      );
    },
  });
  pi.registerCommand("terminal-colors-late-probe", {
    handler: async (_args, ctx) => {
      await ctx.ui.custom(async (tui, _theme, _keys, done) => {
        const partial = await tui.queryTerminalColors({
          timeoutMs: 40,
          onLateReply: (colors) => {
            ctx.ui.setStatus("terminal-colors-late", JSON.stringify(colors));
            done("late-colors");
          },
        });
        ctx.ui.setStatus("terminal-colors-partial", JSON.stringify(partial));
        return { render: () => ["Awaiting terminal reply"], invalidate() {} };
      });
    },
  });
  pi.registerCommand("terminal-colors-probe", {
    handler: async (_args, ctx) => {
      const colors = await ctx.ui.custom(async (tui, _theme, _keys, done) => {
        done(
          await Promise.all([
            tui.queryTerminalColors({ timeoutMs: 3000 }),
            tui.queryTerminalColors({ timeoutMs: 3000 }),
          ]),
        );
        return { render: () => [], invalidate() {} };
      });
      ctx.ui.setStatus("terminal-colors", JSON.stringify(colors));
    },
  });
  pi.registerCommand("terminal-cursor-probe", {
    handler: async (_args, ctx) => {
      await ctx.ui.custom((tui, _theme, _keys, done) => {
        tui.setShowHardwareCursor(true);
        return {
          render: () => [
            "cursor heading",
            "\x1b[31m\u754c\x1b[0mA\x1b_pi:c\x07tail",
          ],
          invalidate() {},
          handleInput: (data) => {
            if (data === "\r") done("cursor-ok");
          },
        };
      });
    },
  });
  pi.registerCommand("terminal-probe", {
    handler: async (_args, ctx) => {
      const value = await ctx.ui.custom((tui, _theme, _keys, done) => {
        tui.stop();
        const result = spawnSync(
          process.execPath,
          [
            "-e",
            `
          process.stdin.setRawMode(true);
          process.stdout.write("\\x1b[32mPTY_READY:" + JSON.stringify({input:process.stdin.isTTY,output:process.stdout.isTTY,cols:process.stdout.columns,rows:process.stdout.rows}) + "\\x1b[0m\\r\\n");
          process.stdout.write("PTY_CWD:" + process.cwd() + "\\r\\n");
          process.stdin.once("data", data => {
            process.stdout.write("PTY_INPUT:" + data.toString("hex") + "\\r\\n");
            process.exit(data[0] === 3 ? 130 : 7);
          });
          process.stdin.resume();
        `,
          ],
          { stdio: "inherit", timeout: 15000 },
        );
        tui.start();
        done(result.status);
        return { render: () => [], invalidate() {} };
      });
      ctx.ui.setStatus("pty-result", "PTY_EXIT:" + value);
    },
  });
  pi.registerCommand("raw-terminal-probe", {
    handler: async (_args, ctx) => {
      const value = await ctx.ui.custom((tui, _theme, _keys, done) => {
        tui.terminal.start(
          (data) => {
            if (data.includes("z")) {
              tui.terminal.stop();
              done("RAW_OK");
            }
          },
          () => {},
        );
        tui.terminal.clearScreen();
        tui.terminal.write("RAW_READY\r\n");
        return { render: () => [], invalidate() {} };
      });
      ctx.ui.setStatus("raw-result", value);
    },
  });
}
