import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createFixture } from "./fixture.ts";
import { createMcpHttpFixture } from "./mcp-http-fixture.ts";
import { createMcpOAuthFixture } from "./mcp-oauth-fixture.ts";
import { verifySdkAuth } from "./auth-workflows.ts";
import { verifySdkTransport } from "./sdk-transport-workflows.ts";
import { verifySdkResources } from "./sdk-resources-workflows.ts";
import { verifySdkPackageNetwork } from "./sdk-package-network-workflows.ts";
import { verifySdkPackageEnvironment } from "./sdk-package-environment-workflows.ts";
import {
  projectTrustModes,
  verifyProjectTrust,
} from "./project-trust-workflows.ts";
import { awaitSdkDrainFile, startSdkDrain } from "./sdk-drain-workflows.ts";
import {
  runtimeCallbackModes,
  verifyRuntimeCallbacks,
} from "./runtime-callbacks-workflows.ts";
import {
  sdkLifecycleModes,
  verifySdkLifecycle,
} from "./sdk-lifecycle-workflows.ts";
import { verifySelectionShortcuts } from "./selection-shortcut-workflows.ts";
import {
  applicationModes,
  verifyApplicationComponents,
} from "./application-components-workflows.ts";
import {
  nativeExecutionModes,
  verifyNativeExecution,
} from "./native-execution-workflows.ts";
import { verifyDialogText, verifyDialogTimeout } from "./dialog-workflows.ts";
import {
  continuityModes,
  continuityTransitions,
  verifyRuntimeContinuity,
} from "./runtime-continuity-workflows.ts";
import { verifyDialogKeyboard } from "./dialog-keyboard-workflow.ts";
import {
  rendererModes,
  verifyRendererModes,
} from "./renderer-modes-workflows.ts";
import {
  conversationNoticeModes,
  verifyConversationNotices,
} from "./conversation-notices-workflows.ts";
import { verifyDialogPaste } from "./dialog-paste-workflow.ts";
import {
  applicationContentModes,
  verifyApplicationContent,
} from "./application-content-workflows.ts";
import { verifyDialogSubmission } from "./dialog-submit-workflow.ts";
import { startupModes, verifyStartup } from "./startup-workflows.ts";
import {
  invocationModes,
  verifyInvocationOptions,
} from "./invocation-options-workflows.ts";
import {
  startupPolicyModes,
  verifyStartupPolicy,
} from "./startup-policy-workflows.ts";
import {
  managedToolModes,
  verifyManagedTools,
} from "./managed-tools-workflows.ts";
import { verifyDialogOrder } from "./dialog-order-workflow.ts";
import {
  verifyThinkingLabel,
  verifyWorkingIndicator,
} from "./message-presentation-workflows.ts";
import { verifyControlText } from "./control-text-workflows.ts";
import { verifyScrollbars } from "./scrollbar-workflows.ts";
import {
  verifyNativeProtocolLaunch,
  verifyNativeFileAssociationLaunch,
} from "./protocol-launch.ts";
import { verifyStackSizes } from "./stack-size-workflows.ts";
import { verifyEditorConfig } from "./editor-config-workflows.ts";
import { verifyComponentDelegation } from "./component-delegation-workflows.ts";
import { verifyDelegatedRender } from "./delegated-render-workflows.ts";
import { verifyComponentAppearance } from "./component-appearance-workflows.ts";
import { verifyComponentCleanup } from "./component-cleanup-workflows.ts";
import {
  disposalModes,
  verifyComponentDisposal,
} from "./component-disposal-workflows.ts";
import {
  remountModes,
  verifyComponentRemount,
} from "./component-remount-workflows.ts";
import { verifyComponentInvalidation } from "./component-invalidate-workflows.ts";
import {
  registrationModes,
  verifyComponentRegistration,
} from "./component-registration-workflows.ts";
import { verifyComponentFocus } from "./component-focus-workflows.ts";
import { verifyComponentListeners } from "./component-listener-workflows.ts";
import {
  terminalInputModes,
  verifyTerminalInput,
} from "./terminal-input-workflows.ts";
import {
  terminalStateModes,
  verifySharedTerminalPresentation,
} from "./terminal-shared-presentation-workflows.ts";
import {
  sharedTuiModes,
  verifySharedTui,
} from "./terminal-runtime-workflows.ts";
import {
  keyboardPhaseModes,
  verifyKeyboardPhases,
} from "./keyboard-phase-workflows.ts";
import { verifyComponentLifecycle } from "./component-lifecycle-workflows.ts";
import {
  customCloseModes,
  verifyCustomCloseOrder,
} from "./custom-close-order-workflows.ts";
import {
  overlayLifecycleModes,
  verifyOverlayLifecycle,
} from "./overlay-lifecycle-workflows.ts";
import { verifyTerminal } from "./terminal-workflows.ts";
import { verifyNativeDesktopWorkspace } from "./desktop-workspace-workflows.ts";
import { verifyTerminalEffects } from "./terminal-effects-workflows.ts";
import { verifyTranscriptMarkdown } from "./transcript-markdown-workflows.ts";
import { verifyTranscriptLayout } from "./transcript-layout-workflows.ts";
import { verifyTranscriptPolicy } from "./transcript-policy-workflows.ts";
import { verifyToolContext } from "./tool-context-workflows.ts";
import { verifyToolShell } from "./tool-shell-workflows.ts";
import { verifyToolDisplay } from "./tool-display-workflows.ts";
import { verifyTranscriptRenderers } from "./transcript-renderer-workflows.ts";
import { verifyTerminalDescendant } from "./terminal-descendant-workflows.ts";
import {
  verifyCompositeFocus,
  verifyTerminalTransition,
} from "./terminal-transition-workflows.ts";
import {
  verifyRenderAdditions,
  verifyStandardRenderAdditions,
  verifyPassiveRenderReplacement,
  verifyEmptyRender,
  verifyRenderBaseline,
  verifyContainerRender,
} from "./render-additions-workflows.ts";
import { verifyComponentAuthority } from "./component-authority-workflows.ts";
import { verifyInteractiveRender } from "./interactive-render-workflows.ts";
import { verifyListRender } from "./list-render-workflows.ts";
import { verifyNestedFrame } from "./nested-frame-workflows.ts";
import { verifyHorizontalGaps } from "./horizontal-gap-workflows.ts";
import { verifyHorizontalTransforms } from "./horizontal-transform-workflows.ts";
import { verifyLayoutOrder } from "./layout-order-workflows.ts";
import {
  verifyFileLinks,
  verifyNativeFileLinkLaunch,
} from "./file-link-workflows.ts";
import {
  verifyDesktopLinks,
  verifyNativeLinkLaunch,
} from "./link-workflows.ts";
import { verifyPointerReplacement } from "./pointer-replacement-workflows.ts";
import { verifyComponentImage } from "./component-image-workflows.ts";
import { verifyRichControls } from "./rich-control-workflows.ts";
import {
  verifySdkThemes,
  verifySystemThemes,
  verifyThemeInvalidation,
} from "./theme-workflows.ts";
import {
  verifyEditorNavigation,
  verifyEditorResize,
  verifyEditorBidi,
} from "./editor-navigation-workflows.ts";
import { verifyMultilineReplacement } from "./input-replacement-workflows.ts";
import {
  verifyComponentText,
  verifyComponentMarkdown,
  verifyTextSurfaces,
} from "./component-text-workflows.ts";
import {
  verifyComponentMapping,
  verifyComponentOverlays,
  verifyMappedEditorTransactions,
  verifyMappedPasteBlocks,
  verifyMappedComposition,
  verifyComponentWindow,
} from "./component-workflows.ts";
import {
  sdkAction,
  verifyModalEditor,
  verifyDefaultEditor,
} from "./editor-workflows.ts";

const fixture = await createFixture({
  officialQuestions: true,
  officialWorkflows: ["todo", "qna", "message-renderer"],
  extractionDelayMs: 1200,
  componentLibrary: true,
  transcriptPolicy: process.argv.includes("--transcript-policy"),
  toolContext: process.argv.includes("--tool-context"),
  toolShell: process.argv.includes("--tool-shell"),
  toolDisplay:
    process.argv.includes("--tool-display") ||
    process.argv.includes("--native-execution"),
  transcriptRenderers: process.argv.includes("--transcript-renderer"),
  transcriptMarkdown:
    process.argv.includes("--transcript-markdown") ||
    process.argv.includes("--transcript-layout"),
  terminalSupport:
    process.argv.includes("--terminal") ||
    process.argv.includes("--terminal-effects"),
  modelTools:
    process.argv.includes("--mcp") || process.argv.includes("--mcp-oauth")
      ? {
          "mcp-echo": {
            name: "mcp__local_http__echo",
            args: { text: "Native MCP" },
          },
        }
      : undefined,
});
let rejectNativeToken = false;
const oauthPeer = process.argv.includes("--mcp-oauth")
  ? await createMcpOAuthFixture({
      stableTokens: process.argv.includes("--mcp-identical-token"),
      beforeTokenResponse: async () => {
        if (rejectNativeToken)
          throw new Error("Fixture token exchange rejected");
      },
    })
  : undefined;
