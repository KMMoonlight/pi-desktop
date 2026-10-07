import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DesktopHost } from "../backend/host.ts";
import { createFixture } from "./fixture.ts";
import { loadTuiApi } from "../backend/tui-api.ts";

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Theme update did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("theme changes invalidate mounted and pending original component caches", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    ui.setTheme("light");
    const Text = Reflect.get(await loadTuiApi(), "Text");
    const createLabel = () => {
      const label = new Text(`${ui.theme.name}:${ui.theme.appearance}`);
      const invalidate = label.invalidate.bind(label);
      label.invalidate = () => {
        label.setText(`${ui.theme.name}:${ui.theme.appearance}`);
        invalidate();
      };
      return label;
    };
    const label = createLabel();
    await host.desktopUI.mount(() => label, "header", "theme-cache");
    ui.setTheme("dark");
    assert.ok(
      JSON.stringify(
        host.desktopUI.surfaces.find((surface) => surface.id === "theme-cache"),
      ).includes("dark:dark"),
    );
    ui.setTheme(ui.getTheme("light")!);
    assert.ok(
      JSON.stringify(
        host.desktopUI.surfaces.find((surface) => surface.id === "theme-cache"),
      ).includes("light:light"),
    );
    let resume!: () => void;
    const pendingLabel = createLabel();
    const pending = host.desktopUI.mount(
      async () => {
        await new Promise<void>((resolve) => {
          resume = resolve;
        });
        return pendingLabel;
      },
      "header",
      "pending-theme-cache",
    );
    await until(() => !!resume);
    ui.setTheme("dark");
    resume();
    await pending;
    assert.ok(
      JSON.stringify(
        host.desktopUI.surfaces.find(
          (surface) => surface.id === "pending-theme-cache",
        ),
      ).includes("dark:dark"),
    );
    ui.setTheme("system");
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.ok(
      JSON.stringify(
        host.desktopUI.surfaces.find((surface) => surface.id === "theme-cache"),
      ).includes("system:light"),
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("theme invalidation isolates callback errors and cannot remount a retired pending factory", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    ui.setTheme("light");
    const Text = Reflect.get(await loadTuiApi(), "Text");
    const failures: string[] = [];
    host.on("event", (event) => {
      if (event.type === "notice") failures.push(event.message);
    });
    const broken = new Text("Broken invalidation");
    broken.invalidate = () => {
      throw new Error("Original invalidation failure");
    };
    await host.desktopUI.mount(() => broken, "header", "broken-theme-cache");
    let ready!: () => void;
    let disposed = 0;
    const late = new Text("Pending invalidation");
    late.invalidate = () => host.desktopUI.close("retiring-theme-cache");
    late.dispose = () => {
      disposed++;
    };
    const pending = host.desktopUI.mount(
      async () => {
        await new Promise<void>((resolve) => {
          ready = resolve;
        });
        return late;
      },
      "header",
      "retiring-theme-cache",
    );
    await until(() => !!ready);
    assert.equal(ui.setTheme("dark").success, true);
    assert.deepEqual(failures, ["Original invalidation failure"]);
    ready();
    await pending;
    assert.equal(disposed, 1);
    assert.equal(
      host.desktopUI.surfaces.some(
        (surface) => surface.id === "retiring-theme-cache",
      ),
      false,
    );
    assert.equal(ui.theme.name, "dark");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("theme proxies can be reapplied before and after session replacement", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    const previous = ui.theme;
    ui.setTheme("dark");
    const colors = ui.theme.colors;
    assert.equal(ui.setTheme(previous).success, true);
    assert.equal(ui.theme.name, "dark");
    assert.equal(ui.theme.colors, colors);
    assert.equal(host.session.settingsManager.getTheme(), "dark");
    assert.equal(host.snapshot().extensionUI.theme?.followsSystem, false);
    assert.equal(
      host.sdk.sdk.getMarkdownTheme().heading("Reapplied theme"),
      ui.theme.fg("mdHeading", "Reapplied theme"),
    );
    await host.action({ action: "session.new" });
    const current = host.session.extensionRunner.getUIContext();
    current.setTheme("light");
    assert.equal(current.setTheme(previous).success, true);
    assert.equal(current.theme.name, "light");
    assert.equal(previous.name, "light");
    assert.equal(current.setTheme(current.theme).success, true);
    assert.equal(current.theme.name, "light");
    assert.equal(host.snapshot().extensionUI.theme?.name, "light");
    assert.equal(
      host.sdk.sdk.getSelectListTheme().selectedText("Replaced theme"),
      current.theme.fg("accent", "Replaced theme"),
    );
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("automatic themes follow desktop appearance without overriding named or in-memory selections", async () => {
  const fixture = await createFixture();
  const path = join(fixture.agentDir, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...settings, theme: "light/dark" }));
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    assert.equal(ui.theme.name, "dark");
    assert.equal(host.snapshot().extensionUI.theme?.followsSystem, true);
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.equal(ui.theme.name, "light");
    assert.equal(host.session.settingsManager.getThemeSetting(), "light/dark");
    assert.equal(host.session.settingsManager.getTheme(), undefined);
    assert.equal(
      host.sdk.sdk.getMarkdownTheme().heading("Auto heading"),
      ui.theme.fg("mdHeading", "Auto heading"),
    );
    ui.setTheme("dark");
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.equal(ui.theme.name, "dark");
    assert.equal(host.snapshot().extensionUI.theme?.followsSystem, false);
    ui.setTheme(ui.getTheme("light")!);
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.equal(ui.theme.name, "light");
    assert.equal(host.session.settingsManager.getTheme(), "dark");
    ui.setTheme("system");
    assert.equal(ui.theme.appearance, "dark");
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "light" },
    });
    assert.equal(ui.theme.name, "system");
    assert.equal(ui.theme.appearance, "light");
    await assert.rejects(
      host.action({
        action: "desktop.appearance",
        args: { appearance: "invalid" },
      }),
    );
    assert.equal(ui.theme.appearance, "light");
    await host.action({
      action: "settings.save",
      args: { settings: { ...settings, theme: "light/dark" } },
    });
    assert.equal(
      host.session.extensionRunner.getUIContext().theme.name,
      "light",
    );
    await host.action({
      action: "desktop.appearance",
      args: { appearance: "dark" },
    });
    assert.equal(
      host.session.extensionRunner.getUIContext().theme.name,
      "dark",
    );
    await host.action({ action: "session.new" });
    assert.equal(
      host.session.extensionRunner.getUIContext().theme.name,
      "dark",
    );
    assert.equal(host.snapshot().extensionUI.theme?.followsSystem, true);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("active theme files update live, survive atomic replacement and stop watching after selection or disposal", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const directory = join(fixture.agentDir, "themes");
  await mkdir(directory, { recursive: true });
  const theme = JSON.parse(
    await readFile(
      join(
        host.sdk.sdk.getPackageDir(),
        "dist",
        "modes",
        "interactive",
        "theme",
        "light.json",
      ),
      "utf8",
    ),
  );
  theme.name = "live-desktop-theme";
  theme.colors.accent = "#216a51";
  const path = join(directory, "different-file-name.json");
  await writeFile(path, JSON.stringify(theme));
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    assert.equal(ui.setTheme(theme.name).success, true);
    theme.colors.accent = "#944859";
    await writeFile(path, "{");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#216a51");
    await writeFile(path, JSON.stringify({ ...theme, appearance: "invalid" }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#216a51");
    assert.equal(host.snapshot().extensionUI.theme?.appearance, "light");
    await writeFile(`${path}.replacement`, JSON.stringify(theme));
    await rename(`${path}.replacement`, path);
    await until(
      () => host.snapshot().extensionUI.theme?.colors.accent === "#944859",
    );
    assert.deepEqual(ui.getTheme(theme.name)!.colors, ui.theme.colors);
    assert.equal(
      host.sdk.sdk.getSelectListTheme().selectedText("Live color"),
      ui.theme.fg("accent", "Live color"),
    );
    ui.setTheme(ui.getTheme(theme.name)!);
    theme.colors.accent = "#317399";
    await writeFile(path, JSON.stringify(theme));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#944859");
    await host.action({ action: "resources.reload" });
    await until(
      () => host.snapshot().extensionUI.theme?.colors.accent === "#317399",
    );
    ui.setTheme("dark");
    theme.colors.accent = "#7f315c";
    await writeFile(path, JSON.stringify(theme));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(ui.theme.name, "dark");
    ui.setTheme(theme.name);
    await until(
      () => host.snapshot().extensionUI.theme?.colors.accent === "#7f315c",
    );
    await host.action({ action: "session.new" });
    theme.colors.accent = "#287d45";
    await writeFile(path, JSON.stringify(theme));
    await until(
      () => host.snapshot().extensionUI.theme?.colors.accent === "#287d45",
    );
    const before = ui.theme.fg("accent", "Disposed color");
    await host.dispose();
    theme.colors.accent = "#3f518b";
    await writeFile(path, JSON.stringify(theme));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(ui.theme.fg("accent", "Disposed color"), before);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("project trust reload applies and removes project themes with their original settings", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const project = join(fixture.cwd, ".pi");
  const directory = join(project, "themes");
  await mkdir(directory, { recursive: true });
  const theme = JSON.parse(
    await readFile(
      join(
        host.sdk.sdk.getPackageDir(),
        "dist",
        "modes",
        "interactive",
        "theme",
        "light.json",
      ),
      "utf8",
    ),
  );
  theme.name = "trusted-project-theme";
  theme.colors.accent = "#287d45";
  await writeFile(join(directory, "project.json"), JSON.stringify(theme));
  await writeFile(
    join(project, "settings.json"),
    JSON.stringify({ theme: theme.name }),
  );
  new host.sdk.sdk.ProjectTrustStore(fixture.agentDir).set(fixture.cwd, false);
  try {
    await host.initialize(fixture.cwd);
    const initial = host.snapshot().extensionUI.theme?.name;
    assert.notEqual(initial, theme.name);
    await host.action({ action: "trust.set", args: { trusted: true } });
    const ui = host.session.extensionRunner.getUIContext();
    assert.equal(ui.theme.name, theme.name);
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#287d45");
    assert.equal(
      ui.getTheme(theme.name)?.sourcePath,
      join(directory, "project.json"),
    );
    await host.action({ action: "trust.set", args: { trusted: false } });
    assert.equal(ui.theme.name, initial);
    assert.equal(ui.getTheme(theme.name), undefined);
    theme.colors.accent = "#944859";
    await writeFile(join(directory, "project.json"), JSON.stringify(theme));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(ui.theme.name, initial);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("extension theme APIs include Pi built-ins and honor the saved initial theme", async () => {
  const fixture = await createFixture();
  const path = join(fixture.agentDir, "settings.json");
  const settings = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...settings, theme: "dark" }));
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    const themes = ui.getAllThemes();
    assert.equal(themes[0].name, "system");
    assert.equal(themes[0].path, undefined);
    for (const name of ["system", "light", "dark"])
      assert.equal(ui.getTheme(name)?.name, name);
    assert.equal(ui.theme.name, "dark");
    assert.equal(host.snapshot().extensionUI.theme?.name, "dark");
    assert.equal(ui.getTheme("unavailable-theme"), undefined);
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("named resource themes reload native colors and session replacement reapplies saved settings", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  const directory = join(fixture.agentDir, "themes");
  await mkdir(directory, { recursive: true });
  const theme = JSON.parse(
    await readFile(
      join(
        host.sdk.sdk.getPackageDir(),
        "dist",
        "modes",
        "interactive",
        "theme",
        "light.json",
      ),
      "utf8",
    ),
  );
  theme.name = "desktop-updatable";
  theme.colors.accent = "#216a51";
  const path = join(directory, `${theme.name}.json`);
  await writeFile(path, JSON.stringify(theme));
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    assert.equal(
      ui.getAllThemes().find((item) => item.name === theme.name)?.path,
      path,
    );
    assert.equal(ui.setTheme(theme.name).success, true);
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#216a51");
    theme.colors.accent = "#944859";
    await writeFile(path, JSON.stringify(theme));
    await host.action({ action: "resources.reload" });
    const updated = host.session.extensionRunner.getUIContext();
    assert.equal(updated.theme.name, theme.name);
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#944859");
    assert.deepEqual(
      updated.theme.colors,
      updated.getTheme(theme.name)!.colors,
    );
    assert.equal(updated.setTheme(updated.getTheme("light")!).success, true);
    assert.equal(updated.theme.name, "light");
    await host.action({ action: "session.new" });
    assert.equal(
      host.session.extensionRunner.getUIContext().theme.name,
      theme.name,
    );
    assert.equal(host.snapshot().extensionUI.theme?.colors.accent, "#944859");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});

test("theme changes preserve native helpers, named persistence and direct-instance semantics", async () => {
  const fixture = await createFixture();
  const host = new DesktopHost(fixture.agentDir);
  try {
    await host.initialize(fixture.cwd);
    const ui = host.session.extensionRunner.getUIContext();
    const markdown = host.sdk.sdk.getMarkdownTheme();
    const select = host.sdk.sdk.getSelectListTheme();
    assert.equal(ui.setTheme("dark").success, true);
    assert.equal(host.session.settingsManager.getTheme(), "dark");
    assert.equal(
      markdown.heading("Native heading"),
      ui.theme.fg("mdHeading", "Native heading"),
    );
    assert.equal(
      select.selectedText("Native option"),
      ui.theme.fg("accent", "Native option"),
    );
    const instance = ui.getTheme("light")!;
    assert.equal(ui.setTheme(instance).success, true);
    assert.equal(ui.theme.name, "light");
    assert.equal(ui.theme.colors, instance.colors);
    assert.equal(host.session.settingsManager.getTheme(), "dark");
    assert.equal(
      markdown.heading("Changed heading"),
      instance.fg("mdHeading", "Changed heading"),
    );
    await host.session.settingsManager.flush();
    assert.equal(
      JSON.parse(
        await readFile(join(fixture.agentDir, "settings.json"), "utf8"),
      ).theme,
      "dark",
    );
    assert.equal(ui.setTheme("unavailable-theme").success, false);
    assert.equal(ui.theme.name, "system");
    assert.equal(host.session.settingsManager.getTheme(), "dark");
    assert.equal(host.snapshot().extensionUI.theme?.name, "system");
  } finally {
    await host.dispose();
    await fixture.close();
  }
});
