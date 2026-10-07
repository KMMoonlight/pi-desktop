import test from "node:test";
import assert from "node:assert/strict";
import { DesktopHost } from "../backend/host.ts";
import { DesktopUIRegistry } from "../backend/desktop-ui.ts";
import { loadTuiApi, type DesktopTui } from "../backend/tui-api.ts";
import type { DesktopKeyEvent, DesktopNode } from "../shared/desktop-ui.ts";
import {
  desktopKeyId,
  desktopKeyFromId,
  encodeDesktopKey,
} from "../shared/keyboard.ts";
import { createFixture } from "./fixture.ts";

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

test("phased desktop keys retain identity and modifiers in the installed Pi parser", async () => {
  const api = await loadTuiApi();
  for (const key of [
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "Insert",
    "Delete",
    "PageUp",
    "PageDown",
    "Enter",
    "Escape",
    "Tab",
    "Backspace",
    "a",
    " ",
    "/",
  ]) {
    for (let modifiers = 0; modifiers < 16; modifiers++) {
      for (const type of ["repeat", "release"] as const) {
        const event: DesktopKeyEvent = {
          key,
          type: type === "release" ? "release" : "press",
          repeat: type === "repeat",
          shiftKey: !!(modifiers & 1),
          altKey: !!(modifiers & 2),
          ctrlKey: !!(modifiers & 4),
          metaKey: !!(modifiers & 8),
        };
        const data = encodeDesktopKey(event)!;
        const id = desktopKeyId(event);
        assert.equal(
          api.isKeyRelease(data),
          type === "release",
          `${id} ${type}`,
        );
        assert.equal(api.isKeyRepeat(data), type === "repeat", `${id} ${type}`);
        assert.equal(
          api.matchesKey(data, id),
          key !== "Escape" || modifiers === 0,
          `${id} ${type}`,
        );
        assert.ok(api.parseKey(data), `${id} ${type}`);
      }
    }
  }
  assert.equal(desktopKeyFromId("insert")?.key, "Insert");
  for (const key of ["a", "A", "中", "😀"]) {
    assert.equal(
      api.decodeKittyPrintable(encodeDesktopKey({ key, repeat: true })!),
      key,
    );
  }
  for (const event of [
    { key: "A", ctrlKey: true },
    { key: "A", metaKey: true },
  ]) {
    assert.equal(
      api.matchesKey(
        encodeDesktopKey({ ...event, repeat: true })!,
        desktopKeyId(event),
      ),
      true,
    );
  }
});

test("phased function keys retain phase without inserting private-use characters", async () => {
  const api = await loadTuiApi();
  const input = new api.Input();
  for (let number = 1; number <= 12; number++) {
    const key = `F${number}`;
    assert.equal(
      api.matchesKey(encodeDesktopKey({ key })!, key.toLowerCase()),
      true,
    );
    for (const type of ["repeat", "release"] as const) {
      const data = encodeDesktopKey({
        key,
        repeat: type === "repeat",
        type: type === "release" ? "release" : "press",
      })!;
      assert.equal(api.isKeyRelease(data), type === "release");
      assert.equal(api.isKeyRepeat(data), type === "repeat");
      assert.equal(api.decodeKittyPrintable(data), undefined);
      assert.equal(api.parseKey(data), undefined);
      input.handleInput(data);
      assert.equal(input.getValue(), "");
    }
  }
});

