import { loadTuiApi } from "./tui-api.ts";
import type { AutocompleteProviderFactory } from "@earendil-works/pi-coding-agent";

export type DesktopAutocompleteProvider =
  Parameters<AutocompleteProviderFactory>[0];
type Commands = {
  name: string;
  description?: string;
  getArgumentCompletions?: (...args: never[]) => unknown;
}[];

export async function createDesktopAutocomplete(
  commands: Commands,
  cwd: string,
  fdPath?: string,
): Promise<DesktopAutocompleteProvider> {
  return (
    await createDesktopAutocompleteFactory(() => commands, cwd, fdPath)
  )();
}

export async function createDesktopAutocompleteFactory(
  commands: () => Commands,
  cwd: string,
  fdPath?: string,
): Promise<() => DesktopAutocompleteProvider> {
  const tui = await loadTuiApi();
  // Reuse Pi's public completion engine; no terminal is created or started.
  return () =>
    new tui.CombinedAutocompleteProvider(commands(), cwd, fdPath ?? null);
}
