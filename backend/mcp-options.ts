import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getPackageDir,
  VERSION,
  type createMcpExtension,
} from "@earendil-works/pi-coding-agent";

type McpOptions = NonNullable<Parameters<typeof createMcpExtension>[0]>;
interface McpModules {
  loadMcpConfig(options: {
    agentDir: string;
    cwd: string;
    projectTrusted: boolean;
  }): ReturnType<NonNullable<McpOptions["loadConfig"]>>;
  FileAuthStorageBackend: new (path: string) => object;
  McpOAuthCredentialStore: new (
    backend: object,
    lockDir: string,
  ) => NonNullable<McpOptions["credentials"]>;
}
let modules: Promise<McpModules> | undefined;

/** Pi's public injection hooks, backed by its original config and credential implementations. */
export async function desktopMcpOptions(
  agentDir: string,
  openUrl: NonNullable<McpOptions["openUrl"]>,
  captureCompletion?: () => () => void,
): Promise<McpOptions> {
  if (VERSION !== "1.0.0")
    throw new Error(
      `Pi ${VERSION}: MCP directory binding requires a compatibility update`,
    );
  modules ??= (async () => {
    const load = (path: string) =>
      import(pathToFileURL(join(getPackageDir(), "dist", path)).href);
    const [config, oauth, auth] = await Promise.all([
      load("extensions/mcp/config.js"),
      load("extensions/mcp/oauth.js"),
      load("core/auth-storage.js"),
    ]);
    return {
      loadMcpConfig: config.loadMcpConfig,
      McpOAuthCredentialStore: oauth.McpOAuthCredentialStore,
      FileAuthStorageBackend: auth.FileAuthStorageBackend,
    };
  })();
  const api = await modules;
  class DesktopCredentials extends api.McpOAuthCredentialStore {
    override forServer(name: string, serverUrl: string) {
      const store = super.forServer(name, serverUrl);
      const loadedTokens = new WeakSet<object>();
      return {
        ...store,
        load: async () => {
          const state = await store.load();
          if (state?.tokens) loadedTokens.add(state.tokens);
          return state;
        },
        save: async (state: Parameters<typeof store.save>[0]) => {
          const complete = captureCompletion?.();
          // Pi 1.0.0 preserves the loaded token object in metadata updates and
          // replaces it in saveTokens(), even when a grant repeats its values.
          // Observe that replacement without changing stored state or Pi code.
          const issuedTokens = state.tokens && !loadedTokens.has(state.tokens);
          await store.save(state);
          if (issuedTokens) complete?.();
        },
      };
    }
  }
  return {
    loadConfig: (ctx) =>
      api.loadMcpConfig({
        agentDir,
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
      }),
    credentials: new DesktopCredentials(
      new api.FileAuthStorageBackend(join(agentDir, "mcp-auth.json")),
      agentDir,
    ),
    logPath: join(agentDir, "mcp.log"),
    openUrl,
  };
}