test("component phases retain original receivers, selection, listeners, focus and retirement", async (t) => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const api = await loadTuiApi();
  try {
    await host.initialize(fixture.cwd);
    const phases: string[] = [];
    const inputs: InstanceType<typeof api.Input>[] = [];
    let tui!: DesktopTui;
    const factory = (original: DesktopTui) => {
      tui = original;
      const Container = Reflect.get(api, "Container");
      const root = new Container();
      for (let i = 0; i < 2; i++) {
        const input = new api.Input({ prompt: `Phase ${i}` });
        input.setValue(i === 0 ? "abcd" : "target");
        const handle = input.handleInput;
        input.handleInput = function (data) {
          phases.push(
            `${i}:${api.isKeyRelease(data) ? "release" : api.isKeyRepeat(data) ? "repeat" : "press"}:${data}`,
          );
          if (!api.isKeyRelease(data)) handle.call(this, data);
        };
        inputs.push(input);
        root.addChild(input);
      }
      inputs[1].wantsKeyRelease = true;
      tui.setFocus(inputs[0]);
      return root;
    };
    await host.desktopUI.mount(factory, "header", "phase-source");
    const surface = host.desktopUI.surfaces.find(
      (s) => s.id === "phase-source",
    )!;
    const controls = nodes(surface.view).filter((n) => n.kind === "input");
    assert.equal(controls.length, 2);
    const action = (controls[0] as DesktopNode & { action: string }).action;
    const send = (
      event: DesktopKeyEvent,
      extra: Record<string, unknown> = {},
    ) =>
      host.action({
        action: "desktop.input",
        args: {
          surfaceId: surface.id,
          instanceId: surface.instanceId,
          controlAction: action,
          event,
          ...extra,
        },
      });
    await t.test(
      "repeat replaces a selected range and release ignores stale browser text",
      async () => {
        await send(
          { key: "x", repeat: true },
          { controlText: "abcd", selection: { start: 1, end: 3 } },
        );
        assert.equal(inputs[0].getValue(), "axd");
        const reply = await send(
          { key: "x", type: "release" },
          { controlText: "obsolete", selection: { start: 0, end: 8 } },
        );
        assert.equal(inputs[0].getValue(), "axd");
        assert.deepEqual(reply, { consume: true });
        assert.equal(phases.length, 1);
        inputs[0].wantsKeyRelease = true;
        await send({ key: "x", type: "release" });
        assert.ok(phases.at(-1)?.startsWith("0:release:"));
      },
    );
    await t.test(
      "listeners consume, transform and redirect phases before release filtering",
      async () => {
        const remove = tui.addInputListener((data) => {
          const key = api.parseKey(data);
          if (key === "c") return { consume: true };
          if (key === "r" && api.isKeyRelease(data)) return { data: "R" };
          if (key === "s")
            return { data: encodeDesktopKey({ key: "s", type: "release" })! };
          if (key === "f") tui.setFocus(inputs[1]);
        });
        try {
          const count = phases.length;
          await send({ key: "c", type: "release" });
          assert.equal(phases.length, count);
          await send(
            { key: "r", type: "release" },
            { controlText: "obsolete", selection: { start: 0, end: 8 } },
          );
          assert.equal(inputs[0].getValue(), "axRd");
          await send({ key: "s" });
          assert.ok(phases.at(-1)?.startsWith("0:release:"));
          await send({ key: "f", type: "release" });
          assert.ok(phases.at(-1)?.startsWith("1:release:"));
          assert.equal(inputs[1].getValue(), "target");
          const clear = tui.addInputListener(() => {
            tui.setFocus(null);
            return undefined;
          });
          const last = phases.length;
          await send({ key: "f", type: "release" });
          assert.equal(phases.length, last);
          clear();
        } finally {
          remove();
        }
      },
    );
    await t.test(
      "global listeners transform release into press without stale browser snapshots",
      async () => {
        tui.setFocus(inputs[0]);
        const off = host.session.extensionRunner
          .getUIContext()
          .onTerminalInput((data) => {
            if (api.isKeyRelease(data) && api.matchesKey(data, "g"))
              return { data: "G" };
          });
        try {
          await send(
            { key: "g", type: "release" },
            { controlText: "obsolete", selection: { start: 0, end: 8 } },
          );
          assert.equal(inputs[0].getValue(), "axRGd");
          const count = phases.length;
          inputs[0].wantsKeyRelease = false;
          await host.action({
            action: "desktop.input",
            args: {
              surfaceId: surface.id,
              instanceId: surface.instanceId,
              controlAction: action,
              data: encodeDesktopKey({ key: "g", type: "release" }),
              controlText: "obsolete",
            },
          });
          assert.equal(inputs[0].getValue(), "axRGGd");
          assert.equal(phases.length, count + 1);
        } finally {
          off();
        }
      },
    );
    await t.test("retired instances reject phase events", async () => {
      const count = phases.length;
      host.desktopUI.close(surface.id);
      await send({ key: "x", type: "release" });
      assert.equal(phases.length, count);
    });
    await t.test("delegating wrappers own release opt-in", async () => {
      const body = new api.Input();
      body.wantsKeyRelease = true;
      const seen: string[] = [];
      const wrapper = {
        body,
        wantsKeyRelease: false,
        render: (width: number) => body.render(width),
        invalidate: () => body.invalidate(),
        handleInput(data: string) {
          seen.push(data);
        },
      };
      await host.desktopUI.mount(wrapper, "header", "phase-wrapper");
      const view = host.desktopUI.surfaces.find(
        (s) => s.id === "phase-wrapper",
      )!;
      const node = nodes(view.view).find(
        (n) => n.kind === "input",
      ) as DesktopNode & { action: string };
      const data = encodeDesktopKey({ key: "a", type: "release" })!;
      host.desktopUI.focus(view.id);
      await host.desktopUI.input(view.id, data, undefined, undefined, {
        controlAction: node.action,
      });
      assert.equal(seen.length, 0);
      wrapper.wantsKeyRelease = true;
      await host.desktopUI.input(view.id, data, undefined, undefined, {
        controlAction: node.action,
      });
      assert.deepEqual(seen, [data]);
      host.desktopUI.close(view.id);
    });
    await t.test(
      "desktop key-only adapters recover transformed phases",
      async () => {
        const registry = new DesktopUIRegistry(
          () => host.sdk,
          () => {},
        );
        const seen: DesktopKeyEvent[] = [];
        registry.registerAdapter({
          id: "phase-test",
          matches: () => true,
          create: () => ({
            view: () => ({ kind: "text", text: "Phase adapter" }),
            handleAction() {},
            handleKey: (event) => {
              seen.push(event);
              return true;
            },
          }),
        });
        await registry.mount({}, "header", "key-only");
        for (const event of [
          { key: "ArrowLeft", repeat: true },
          { key: "x", type: "release" as const },
        ]) {
          await registry.input("key-only", encodeDesktopKey(event)!, {
            key: "a",
          });
        }
        assert.equal(seen[0].key, "ArrowLeft");
        assert.equal(seen[0].repeat, true);
        assert.equal(seen[1].type, "release");
        registry.clearSurfaces();
      },
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
