import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export default async function (
  { session, sdk, host },
  {
    theme,
    instance = false,
    reapply = false,
    setting,
    fileAccent,
    activateFile = false,
  } = {},
) {
  if (fileAccent) {
    const directory = join(host.agentDir, "themes");
    await mkdir(directory, { recursive: true });
    const json = JSON.parse(
      await readFile(
        join(
          sdk.getPackageDir(),
          "dist",
          "modes",
          "interactive",
          "theme",
          "light.json",
        ),
        "utf8",
      ),
    );
    json.name = "desktop-live-theme";
    json.colors.accent = fileAccent;
    await writeFile(join(directory, "desktop-live.json"), JSON.stringify(json));
    if (activateFile) {
      await host.action({ action: "resources.reload" });
      theme = json.name;
    }
  }
  if (setting !== undefined) {
    session.settingsManager.setTheme(setting);
    host.setThemeSetting(setting);
    await host.action({ action: "resources.reload" });
  }
  const ui = session.extensionRunner.getUIContext();
  let result =
    theme === undefined
      ? undefined
      : ui.setTheme(instance ? ui.getTheme(theme) : theme);
  if (reapply) result = ui.setTheme(ui.theme);
  await session.settingsManager.flush();
  return {
    result,
    themes: ui.getAllThemes(),
    current: ui.theme.name,
    saved: session.settingsManager.getTheme() ?? null,
    setting: session.settingsManager.getThemeSetting() ?? null,
    nativeHeading: sdk.getMarkdownTheme().heading("Theme probe"),
    heading: ui.theme.fg("mdHeading", "Theme probe"),
  };
}