const mcpPeer =
  oauthPeer ??
  (process.argv.includes("--mcp") ? await createMcpHttpFixture() : undefined);
if (mcpPeer)
  await writeFile(
    join(fixture.agentDir, "mcp.json"),
    JSON.stringify({ mcpServers: { local_http: mcpPeer.config } }),
  );
const tracePath = join(fixture.root, "native-actions.jsonl");
const startupTrust = process.argv.includes("--project-trust-startup");
const closeStartupTrust = process.argv.includes("--project-trust-close");
const startupTrustMarker = join(fixture.root, "startup-project-loaded.txt");
if (startupTrust || closeStartupTrust) {
  await mkdir(join(fixture.cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(join(fixture.cwd, ".pi", "settings.json"), "{}");
  await writeFile(
    join(fixture.cwd, ".pi", "extensions", "project-marker.ts"),
    `import {writeFileSync} from "node:fs";
export default () => writeFileSync(${JSON.stringify(startupTrustMarker)}, "loaded");`,
  );
}
const shutdownMarker = join(fixture.root, "native-shutdown.txt");
const shutdownFromTransport = process.argv.includes("--sdk-shutdown-overlap");
const shutdownFromWindow = process.argv.includes("--sdk-shutdown-window");
const testShutdown =
  process.argv.includes("--sdk-shutdown") ||
  process.argv.includes("--sdk-drain") ||
  shutdownFromTransport ||
  shutdownFromWindow;
if (testShutdown)
  await writeFile(
    join(fixture.agentDir, "extensions", "shutdown-probe.ts"),
    `
import { appendFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
export default function(pi) {
  writeSync(1, JSON.stringify({ event: { type: "shutdown" } }) + "\\nraw output");
  spawnSync(process.execPath, ["-e", "process.stdout.write('inherited output')"], { stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  pi.on("session_shutdown", async (_event, ctx) => {
    ${shutdownFromTransport ? "ctx.shutdown();" : ""}
    ${shutdownFromWindow ? `await appendFile(${JSON.stringify(shutdownMarker)}, "started\\n");` : ""}
    await new Promise(resolve => setTimeout(resolve, ${shutdownFromWindow ? 4500 : 30}));
    await appendFile(${JSON.stringify(shutdownMarker)}, "quit\\n");
  });
  pi.registerCommand("quit-probe", { handler: (_args, ctx) => {
    ctx.shutdown();
    ctx.shutdown();
  }});
}`,
  );
const traceModule = join(fixture.agentDir, "desktop", "native-qa.mjs");
await writeFile(
  traceModule,
  `import { appendFileSync } from "node:fs";
export default function ({ host }, { path }) {
  const action = host.action.bind(host);
  host.action = (request) => {
    if (["desktop.action", "desktop.close", "prompt", "abort"].includes(request.action) || (request.action === "desktop.input" && request.args?.event?.key?.toLowerCase() === "d" && request.args?.event?.ctrlKey))
      appendFileSync(path, JSON.stringify(request) + "\\n");
    return action(request).catch((error) => {
      appendFileSync(path, JSON.stringify({ failed: request, error: error.message }) + "\\n");
      throw error;
    });
  };
}`,
);
const cleanupProfile = process.argv.includes("--cleanup-profile");
const executable = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
    "src-tauri/target/release/pi-agent-desktop.exe",
);
const child = spawn(executable, [], {
  windowsHide: true,
  cwd: resolve("src-tauri/target/release"),
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: fixture.agentDir,
    PI_DESKTOP_AGENT_DIR: fixture.agentDir,
    PI_DESKTOP_LEGACY_EXAMPLE_ADAPTERS:
      process.argv.includes("--mapped-components") ||
      process.argv.includes("--mapped-completion") ||
      process.argv.includes("--application-components") ||
      process.argv.includes("--native-execution") ||
      process.argv.includes("--runtime-continuity") ||
      process.argv.includes("--renderer-modes") ||
      process.argv.includes("--conversation-notices") ||
      process.argv.includes("--application-content") ||
      process.argv.includes("--managed-tools") ||
      process.argv.includes("--startup") ||
      process.argv.includes("--startup-policy") ||
      process.argv.includes("--invocation-options") ||
      process.argv.includes("--render-additions") ||
      process.argv.includes("--render-baseline") ||
      process.argv.includes("--container-render") ||
      process.argv.includes("--interactive-render") ||
      process.argv.includes("--list-render") ||
      process.argv.includes("--nested-frame") ||
      process.argv.includes("--recursive-frame") ||
      process.argv.includes("--layout-frame") ||
      process.argv.includes("--horizontal-gaps") ||
      process.argv.includes("--horizontal-frame") ||
      process.argv.includes("--horizontal-transform") ||
      process.argv.includes("--horizontal-height") ||
      process.argv.includes("--component-authority") ||
      process.argv.includes("--layout-order") ||
      process.argv.includes("--pointer-replacement") ||
      process.argv.includes("--scrollbars") ||
      process.argv.includes("--stack-sizes") ||
      process.argv.includes("--editor-config") ||
      process.argv.includes("--default-editor") ||
      process.argv.includes("--component-delegation") ||
      process.argv.includes("--delegated-render") ||
      process.argv.includes("--delegated-collections") ||
      process.argv.includes("--component-appearance") ||
      process.argv.includes("--component-cleanup") ||
      process.argv.includes("--component-disposal") ||
      process.argv.includes("--component-remount") ||
      process.argv.includes("--custom-close-order") ||
      process.argv.includes("--overlay-lifecycle") ||
      process.argv.includes("--component-invalidate") ||
      process.argv.includes("--component-registration") ||
      process.argv.includes("--component-focus") ||
      process.argv.includes("--component-listeners") ||
      process.argv.includes("--terminal-input") ||
      process.argv.includes("--terminal-state") ||
      process.argv.includes("--shared-tui") ||
      process.argv.includes("--keyboard-phases") ||
      process.argv.includes("--component-lifecycle") ||
      process.argv.includes("--terminal-descendant") ||
      process.argv.includes("--terminal-transition") ||
      process.argv.includes("--terminal-effects") ||
      testShutdown ||
      process.argv.includes("--links") ||
      process.argv.includes("--file-links") ||
      process.argv.includes("--file-association") ||
      process.argv.includes("--sdk-reload") ||
      process.argv.includes("--sdk-auth") ||
      process.argv.includes("--sdk-transport") ||
      process.argv.includes("--sdk-resources") ||
      process.argv.includes("--sdk-package-network") ||
      process.argv.includes("--sdk-package-environment") ||
      process.argv.includes("--sdk-lifecycle") ||
      process.argv.includes("--runtime-callbacks") ||
      process.argv.includes("--project-trust") ||
      startupTrust ||
      closeStartupTrust ||
      process.argv.includes("--mcp") ||
      process.argv.includes("--mcp-oauth") ||
      process.argv.includes("--component-window") ||
      process.argv.includes("--sdk-themes") ||
      process.argv.includes("--component-text") ||
      process.argv.includes("--component-markdown") ||
      process.argv.includes("--component-image") ||
      process.argv.includes("--transcript-markdown") ||
      process.argv.includes("--transcript-layout") ||
      process.argv.includes("--transcript-policy") ||
      process.argv.includes("--tool-context") ||
      process.argv.includes("--tool-shell") ||
      process.argv.includes("--tool-display") ||
      process.argv.includes("--transcript-renderer") ||
      process.argv.includes("--control-text") ||
      process.argv.includes("--editor-navigation") ||
      process.argv.includes("--message-presentation") ||
      process.argv.includes("--dialog-reconnect") ||
      process.argv.includes("--input-replacement")
        ? "0"
        : "1",
    PI_DESKTOP_CWD: fixture.cwd,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9225",
    WEBVIEW2_USER_DATA_FOLDER: cleanupProfile
      ? undefined
      : join(fixture.root, "webview-profile"),
  },
});
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
let page: import("@playwright/test").Page | undefined;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9225");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!browser)
    throw new Error("Native WebView2 debugging endpoint did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) =>
    console.error("WebView error:", error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("WebView console:", message.text());
  });
  if (startupTrust || closeStartupTrust) {
    const choice = page.getByRole("dialog").getByRole("button", {
      name: "Trust (this session only)",
      exact: true,
    });
    await choice.waitFor();
    if (closeStartupTrust) {
      const exit = new Promise<number | null>((done) =>
        child.once("exit", done),
      );
      await page
        .evaluate(async () => {
          const api = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke(command: string, args: unknown): Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          await api.invoke("plugin:window|close", { label: "main" });
        })
        .catch(() => {});
      await expect.poll(() => child.exitCode, { timeout: 15000 }).toBe(0);
      await exit;
      expect(await readFile(startupTrustMarker, "utf8").catch(() => "")).toBe(
        "",
      );
      console.log(
        "Native startup trust cancellation passed with clean desktop exit.",
      );
    } else {
      await choice.click();
      await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
      expect(
        (
          await sdkAction<import("../shared/types.ts").DesktopSnapshot>(
            page,
            "snapshot",
          )
        ).trusted,
      ).toBe(true);
      expect(await readFile(startupTrustMarker, "utf8")).toBe("loaded");
      const decisions = JSON.parse(
        await readFile(join(fixture.agentDir, "trust.json"), "utf8").catch(
          () => "{}",
        ),
      );
      expect(Object.keys(decisions)).toHaveLength(0);
      console.log("Native startup session-only project trust passed.");
    }
  } else if (process.argv.includes("--sdk-drain")) {
    const probe = await startSdkDrain(page);
    const exit = new Promise<number | null>((done) => child.once("exit", done));
    let closing: Promise<unknown> | undefined;
    try {
      closing = shutdownFromWindow
        ? page.evaluate(async () => {
            const api = (
              window as unknown as {
                __TAURI_INTERNALS__: {
                  invoke(command: string, args: unknown): Promise<unknown>;
                };
              }
            ).__TAURI_INTERNALS__;
            await api.invoke("plugin:window|close", { label: "main" });
          })
        : sdkAction(
            page,
            shutdownFromTransport ? "shutdown" : "prompt",
            shutdownFromTransport ? {} : { message: "/quit-probe" },
          );
      void closing.catch(() => {});
      await awaitSdkDrainFile(join(probe.directory, "sdk-drain-aborted.txt"));
      expect(child.exitCode).toBe(null);
      expect(await readFile(shutdownMarker, "utf8").catch(() => "")).toBe("");
      await writeFile(
        join(probe.directory, "sdk-drain-release.txt"),
        "release",
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        expect(
          await Promise.race([
            exit,
            new Promise<string>((done) => {
              timer = setTimeout(() => done("desktop still running"), 10000);
            }),
          ]),
        ).toBe(0);
      } finally {
        clearTimeout(timer);
      }
      expect(
        JSON.parse(
          await readFile(
            join(probe.directory, "sdk-drain-complete.json"),
            "utf8",
          ),
        ),
      ).toEqual({ aborted: true, sessionAlive: true, version: "1.0.0" });
      expect(await readFile(shutdownMarker, "utf8")).toBe(
        shutdownFromWindow ? "started\nquit\n" : "quit\n",
      );
      page = undefined;
      console.log(
        "Native shutdown cancelled and joined the running SDK callback before original session cleanup and clean desktop exit.",
      );
    } finally {
      await writeFile(
        join(probe.directory, "sdk-drain-release.txt"),
        "release",
      );
      await probe.pending.catch(() => {});
      await closing?.catch(() => {});
    }
  } else if (testShutdown) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    const exit = new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    if (shutdownFromWindow) {
      await page
        .evaluate(async () => {
          const api = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke(command: string, args: unknown): Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          await api.invoke("plugin:window|close", { label: "main" });
        })
        .catch(() => {});
    } else
      await sdkAction(
        page,
        shutdownFromTransport ? "shutdown" : "prompt",
        shutdownFromTransport ? {} : { message: "/quit-probe" },
      ).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        exit,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("desktop still running"), 10000);
        }),
      ]);
      expect(result).toBe(0);
      page = undefined;
      expect(await readFile(shutdownMarker, "utf8")).toBe(
        shutdownFromWindow ? "started\nquit\n" : "quit\n",
      );
    } finally {
      clearTimeout(timer);
    }
    page = undefined;
    console.log(
      "Native SDK shutdown awaited one session_shutdown hook and exited the desktop cleanly.",
    );
  } else if (process.argv.includes("--project-trust")) {
    for (const mode of projectTrustModes) await verifyProjectTrust(page!, mode);
    console.log("Native project trust workflows passed.");
  } else if (process.argv.includes("--runtime-callbacks")) {
    for (const mode of runtimeCallbackModes)
      await verifyRuntimeCallbacks(page, mode);
    console.log(
      "Native runtime callback installation, clearing, error recovery and desktop editing passed.",
    );
  } else if (process.argv.includes("--sdk-package-environment")) {
    await verifySdkPackageEnvironment(page);
    console.log(
      "Native SDK default npm command, legacy global resources, version reconciliation and recovery workflows passed.",
    );
  } else if (process.argv.includes("--sdk-package-network")) {
    await verifySdkPackageNetwork(page);
    console.log(
      "Native SDK npm/Git acquisition, updates, policies, failure repair and recovery workflows passed.",
    );
  } else if (process.argv.includes("--sdk-resources")) {
    await verifySdkResources(page);
    console.log(
      "Native SDK package/resources, settings, callbacks and recovery workflows passed.",
    );
  } else if (process.argv.includes("--sdk-transport")) {
    await verifySdkTransport(page);
    console.log(
      "Native SDK rejection/result matrix, desktop Error objects, notices and recovery passed.",
    );
  } else if (process.argv.includes("--sdk-lifecycle")) {
    for (const mode of sdkLifecycleModes) await verifySdkLifecycle(page, mode);
    console.log(
      "Native SDK module preparation, cancellation, duplicate IDs, live replacement and native callbacks passed.",
    );
  } else if (process.argv.includes("--layout-order")) {
    for (const mode of ["action", "keyboard", "mouse"] as const)
      await verifyLayoutOrder(
        page,
        mode,
        `.local/screenshots/layout-order-${mode}-native.png`,
      );
    console.log(
      "Native original actions, keyboard and pointer callbacks join current DOM scroll layout with observer delivery suspended.",
    );
  } else if (process.argv.includes("--component-authority")) {
    for (const kind of ["input", "editor", "custom-editor"] as const)
      await verifyComponentAuthority(
        page,
        kind,
        `.local/screenshots/component-authority-${kind}-native.png`,
      );
    console.log(
      "Native original SDK mutations survive delayed input, selection, replacement and consecutive composition.",
    );
  } else if (
    process.argv.includes("--horizontal-gaps") ||
    process.argv.includes("--horizontal-frame")
  ) {
    const framed = process.argv.includes("--horizontal-frame");
    for (const align of ["start", "center", "end"])
      for (const nested of [false, true])
        for (const fill of [false, true])
          await verifyHorizontalGaps(
            page,
            align,
            nested,
            fill,
            `.local/screenshots/horizontal-${framed ? "frame" : "gap"}-native-${align}-${nested}-${fill}.png`,
            framed,
          );
    console.log(
      `Native horizontal ${framed ? "frames and gaps" : "gaps"} retain original drawing, controls, spacing, input, mouse callbacks and disposal.`,
    );
  } else if (process.argv.includes("--delegated-collections")) {
    for (const storage of [
      "symbol",
      "array",
      "map-value",
      "map-key",
      "set",
      "record",
    ])
      await verifyDelegatedRender(
        page,
        "Input",
        "nested",
        `.local/screenshots/delegated-collections-native-${storage}.png`,
        storage,
      );
    console.log(
      "Native collection references retain desktop controls, original input/focus, sibling identity, SDK state and disposal.",
    );
  } else if (process.argv.includes("--delegated-render")) {
    for (const shape of ["decorated", "transparent", "nested"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyDelegatedRender(
          page,
          kind,
          shape,
          `.local/screenshots/delegated-render-native-${shape}-${kind}.png`,
        );
    console.log(
      "Native delegated frames retain desktop controls, original input/focus, sibling identity, SDK state and disposal.",
    );
  } else if (process.argv.includes("--horizontal-transform")) {
    for (const align of ["start", "center", "end"])
      for (const nested of [false, true])
        for (const fill of [false, true])
          for (const transform of ["left", "both"] as const)
            await verifyHorizontalTransforms(
              page,
              align,
              nested,
              fill,
              transform,
              `.local/screenshots/horizontal-transform-native-${align}-${nested}-${fill}-${transform}.png`,
            );
    console.log(
      "Native simultaneous column transformations retain original input, external frames, gap drawing, SDK state and disposal.",
    );
  } else if (process.argv.includes("--horizontal-height")) {
    for (const align of ["start", "center", "end"])
      for (const nested of [false, true])
        for (const fill of [false, true])
          for (const height of ["insert", "cut"] as const)
            await verifyHorizontalTransforms(
              page,
              align,
              nested,
              fill,
              "left",
              `.local/screenshots/horizontal-height-native-${align}-${nested}-${fill}-${height}.png`,
              height,
            );
    console.log(
      "Native horizontal body height changes retain original input, external frames, gap drawing, SDK state and disposal.",
    );
  } else if (process.argv.includes("--layout-frame")) {
    for (const parentKind of ["HStack", "ScrollView"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/layout-frame-${parentKind}-${kind}-native.png`,
        );
    for (const parentKind of ["HStack", "ScrollView"])
      for (const kind of ["Editor", "SettingsList"])
        for (const innerKinds of [["Box"], ["Container", "Box", "VStack"]])
          await verifyNestedFrame(
            page,
            parentKind,
            kind,
            `.local/screenshots/layout-frame-nested-${parentKind}-${kind}-${innerKinds.length}-native.png`,
            innerKinds,
          );
    console.log(
      "Native horizontal and scroll frame transformations retain original controls, siblings, focus, programmatic scroll and disposal.",
    );
  } else if (process.argv.includes("--recursive-frame")) {
    for (const parentKind of ["Container", "Box", "VStack"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/recursive-frame-${parentKind}-${kind}-native.png`,
          ["Container", "Box", "VStack"],
        );
    for (const innerKind of ["Container", "Box", "VStack"])
      await verifyNestedFrame(
        page,
        "Box",
        "Editor",
        `.local/screenshots/recursive-plain-${innerKind}-native.png`,
        [`plain:${innerKind}`],
      );
    console.log(
      "Native recursive frame transformations preserve original inputs, lists, nested sibling identities, focus and disposal.",
    );
  } else if (process.argv.includes("--nested-frame")) {
    for (const parentKind of ["Container", "Box", "VStack"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyNestedFrame(
          page,
          parentKind,
          kind,
          `.local/screenshots/nested-frame-${parentKind}-${kind}-native.png`,
        );
    console.log(
      "Native parent frame transformations retain nested original SDK input, lists, mouse, focus and disposal.",
    );
  } else if (process.argv.includes("--list-render")) {
    for (const kind of ["SelectList", "SettingsList"])
      for (const helper of [false, true])
        await verifyListRender(
          page,
          kind,
          helper,
          `.local/screenshots/list-frame-${kind}-native-${helper}.png`,
        );
    console.log(
      "Native custom list frames retain original SDK operations, mouse, focus and disposal.",
    );
  } else if (process.argv.includes("--interactive-render")) {
    for (const kind of ["Input", "Editor", "CustomEditor"])
      await verifyInteractiveRender(
        page,
        kind,
        `.local/screenshots/interactive-frame-${kind}-native.png`,
      );
    console.log(
      "Native custom interactive frames retain original SDK editing, focus, callbacks and disposal.",
    );
  } else if (process.argv.includes("--container-render")) {
    for (const kind of ["Container", "Box", "VStack"])
      await verifyContainerRender(
        page,
        kind,
        `.local/screenshots/container-frame-${kind}-native.png`,
      );
    console.log(
      "Native vertical custom frames preserve original controls, order, SDK hidden values, callbacks and disposal.",
    );
  } else if (process.argv.includes("--render-baseline")) {
    for (const own of [false, true])
      await verifyRenderBaseline(
        page,
        own,
        `.local/screenshots/render-baseline-native-${own}.png`,
      );
    console.log(
      "Native inherited helper renders and original cache annotations retain desktop controls, callbacks and disposal.",
    );
  } else if (process.argv.includes("--render-additions")) {
    await verifyEmptyRender(page, ".local/screenshots/empty-render-native.png");
    await verifyPassiveRenderReplacement(
      page,
      ".local/screenshots/passive-render-native.png",
    );
    await verifyStandardRenderAdditions(
      page,
      ".local/screenshots/standard-render-native.png",
    );
    await verifyRenderAdditions(
      page,
      ".local/screenshots/render-additions-native.png",
    );
    console.log(
      "Native original subclass render additions and official modal editor passed without legacy adapters.",
    );
  } else if (process.argv.includes("--overlay-lifecycle")) {
    for (const mode of overlayLifecycleModes)
      await verifyOverlayLifecycle(
        page,
        mode,
        `.local/screenshots/overlay-lifecycle-native-${mode}.png`,
      );
    console.log(
      "Native overlay handles preserve original input, temporary hiding, removal, results and teardown across four workflows.",
    );
  } else if (process.argv.includes("--custom-close-order")) {
    for (const mode of customCloseModes)
      await verifyCustomCloseOrder(
        page,
        mode,
        `.local/screenshots/custom-close-order-native-${mode}.png`,
      );
    console.log(
      "Native custom UI preserves original Pi result and asynchronous cleanup order across three workflows.",
    );
  } else if (process.argv.includes("--component-remount")) {
    for (const mode of remountModes)
      await verifyComponentRemount(
        page,
        mode,
        `.local/screenshots/component-remount-native-${mode}.png`,
      );
    console.log(
      `Native repeated and overlapping component factories preserve original input, results, receivers and captured cleanup wrappers across ${remountModes.length} workflows.`,
    );
  } else if (process.argv.includes("--component-disposal")) {
    for (const mode of disposalModes)
      await verifyComponentDisposal(
        page,
        mode,
        `.local/screenshots/component-disposal-native-${mode}.png`,
      );
    console.log(
      "Native readonly/frozen disposal, cached reuse, original ownership and desktop/xterm transitions passed across 11 workflows.",
    );
  } else if (process.argv.includes("--terminal-transition")) {
    for (const kind of ["readonly", "container"])
      await verifyCompositeFocus(
        page,
        kind,
        `.local/screenshots/composite-focus-native-${kind}.png`,
      );
    for (const holder of ["closure", "weakmap", "private"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyTerminalTransition(
          page,
          kind,
          holder,
          `.local/screenshots/terminal-transition-native-${holder}-${kind}.png`,
        );
    console.log(
      "Native desktop/xterm transitions and composite focus preserve original Pi input, SDK updates, callbacks and disposal across 17 workflows.",
    );
  } else if (process.argv.includes("--terminal-descendant")) {
    for (const mode of ["multiple", "width", "locked", "closure"])
      for (const kind of [
        "Input",
        "Editor",
        "CustomEditor",
        "SelectList",
        "SettingsList",
      ])
        await verifyTerminalDescendant(
          page,
          kind,
          mode,
          `.local/screenshots/terminal-descendant-native-${mode}-${kind}.png`,
        );
    for (const mode of ["owner", "regions"])
      await verifyTerminalDescendant(
        page,
        "Input",
        mode,
        `.local/screenshots/terminal-descendant-native-${mode}.png`,
      );
    console.log(
      "Native opaque terminal descendants retain original focus, input, callbacks and disposal across 22 workflows.",
    );
  } else if (process.argv.includes("--terminal-effects")) {
    await verifyTerminalEffects(
      page,
      ".local/screenshots/terminal-effects-native.png",
    );
    console.log(
      "Native original ProcessTerminal OSC, SDK clipboard fallback, replay deduplication and explicit shared progress cleanup passed.",
    );
  } else if (process.argv.includes("--desktop-workspace")) {
    await verifyNativeDesktopWorkspace(page, child.pid!);
    console.log(
      "Native desktop workspace, file lines, context menu, pins, tool controls, providers and bottom terminal dock passed.",
    );
  } else if (process.argv.includes("--terminal")) {
    await verifyTerminal(page);
    console.log(
      "Native xterm PTY, synchronous child input, resize and original component callbacks passed.",
    );
  } else if (process.argv.includes("--component-lifecycle")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentLifecycle(page);
    console.log(
      "Native mapped TUI pause/resume retains original input and DOM identity.",
    );
  } else if (process.argv.includes("--draft-submit")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "sdk.run", {
      path: traceModule,
      args: { path: tracePath },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await sdkAction(page, "session.new");
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await composer.fill("run-tool");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page
        .getByText("SDK desktop tool verified.", { exact: true })
        .waitFor();
      await composer.fill("/desktop-native-form");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("textbox", { name: "Task name" })
        .fill("Previous native draft");
      await dialog.getByRole("button", { name: "Apply task" }).click();
      await expect(dialog).toBeHidden();
      await expect(composer).toHaveValue("Previous native draft");
      await composer.fill("/desktop-input");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect
        .poll(async () => {
          const requests = (await readFile(tracePath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          return requests
            .filter((request) => request.action === "prompt")
            .at(-1)?.args.message;
        })
        .toBe("/desktop-input");
      await sdkAction(page, "abort");
    }
    console.log(
      "Native draft replacement and immediate send passed five repetitions.",
    );
  } else if (process.argv.includes("--control-text")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyControlText(page, ".local/screenshots/native-control-text.png");
    await verifyRichControls(
      page,
      ".local/screenshots/native-rich-controls.png",
      true,
    );
    console.log(
      "Native themed control labels, original option values, placeholders, descriptions and loader cancellation passed.",
    );
  } else if (process.argv.includes("--transcript-renderer")) {
    await verifyTranscriptRenderers(
      page,
      ".local/screenshots/transcript-renderer-native.png",
    );
    console.log(
      "Native message/entry receivers, options, fallback, duplicate identity, input, persistence and restoration workflows passed.",
    );
  } else if (process.argv.includes("--tool-display")) {
    await verifyToolDisplay(page, ".local/screenshots/tool-display-native.png");
    console.log(
      "Native paired tool composition, independent/global expansion, native clicks, colors, controls, stable partial/final DOM and restoration passed.",
    );
  } else if (process.argv.includes("--tool-shell")) {
    await verifyToolShell(page, ".local/screenshots/tool-shell-native.png");
    console.log(
      "Native original tool shell, fallback, receiver, input, partial output and restoration workflows passed.",
    );
  } else if (process.argv.includes("--tool-context")) {
    await verifyToolContext(page, ".local/screenshots/tool-context-native.png");
    console.log(
      "Native streamed arguments, tool renderer contexts, shared invalidation, cancellation, nested events and restoration passed.",
    );
  } else if (process.argv.includes("--component-image")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentImage(
      page,
      ".local/screenshots/transcript-policy-component-image-native.png",
    );
    console.log(
      "Native original image sizing, fallback themes and source recovery passed.",
    );
  } else if (process.argv.includes("--transcript-policy")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyTranscriptPolicy(
      page,
      ".local/screenshots/transcript-policy-native.png",
    );
    console.log(
      "Native completion notices, image policy, renderer contexts, partial output and restoration passed.",
    );
  } else if (process.argv.includes("--transcript-layout")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyTranscriptLayout(
      page,
      ".local/screenshots/transcript-layout-native.png",
    );
    console.log(
      "Native transcript widths, padding, panel/DOM/font resize, observer ordering and session scope passed.",
    );
  } else if (process.argv.includes("--transcript-markdown")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyTranscriptMarkdown(
      page,
      ".local/screenshots/transcript-markdown-native.png",
    );
    console.log(
      "Native transcript transformers, Mermaid modes, streaming, styles and lifecycle passed.",
    );
  } else if (process.argv.includes("--component-markdown")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentMarkdown(
      page,
      ".local/screenshots/native-component-markdown.png",
      true,
    );
    console.log(
      "Native semantic Markdown, themes, highlighting, links and original callbacks passed.",
    );
  } else if (process.argv.includes("--dialog-reconnect")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "prompt", { message: "/dialog-text-probe" });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    console.log("Native pending dialog replay passed.");
    await verifyDialogText(page, true);
    await verifyDialogTimeout(page);
    await verifyDialogKeyboard(page);
    await verifyDialogPaste(page);
    await verifyDialogSubmission(page);
    await verifyDialogOrder(page);
    console.log(
      "Native dialog presentation, option values, deadlines and reload passed.",
    );
  } else if (process.argv.includes("--message-presentation")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem("pi.showThinking", "false"));
    await page.reload();
    await verifyThinkingLabel(page);
    await verifyWorkingIndicator(page);
    console.log(
      "Native hidden thinking labels and animated working text passed.",
    );
  } else if (process.argv.includes("--component-text")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentText(
      page,
      ".local/screenshots/native-component-text.png",
      true,
    );
    await verifyTextSurfaces(
      page,
      ".local/screenshots/native-text-surfaces.png",
    );
    await verifyRichControls(
      page,
      ".local/screenshots/native-rich-controls.png",
      true,
    );
    console.log(
      "Native standard text styling, links, backgrounds and original callbacks passed.",
    );
  } else if (process.argv.includes("--sdk-themes")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyThemeInvalidation(page);
    await verifySdkThemes(page, ".local/screenshots/native-sdk-themes.png");
    await verifySystemThemes(
      page,
      ".local/screenshots/native-sdk-system-themes.png",
    );
    console.log(
      "Native SDK theme catalog, helpers, persistence and desktop colors passed.",
    );
  } else if (process.argv.includes("--component-overlays")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "sdk.run", {
      path: traceModule,
      args: { path: tracePath },
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      await sdkAction(page, "prompt", { message: "/mapped-settings" });
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await verifyComponentOverlays(page);
    }
    console.log("Native nested overlay focus passed.");
  } else if (process.argv.includes("--mapped-completion")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "sdk.run", {
      path: traceModule,
      args: { path: tracePath },
    });
    await sdkAction(page, "session.new");
    await sdkAction(page, "prompt", { message: "/mapped-editor" });
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.pressSequentially("/mapped-s");
    await composer.press("Tab");
    const editor = page.locator('[data-surface-id="editor"]');
    await expect(
      editor.getByRole("listbox", { name: "选择", exact: true }),
    ).toBeVisible();
    await editor.getByRole("option", { name: /mapped-settings/ }).click();
    await expect(composer).toHaveValue("/mapped-settings ");
    await expect(page.getByRole("alert")).toHaveCount(0);
    console.log("Native completion click passed without error notices.");
  } else if (process.argv.includes("--sdk-auth")) {
    await verifySdkAuth(page, ".local/screenshots/native-sdk-auth.png");
    console.log(
      "Native SDK provider login, prompt metadata, device identity and cancellation passed.",
    );
  } else if (process.argv.includes("--invocation-options")) {
    for (const mode of invocationModes)
      await verifyInvocationOptions(
        page,
        mode,
        `.local/screenshots/invocation-${mode}-native.png`,
      );
    console.log(
      "Native invocation layout, theme, custom terminal and implicit trust workflows passed.",
    );
  } else if (process.argv.includes("--startup-policy")) {
    for (const mode of startupPolicyModes)
      await verifyStartupPolicy(
        page,
        mode,
        `.local/screenshots/startup-policy-${mode}-native.png`,
      );
    console.log(
      "Native background startup policies passed across version, packages, crash, subscription and bug workflows.",
    );
  } else if (process.argv.includes("--startup")) {
    for (const mode of startupModes)
      await verifyStartup(
        page,
        mode,
        `.local/screenshots/startup-${mode}-native.png`,
      );
    console.log(
      "Native startup changelog, sequential inputs/images and diagnostic workflows passed.",
    );
  } else if (process.argv.includes("--managed-tools")) {
    for (const mode of managedToolModes)
      await verifyManagedTools(
        page,
        mode,
        `.local/screenshots/managed-tools-${mode}-native.png`,
      );
    console.log(
      "Native managed tools passed across recursive, scoped, reprepare and status workflows.",
    );
  } else if (process.argv.includes("--application-content")) {
    for (const mode of applicationContentModes)
      await verifyApplicationContent(
        page,
        mode,
        `.local/screenshots/application-content-${mode}-native.png`,
      );
    console.log(
      "Native application content passed across header, resources, pending and widgets workflows.",
    );
  } else if (process.argv.includes("--conversation-notices")) {
    for (const mode of conversationNoticeModes)
      await verifyConversationNotices(
        page,
        mode,
        `.local/screenshots/conversation-notices-${mode}-native.png`,
      );
    console.log(
      "Native conversation notices passed across cache, compaction and branch workflows.",
    );
  } else if (process.argv.includes("--renderer-modes")) {
    for (const mode of rendererModes)
      await verifyRendererModes(
        page,
        mode,
        `.local/screenshots/renderer-modes-${mode}-native.png`,
      );
    console.log(
      "Native original renderer modes, force redraw, overlay guards, input rebinding and stop/start passed with mapped controls and xterm.",
    );
  } else if (process.argv.includes("--runtime-continuity")) {
    for (const transition of continuityTransitions)
      for (const mode of continuityModes)
        await verifyRuntimeContinuity(
          page,
          transition,
          mode,
          `.local/screenshots/runtime-continuity-${transition}-${mode}-native.png`,
        );
    console.log(
      "Native runtime continuity across reload, new, switch, fork and import passed with mapped inputs and xterm.",
    );
  } else if (process.argv.includes("--native-execution")) {
    for (const mode of nativeExecutionModes)
      await verifyNativeExecution(
        page,
        mode,
        `.local/screenshots/native-execution-${mode}-native.png`,
      );
    console.log(
      "Native original tool rows, live Bash identity and original notices passed.",
    );
  } else if (process.argv.includes("--application-components")) {
    for (const mode of applicationModes)
      await verifyApplicationComponents(
        page,
        mode,
        `.local/screenshots/application-components-${mode}-native.png`,
      );
    console.log(
      "Native original application messages, shared footer and editor/status lifecycle passed.",
    );
  } else if (process.argv.includes("--default-editor")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyDefaultEditor(
      page,
      ".local/screenshots/native-default-editor.png",
    );
    console.log(
      "Native default SDK editor actions, clipboard, queues and drafts passed.",
    );
  } else if (process.argv.includes("--input-replacement")) {
    await verifyMultilineReplacement(
      page,
      ".local/screenshots/native-input-replacement.png",
    );
    console.log(
      "Native text insertion, multiline range replacement, listeners and undo passed.",
    );
  } else if (process.argv.includes("--editor-navigation")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifySelectionShortcuts(page);
    await verifyEditorBidi(page);
    await verifyEditorBidi(page, ["input"]);
    await verifyEditorNavigation(
      page,
      ".local/screenshots/native-editor-navigation.png",
    );
    await verifyEditorResize(
      page,
      ".local/screenshots/native-editor-resize.png",
    );
    console.log(
      "Native mixed-direction selection/deletion, visual-row navigation and pending-input resize passed.",
    );
  } else if (process.argv.includes("--component-window")) {
    await verifyComponentWindow(page);
    await verifySdkThemes(
      page,
      ".local/screenshots/native-mapped-sdk-themes.png",
    );
    console.log(
      "Native original component title and progress commands passed.",
    );
  } else if (process.argv.includes("--mcp-oauth")) {
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.waitFor();
    const login = () =>
      sdkAction(page!, "mcp.command", {
        name: "local_http",
        operation: "login",
      }).then(
        () => ({ error: "" }),
        (error: Error) => ({ error: error.message }),
      );
    const pending = login();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox")).toBeVisible();
    const notice = page
      .locator(".notice")
      .filter({
        hasText: 'Sign in to MCP server "local_http" in your browser:',
      })
      .last();
    await expect(notice).not.toContainText("\u001b");
    const authorizationUrl = await notice
      .getByRole("link")
      .first()
      .getAttribute("href");
    expect(authorizationUrl).toBeTruthy();
    const response = await fetch(authorizationUrl!, { redirect: "manual" });
    expect(response.status).toBe(302);
    await dialog.getByRole("textbox").fill(response.headers.get("location")!);
    await page.screenshot({ path: ".local/screenshots/native-mcp-oauth.png" });
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    expect((await pending).error).toBe("");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开授权页面", exact: true }),
    ).toHaveCount(0);
    await composer.fill("mcp-echo");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByText("SDK desktop tool verified.", { exact: true })
      .waitFor();
    await expect(
      page.getByText("MCP:Native MCP", { exact: true }),
    ).toBeVisible();
    await sdkAction(page, "mcp.command", {
      name: "local_http",
      operation: "logout",
    });
    const cancelled = login();
    await expect(dialog.getByRole("textbox")).toBeVisible();
    await sdkAction(page, "auth.cancel");
    expect((await cancelled).error).toBe("");
    await expect(dialog).toHaveCount(0);
    expect(oauthPeer!.grants.length).toBe(1);
    await composer.fill("/mcp");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(dialog.getByRole("combobox")).toHaveValue("local_http");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await dialog.getByRole("combobox").selectOption("signin");
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(dialog.getByRole("textbox")).toBeVisible();
    const managerUrl = await dialog
      .getByRole("link")
      .first()
      .getAttribute("href");
    expect(managerUrl).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "打开授权页面", exact: true }),
    ).toBeVisible();
    expect((await fetch(managerUrl!)).status).toBe(200);
    await expect(dialog.getByRole("combobox")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开授权页面", exact: true }),
    ).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(oauthPeer!.grants.length).toBe(2);
    if (process.argv.includes("--mcp-identical-token")) {
      const savedTokens = async () =>
        Object.values(
          JSON.parse(
            await readFile(join(fixture.agentDir, "mcp-auth.json"), "utf8"),
          ),
        ) as { tokens: unknown; tokensExpireAt?: number }[];
      const before = (await savedTokens())[0];
      oauthPeer!.rejectCurrentAccessToken();
      await dialog.getByRole("combobox").selectOption("reconnect");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(
        dialog.getByRole("combobox").locator('option[value="signin"]'),
      ).toHaveCount(1);
      await dialog.getByRole("combobox").selectOption("signin");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      await expect(dialog.getByRole("textbox")).toBeVisible();
      const repeatedUrl = await dialog
        .getByRole("link")
        .first()
        .getAttribute("href");
      await expect(
        page.getByRole("button", { name: "打开授权页面", exact: true }),
      ).toBeVisible();
      expect((await fetch(repeatedUrl!)).status).toBe(200);
      await expect(dialog.getByRole("combobox")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "打开授权页面", exact: true }),
      ).toHaveCount(0);
      const after = (await savedTokens())[0];
      expect(after.tokens).toEqual(before.tokens);
      expect(after.tokensExpireAt).toBeUndefined();
      expect(before.tokensExpireAt).toBeUndefined();
      expect(oauthPeer!.grants.length).toBe(3);
    }
    if (process.argv.includes("--mcp-token-failure")) {
      oauthPeer!.rejectCurrentAccessToken();
      // Remove the refresh token by using the stable-token fixture in this workflow.
      expect(process.argv.includes("--mcp-identical-token")).toBe(true);
      await dialog.getByRole("combobox").selectOption("reconnect");
      await dialog.getByRole("button", { name: "确认", exact: true }).click();
      const grantsBefore = oauthPeer!.grants.length;
      for (const fail of [true, false]) {
        rejectNativeToken = fail;
        await expect(
          dialog.getByRole("combobox").locator('option[value="signin"]'),
        ).toHaveCount(1);
        await dialog.getByRole("combobox").selectOption("signin");
        await dialog.getByRole("button", { name: "确认", exact: true }).click();
        await expect(dialog.getByRole("textbox")).toBeVisible();
        const url = await dialog.getByRole("link").first().getAttribute("href");
        await expect(
          page.getByRole("button", { name: "打开授权页面", exact: true }),
        ).toBeVisible();
        expect((await fetch(url!)).status).toBe(200);
        await expect(dialog.getByRole("combobox")).toBeVisible();
        await expect(
          page.getByRole("button", { name: "打开授权页面", exact: true }),
        ).toHaveCount(0);
        if (fail) {
          await expect(dialog.getByText(/Sign-in failed:/)).toBeVisible();
          await page.screenshot({
            path: ".local/screenshots/native-mcp-token-failure.png",
          });
        } else {
          await expect(dialog.getByText(/Sign-in failed:/)).toHaveCount(0);
          await expect(dialog.getByText(/State: connected/)).toBeVisible();
        }
      }
      expect(oauthPeer!.grants.length).toBe(grantsBefore + 2);
      console.log(
        "Native MCP failed token exchange preserves the original error and retries successfully without a stale authorization banner.",
      );
    }
    await page.screenshot({
      path: ".local/screenshots/native-mcp-manager-auth-complete.png",
    });
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("combobox")).toHaveValue("local_http");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    console.log(
      "Native MCP OAuth pasted callback, token exchange, tool result, global cancellation and mapped manager authorization completion passed.",
    );
  } else if (process.argv.includes("--mcp")) {
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.waitFor();
    await composer.fill("mcp-echo");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByText("SDK desktop tool verified.", { exact: true })
      .waitFor();
    expect(
      mcpPeer!.requests.some(
        (request) =>
          request.method === "tools/call" &&
          request.params.arguments.text === "Native MCP",
      ),
    ).toBe(true);
    await expect(
      page.getByText("MCP:Native MCP", { exact: true }),
    ).toBeVisible();
    await composer.fill("/mcp");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("MCP servers", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("combobox")).toHaveValue("local_http");
    await expect(page.getByText(/Unsupported Pi TUI/)).toHaveCount(0);
    await page.screenshot({
      path: ".local/screenshots/native-mcp-manager.png",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    console.log(
      "Native MCP tool pipeline and original manager desktop mapping passed.",
    );
  } else if (process.argv.includes("--sdk-reload")) {
    const modulePath = join(fixture.agentDir, "desktop", "reload-qa.mjs");
    await writeFile(
      modulePath,
      `let release, pending;
      export default async function({session, host}, {stage}) {
      const ui = session.extensionRunner.getUIContext();
      if (stage === "prepare") {
        ui.setEditorText("Retained reload draft");
        ui.setWidget("reload-old", ["Old reload widget"]);
        ui.onTerminalInput(() => ({consume: true}));
      } else if (stage === "race-start") {
        const entered = Promise.withResolvers();
        const gate = Promise.withResolvers();
        release = gate.resolve;
        const load = host.loadKeybindings.bind(host);
        let held = false;
        host.loadKeybindings = async (...args) => {
          await load(...args);
          if (!held) { held = true; entered.resolve(); await gate.promise; }
        };
        pending = session.reload();
        await entered.promise;
      } else if (stage === "race-finish") {
        release();
        let cancelled = false;
        try { await pending; } catch (error) {
          if (error.name !== "AbortError") throw error;
          cancelled = true;
        }
        if (!cancelled) throw new Error("Superseded reload was not cancelled");
      } else {
        await session.reload({beforeSessionStart: () => {
          if (host.snapshot().extensionUI.inputListeners !== 0) throw new Error("Stale input listener");
          if (ui.getEditorText() !== "Retained reload draft") throw new Error("Lost editor draft");
          ui.setEditorText("Reloaded SDK draft");
        }});
      }
    }`,
    );
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "sdk.run", {
      path: modulePath,
      args: { stage: "prepare" },
    });
    await expect(
      page.getByText("Old reload widget", { exact: true }),
    ).toBeVisible();
    await sdkAction(page, "sdk.run", {
      path: modulePath,
      args: { stage: "reload" },
    });
    await expect(
      page.getByText("Old reload widget", { exact: true }),
    ).toHaveCount(0);
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(composer).toHaveValue("Reloaded SDK draft");
    await composer.press("End");
    await composer.press("x");
    await expect(composer).toHaveValue("Reloaded SDK draftx");
    await sdkAction(page, "sdk.run", {
      path: modulePath,
      args: { stage: "race-start" },
    });
    await sdkAction(page, "session.new");
    await composer.fill("Successor native draft");
    const before = await sdkAction<import("../shared/types").DesktopSnapshot>(
      page,
      "snapshot",
    );
    const editorInstance = before.desktopSurfaces.find(
      (surface) => surface.id === "editor",
    )?.instanceId;
    expect(editorInstance).toBeTruthy();
    await sdkAction(page, "sdk.run", {
      path: modulePath,
      args: { stage: "race-finish" },
    });
    const after = await sdkAction<import("../shared/types").DesktopSnapshot>(
      page,
      "snapshot",
    );
    expect(
      after.desktopSurfaces.find((surface) => surface.id === "editor")
        ?.instanceId,
    ).toBe(editorInstance);
    await expect(composer).toHaveValue("Successor native draft");
    await composer.press("End");
    await composer.press("x");
    await expect(composer).toHaveValue("Successor native draftx");
    await expect(page.getByText(/This extension ctx is stale/)).toHaveCount(0);
    await page.screenshot({ path: ".local/screenshots/native-sdk-reload.png" });
    console.log(
      "Native SDK reload clears old state; delayed reload preserves the successor editor and typing.",
    );
  } else if (
    process.argv.includes("--file-links") ||
    process.argv.includes("--file-association")
  ) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyFileLinks(
      page,
      ".local/screenshots/native-file-links.png",
      true,
    );
    await verifyNativeFileAssociationLaunch(page);
    console.log(
      "Native file association received exact decoded paths from Text, Markdown and transcript links.",
    );
    if (process.argv.includes("--file-links"))
      await verifyNativeFileLinkLaunch(page);
    console.log(
      "Native encoded file resolution, opener error/retry and registered-handler launch passed.",
    );
  } else if (process.argv.includes("--link-launch")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyNativeLinkLaunch(page);
    console.log("Native default-browser launch passed.");
  } else if (process.argv.includes("--links")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyDesktopLinks(page, ".local/screenshots/native-links.png", true);
    await verifyNativeProtocolLaunch(page);
    await verifyNativeLinkLaunch(page);
    console.log(
      "Native email/phone link dispatch, real custom-protocol receipt and default-browser launch passed.",
    );
  } else if (process.argv.includes("--keyboard-phases")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const mode of keyboardPhaseModes) {
      await verifyKeyboardPhases(
        page,
        mode,
        `.local/screenshots/native-keyboard-phases-${mode}.png`,
      );
    }
    console.log(
      "Native keyboard press/repeat/release, opt-in, listeners, selection, focus, IME, paste and shortcut workflows passed.",
    );
  } else if (process.argv.includes("--terminal-input")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const mode of terminalInputModes)
      await verifyTerminalInput(
        page,
        mode,
        `.local/screenshots/native-global-input-${mode}.png`,
      );
    console.log("Native global terminal input workflows passed.");
  } else if (process.argv.includes("--shared-tui")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const mode of sharedTuiModes)
      await verifySharedTui(
        page,
        mode,
        `.local/screenshots/native-shared-tui-${mode}.png`,
      );
    console.log(
      "Native shared TUI identity, focus, registrations, lifecycle and overlays passed.",
    );
  } else if (process.argv.includes("--terminal-state")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const mode of terminalStateModes)
      await verifySharedTerminalPresentation(
        page,
        mode,
        `.local/screenshots/native-shared-terminal-${mode}.png`,
      );
    console.log("Native shared terminal presentation workflows passed.");
  } else if (process.argv.includes("--component-listeners")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentListeners(page);
    console.log(
      "Native Text component listeners, debug callback and original result passed.",
    );
  } else if (process.argv.includes("--component-focus")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentFocus(page);
    console.log(
      "Native programmatic component focus and original input callbacks passed.",
    );
  } else if (process.argv.includes("--component-registration")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    for (const mode of registrationModes)
      await verifyComponentRegistration(
        page,
        mode,
        `.local/screenshots/native-registered-tui-${mode}.png`,
      );
    console.log(
      "Native registered TUI mutations, duplicates, shared ownership and xterm workflows passed.",
    );
  } else if (process.argv.includes("--component-invalidate")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentInvalidation(page);
    console.log("Native TUI invalidation updates original root caches.");
  } else if (process.argv.includes("--component-cleanup")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentCleanup(page);
    console.log(
      "Native component cleanup errors retain results and subsequent interaction.",
    );
  } else if (process.argv.includes("--component-appearance")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentAppearance(
      page,
      ".local/screenshots/native-component-appearance.png",
    );
    console.log(
      "Native component color query and appearance subscriptions passed.",
    );
  } else if (process.argv.includes("--component-delegation")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyComponentDelegation(
      page,
      "Native original callback",
      ".local/screenshots/native-component-delegation.png",
    );
    console.log("Native transparent Pi component delegation passed.");
  } else if (process.argv.includes("--editor-config")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyEditorConfig(
      page,
      ".local/screenshots/native-editor-config.png",
    );
    console.log("Native Editor live padding and submission settings passed.");
  } else if (process.argv.includes("--stack-sizes")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyStackSizes(page, ".local/screenshots/native-stack-sizes.png");
    console.log(
      "Native zero-size stack visibility and retained input state passed.",
    );
  } else if (process.argv.includes("--scrollbars")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyScrollbars(page, ".local/screenshots/native-scrollbars.png");
    console.log(
      "Native scrollbar modes, original themes, activity and hide timers passed.",
    );
  } else if (process.argv.includes("--pointer-replacement")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await verifyPointerReplacement(page);
    console.log(
      "Native immediate input replacement and drag selection passed 20 repetitions.",
    );
  } else if (process.argv.includes("--mapped-components")) {
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await sdkAction(page, "sdk.run", {
      path: traceModule,
      args: { path: tracePath },
    });
    await verifyPointerReplacement(page);
    await verifyDesktopLinks(page, ".local/screenshots/native-links.png", true);
    await verifyScrollbars(page, ".local/screenshots/native-scrollbars.png");
    await verifyFileLinks(
      page,
      ".local/screenshots/native-file-links.png",
      true,
    );
    await verifyStackSizes(page, ".local/screenshots/native-stack-sizes.png");
    await verifyEditorConfig(
      page,
      ".local/screenshots/native-editor-config.png",
    );
    await verifyComponentImage(
      page,
      ".local/screenshots/native-component-image.png",
    );
    await verifyComponentMapping(
      page,
      ".local/screenshots/native-mapped-components.png",
    );
    await verifyComponentText(
      page,
      ".local/screenshots/native-component-text.png",
      true,
    );
    await verifyComponentMarkdown(
      page,
      ".local/screenshots/native-component-markdown.png",
      true,
    );
    await verifyControlText(page, ".local/screenshots/native-control-text.png");
    await verifyTextSurfaces(
      page,
      ".local/screenshots/native-text-surfaces.png",
    );
    await verifyRichControls(
      page,
      ".local/screenshots/native-rich-controls.png",
      true,
    );
    await verifyMappedEditorTransactions(
      page,
      ".local/screenshots/native-mapped-editor-transactions.png",
    );
    await verifyMappedPasteBlocks(
      page,
      ".local/screenshots/native-mapped-paste-blocks.png",
    );
    await verifyMappedComposition(
      page,
      ".local/screenshots/native-mapped-composition.png",
    );
    await verifySdkAuth(page, ".local/screenshots/native-sdk-auth.png");
    await verifyMultilineReplacement(
      page,
      ".local/screenshots/native-mapped-input-replacement.png",
    );
    await verifyComponentWindow(page);
    await verifySdkThemes(
      page,
      ".local/screenshots/native-mapped-sdk-themes.png",
    );
    await verifySystemThemes(
      page,
      ".local/screenshots/native-mapped-sdk-system-themes.png",
    );
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Desktop action is unavailable" }),
    ).toHaveCount(0);
    console.log(
      "Native standard components and mapped editor transactions passed without unavailable-action notices.",
    );
  } else if (cleanupProfile) {
    await page.getByText("Pi Desktop", { exact: true }).first().waitFor();
    await page.evaluate(() => {
      for (const key of ["pi.workspace", "pi.workspace.userSelection"])
        if (localStorage.getItem(key)?.includes("pi-desktop-test-"))
          localStorage.removeItem(key);
    });
    await verifyComponentMapping(
      page,
      ".local/screenshots/native-component-library.png",
    );
    console.log(
      "Removed the temporary QA workspace from the default desktop profile.",
    );
  } else {
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .waitFor({ timeout: 30000 });
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("run-tool");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByText("SDK desktop tool verified.", { exact: true })
      .waitFor({ timeout: 30000 });
    await page.screenshot({ path: ".local/screenshots/native-desktop.png" });
    const inspection = await page.evaluate(async () => {
      const tauri = (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      const result = (await tauri.invoke("sdk_action", {
        action: "sdk.inspect",
        args: {},
      })) as { systemPrompt: string; callableTools: string[] };
      return {
        hasPrompt: result.systemPrompt.length > 0,
        hasRead: result.callableTools.includes("read"),
      };
    });
    if (!inspection.hasPrompt || !inspection.hasRead)
      throw new Error("Native SDK inspection failed");
    await page.evaluate(
      ({ module, trace }) =>
        (
          window as unknown as {
            __TAURI_INTERNALS__: {
              invoke: (command: string, args: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__.invoke("sdk_action", {
          action: "sdk.run",
          args: { path: module, args: { path: trace } },
        }),
      { module: traceModule, trace: tracePath },
    );
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("/desktop-native-form");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Extension task" }).waitFor();
    await dialog
      .getByRole("textbox", { name: "Task name" })
      .fill("Native desktop task");
    await dialog
      .getByRole("combobox", { name: "Priority" })
      .selectOption("high");
    await page.screenshot({
      path: ".local/screenshots/native-extension-desktop.png",
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Apply task" }).click();
    await dialog.waitFor({ state: "hidden" });
    await expect(composer).toHaveValue("Native desktop task");
    await composer.fill("/desktop-input");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="消息"]') as HTMLTextAreaElement)
          ?.value === "",
    );
    await composer.pressSequentially("xyab");
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="消息"]') as HTMLTextAreaElement)
          ?.value === "Zab",
    );
    await composer.press("Control+Alt+u");
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="消息"]') as HTMLTextAreaElement)
          ?.value === "Shortcut handled",
    );
    await composer.fill("/desktop-input-off");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="消息"]') as HTMLTextAreaElement)
          ?.value === "",
    );
    await composer.fill("/desktop-renderers");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.getByText("Native message renderer", { exact: true }).waitFor();
    await page.getByText("Native entry renderer", { exact: true }).waitFor();
    await composer.fill("/desktop-native-overlay");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const overlay = page.locator(".desktop-overlay");
    await overlay.getByRole("textbox", { name: "Task name" }).waitFor();
    await page.screenshot({
      path: ".local/screenshots/native-overlay-desktop.png",
      animations: "disabled",
    });
    await overlay
      .getByRole("button", { name: "关闭扩展", exact: true })
      .click();
    await overlay.waitFor({ state: "hidden" });
    await composer.fill("official-question");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await dialog
      .getByText("Which interface should be used?", { exact: true })
      .waitFor();
    await dialog
      .getByRole("combobox", { name: "Answer", exact: true })
      .selectOption("1");
    await dialog
      .getByRole("button", { name: "Confirm answer", exact: true })
      .click();
    await page
      .getByText("User selected: 2. Command line", { exact: true })
      .waitFor();
    await composer.fill("official-questionnaire");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await dialog.getByText("Which scope?", { exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Answer", exact: true })
      .selectOption("other");
    await dialog
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill("Native WebView callbacks");
    await page.screenshot({
      path: ".local/screenshots/native-official-questionnaire.png",
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Submit answers", exact: true })
      .click();
    await page
      .getByText("Q2: user wrote: Native WebView callbacks", { exact: false })
      .waitFor();
    await composer.fill("official-todo-add first");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByText("Added todo #1: First task", { exact: true })
      .waitFor();
    await composer.fill("/todos");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await dialog
      .getByRole("cell", { name: "First task", exact: true })
      .waitFor();
    await page.screenshot({
      path: ".local/screenshots/native-official-todos.png",
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Close", exact: true })
      .press("Control+c");
    await dialog.waitFor({ state: "hidden" });
    await composer.fill("/qna");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await dialog
      .getByRole("progressbar", {
        name: "Extracting questions using desktop-test",
      })
      .waitFor();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        (document.querySelector('[aria-label="消息"]') as HTMLTextAreaElement)
          ?.value === "Q: Which desktop controls should be used?\nA: ",
    );
    await composer.fill("/qna");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await composer.fill("/status warn Native provider status");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page
      .getByText("[WARN] Native provider status", { exact: true })
      .waitFor();
    const openInspector = page.getByRole("button", {
      name: "打开检查器",
      exact: true,
    });
    if (await openInspector.isVisible()) await openInspector.click();
    await page.locator('input[name="expand-tools"]').press("Space");
    await page.getByRole("button", { name: "关闭检查器", exact: true }).click();
    await page.getByText(/\[WARN\] Native provider status\s+at /).waitFor();
    await page.screenshot({
      path: ".local/screenshots/native-official-workflows.png",
      animations: "disabled",
    });
    await verifyDefaultEditor(
      page,
      ".local/screenshots/native-default-editor.png",
    );
    await verifyModalEditor(
      page,
      ".local/screenshots/native-official-editor.png",
    );
    await verifyComponentMapping(
      page,
      ".local/screenshots/native-component-library.png",
    );
    await sdkAction(page, "prompt", { message: "/mapped-layout-pointer" });
    const layoutDialog = page.getByRole("dialog");
    const rightColumn = layoutDialog.getByRole("textbox", {
      name: "Right column",
      exact: true,
    });
    await rightColumn.hover();
    await page.mouse.wheel(0, 20);
    await expect(rightColumn).toHaveValue("Right original wheel");
    await expect(
      layoutDialog.getByRole("textbox", { name: "Left column", exact: true }),
    ).toHaveValue("Left value");
    await layoutDialog
      .getByText("Shared layout target", { exact: true })
      .nth(1)
      .click();
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<
          import("../shared/types.ts").DesktopSnapshot
        >(page!, "snapshot");
        return JSON.parse(
          snapshot.statuses["layout-shared-pointer"] ?? "[]",
        ).filter((event: { type: string }) => event.type === "click").length;
      })
      .toBe(1);
    await layoutDialog.locator(".desktop-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight - element.clientHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await layoutDialog
      .getByText("Clipped layout row 12", { exact: true })
      .hover();
    await page.mouse.wheel(0, 20);
    await expect
      .poll(async () => {
        const snapshot = await sdkAction<
          import("../shared/types.ts").DesktopSnapshot
        >(page!, "snapshot");
        return JSON.parse(
          snapshot.statuses["layout-row-12-pointer"] ?? "[]",
        ).filter((event: { type: string }) => event.type === "wheel").length;
      })
      .toBe(1);
    await page.screenshot({
      path: ".local/screenshots/native-component-hit-path.png",
      animations: "disabled",
    });
    await sdkAction(page, "abort");
    await verifyMappedEditorTransactions(
      page,
      ".local/screenshots/native-mapped-editor-transactions.png",
    );
    await verifyMappedPasteBlocks(
      page,
      ".local/screenshots/native-mapped-paste-blocks.png",
    );
    await verifyMappedComposition(
      page,
      ".local/screenshots/native-mapped-composition.png",
    );
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    await verifyMultilineReplacement(
      page,
      ".local/screenshots/native-input-replacement.png",
    );
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Desktop action is unavailable" }),
    ).toHaveCount(0);
    await verifySdkAuth(page, ".local/screenshots/native-sdk-auth.png");
    await verifyComponentWindow(page);
    await verifySdkThemes(page, ".local/screenshots/native-sdk-themes.png");
    await verifySystemThemes(
      page,
      ".local/screenshots/native-sdk-system-themes.png",
    );
    console.log(
      "Native Tauri WebView2 + bundled Node + real Pi SDK tools, inspection, extension forms, keys, transcript renderers, overlay, official questions, Todo, Q&A, status, modal editor, standard component mapping, layout pointers, SDK auth and native window title/progress workflows passed.",
    );
    await sdkAction(page, "sdk.run", {
      path: join(fixture.agentDir, "desktop", "enable-modal-editor.mjs"),
    });
    await expect(page.getByText("INSERT", { exact: true })).toBeVisible();
    await composer.fill("");
    await expect(composer).toHaveValue("");
    await expect
      .poll(() =>
        sdkAction(page!, "sdk.run", {
          path: join(fixture.agentDir, "desktop", "editor-action.mjs"),
          args: { action: "read" },
        }),
      )
      .toBe("");
    await composer.press("Control+d").catch((error) => {
      if (!page?.isClosed()) throw error;
    });
    const deadline = Date.now() + 8000;
    while (child.exitCode === null && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (child.exitCode !== 0)
      throw new Error("Ctrl+D did not close the native desktop cleanly");
  }
} catch (error) {
  console.error("Native workflow failure:", error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: ".local/screenshots/native-failure.png", timeout: 3000 }).catch(() => {});
    console.error("Native UI state:", await page.locator("body").innerText({ timeout: 3000 }).catch(() => "Unavailable"));
    console.error(
      "Native focus state:",
      await page.evaluate(() => ({
        active: document.activeElement?.outerHTML.slice(0, 1000),
        focused: document.hasFocus(),
      })),
    );
    if (process.argv.includes("--component-overlays")) {
      const snapshot = await sdkAction<
        import("../shared/types.ts").DesktopSnapshot
      >(page, "snapshot");
      console.error(
        "Native overlays:",
        snapshot.desktopSurfaces.map(({ id, overlay }) => ({ id, overlay })),
      );
    }
    console.error(
      "Native QA actions:",
      (await readFile(tracePath, "utf8").catch(() => "No actions recorded"))
        .split("\n")
        .filter(
          (line, index, lines) =>
            line.includes('"failed"') || index >= lines.length - 20,
        )
        .join("\n"),
    );
  }
  throw error;
} finally {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page)
      await page
        .evaluate(async () => {
          const tauri = (
            window as unknown as {
              __TAURI_INTERNALS__: {
                invoke: (command: string, args?: unknown) => Promise<unknown>;
              };
            }
          ).__TAURI_INTERNALS__;
          await tauri.invoke("plugin:window|close", { label: "main" });
        })
        .catch(() => {});
    await browser.close().catch(() => {});
  }
  const exit = new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  await Promise.race([
    exit,
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  if (child.exitCode === null) child.kill();
  await mcpPeer?.close();
  await fixture.close();
}
