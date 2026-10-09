# Pi Desktop — 开发与兼容性说明

A graphical Pi Agent workspace built with Tauri 2, React 19, Tailwind CSS 4 and the official Pi SDK. The application uses `@earendil-works/pi-coding-agent@1.0.0`; it does not contain a fork of Pi. Standard components map to desktop controls; xterm.js and a real PTY support terminal-dependent extensions. Resource reload and session changes retain the original shared TUI, default editor/history and direct registrations; see [the lifecycle contract](runtime-lifecycle.md). Original regular/fullscreen renderers now supply native redraw, viewport and lifecycle state through a desktop drawing backend; see [renderer modes and terminal ownership](renderer-modes.md).

Native cache-warming/cache-miss, summary billing and dropped-thinking notices use Pi's original policies and components; see [the notice contract](conversation-notices.md). The pinned SDK integration is complete within [the agreed acceptance scope](sdk-acceptance.md); evidence and explicit compatibility boundaries are in [the completion review](sdk-completion-review.md).

Original builtin header, resource grouping/diagnostics, pending queue hints and bounded string widgets now populate the shared native tree; mixed factory/string widgets retain Pi order. See [native application content](application-content.md).

The desktop interface follows [Design.md](../Design.md): warm cream surfaces, coral
primary actions, serif display headings, and dark code/terminal surfaces. Native
React controls in `src/primitives.tsx` provide buttons, switches, tooltips, and
focus-managed dialogs without a component framework. `src/tailwind.css` owns the
Tailwind entry point and shared tokens; feature styles are in the components layer
so utility classes remain authoritative. SDK colors and original input handlers
remain separate from application chrome.

## Run

Development requires Node.js 22 or newer and npm. Native development and builds also require Rust, Microsoft C++ Build Tools and WebView2 on Windows.

```sh
npm ci
npm run dev
```

On macOS, the postinstall step restores executable permissions on node-pty's
`spawn-helper`. If dependencies were installed with lifecycle scripts disabled,
run `npm run postinstall` before starting the app. Runtime staging applies the
same repair to packaged dependencies.

Open http://127.0.0.1:1420. This preview uses the real SDK through a local HTTP/SSE host. For the native window, stop the preview and run:

```sh
npm run desktop:dev
```

`desktop:dev` starts Vite and a separate SDK process through the Rust host. It does not start the preview HTTP server.
It applies `src-tauri/tauri.dev.conf.json` to omit bundled runtime resources:
development uses the local Node installation and backend source, so no `runtime/`
directory or `runtime:stage` step is required. Release builds still stage and
bundle the runtime through `beforeBuildCommand`.

Starting the service does not select its working directory as a workspace.
The app restores the last explicitly selected workspace and its last opened session,
or shows the open-workspace screen on first launch. If no last-opened record exists,
it continues the most recent session in that workspace. Without history, it shows
an empty workspace without adding a session. A session is saved only after the
user explicitly creates one or sends a message. `PI_DESKTOP_CWD` can explicitly select an initial workspace.
Legacy automatic workspace selections are not restored.
Global settings, provider credentials, model defaults, MCP configuration and
package management are available before opening a workspace. Project settings
and live MCP connection operations become available after a workspace is selected.
The sidebar groups only explicitly registered workspaces; older automatic entries
and unrelated session history do not add workspace groups. Session files are retained.
Use the remove button beside a workspace's new-session button to remove it from
the sidebar. Local files and saved sessions are kept and return when the workspace
is added again. Removing the active workspace selects another available workspace;
removing the last one returns to the open-workspace screen, including after reload.

```sh
npm run desktop:build
```

Build on the target platform with its native Node and Rust toolchains:

| Platform | Output under `src-tauri/target/release/bundle/` |
| -------- | --------------------------------------------- |
| Windows x64 | `nsis/Pi Desktop_*_x64-setup.exe` |
| macOS Apple Silicon | `macos/Pi Desktop.app` and `dmg/Pi Desktop_*_aarch64.dmg` |

The build stages Node and the SDK dependency tree into `runtime/` and includes
them in the installer. Installed users do not need a global Pi or Node
installation. Windows still needs the WebView2 runtime; the Tauri installer uses
its standard WebView2 bootstrap flow if necessary. Runtime staging uses the host
architecture, so build each architecture on its corresponding runner rather than
cross-compiling only the Rust binary.

Runtime staging checks the bundled Node, SDK, native PTY and backend protocol
before packaging; a missing backend dependency fails the build. Run
`npm run runtime:verify` to repeat that check after building. To verify the
runtime copied into a macOS app, run:

```sh
npm run runtime:verify -- 'src-tauri/target/release/bundle/macos/Pi Desktop.app/Contents/Resources/runtime'
```

The **Desktop installers** GitHub Actions workflow builds Windows x64 and macOS
Apple Silicon separately and uploads installer packages as artifacts retained for 14 days. Trigger it manually on a branch containing
the workflow, push a `codex/package-*` branch, or push a `v*` version tag. These are test packages without
configured distribution signing or Apple notarization; production signing must
be configured before public distribution.

App icons use the Pi Agent mark on a rounded, transparent canvas. Edit
`src-tauri/app-icon.svg`, then run `npm run icons` to regenerate the desktop PNG,
Windows ICO and macOS ICNS assets. Rebuild the desktop app to apply icon changes.

Features that launch external programs still require those programs: Git for diffs and Git packages, npm (or Pi's configured package manager) for npm package installation, and the shells or executables named by tools and MCP server configuration. The installer does not include these external tools.

## Workflows

- Workspace groups in the sidebar, with conversation search, local pins and a separate new-session action per project. A delete button beside the pin removes a conversation after confirmation; deleting the active conversation opens the most recent one in the same workspace, or an unsaved empty state if none remain. Adding a directory registers it and opens the workspace; cancellation keeps the current session and draft.
- Streamed Markdown, thinking, tool calls, tool output, images, stop, steering and follow-up queues.
- Conversation tree navigation, branch summaries, labels, forks, cloning, renaming, HTML/JSONL export and JSONL import.
- Workspace file browsing, image/text preview, file attachments and staged/unstaged Git diffs. Files & changes and the conversation tree each fill the central workspace; opening a message's file link selects Files & changes, and returning to chat preserves the composer draft.
- Models, thinking levels, tool selection, context usage, compaction and usage costs in the conversation inspector.
- Provider API key/OAuth login, model scope, global/project settings, MCP configuration and package management in settings.
- Extension commands, skills, prompt templates, resource diagnostics and reload in Settings → Extensions & skills.
- Standard extension dialogs, notifications, text widgets, status entries and editor updates mapped to desktop UI.

Consecutive model responses and tool calls in a turn share one assistant reply, one elapsed-time/token summary and one copy action. Tool activity is presented as compact, expandable steps; the group and standard tool details collapse when the reply settles, including failed outputs, and can then be reopened manually. Custom interactive tool renderers keep their controls. Elapsed time includes time spent in tools and is restored from Pi’s assistant start/completion timestamps when loading history. A single composer action shows Stop while running with no input and Send when text or attachments are present. The running-message preference (steer or queue) lives in Settings → General and is stored locally for this app.

Message timestamps appear before the copy button when hovering the message content (or focusing its controls with the keyboard). Thinking blocks collapse automatically when a streamed reply completes and remain manually expandable. Context usage, live output speed and cumulative input/output tokens appear in a separate row below the composer. Output speed appears only during generation. Token counts come from Pi's usage; speed measures the time from first nonempty output, including reported thinking/tool-call tokens. When a provider reports usage only on completion, the live speed uses Pi's content-based estimate and displays ≈; this estimate never changes cumulative token counts. Responses without valid start/completion timestamps show token counts only. “运行 Shell 命令…” runs one command in the current workspace and records its output in the conversation for subsequent model context; the docked terminal opens an interactive shell in the selected workspace (the configured user shell on Unix, PowerShell on Windows). Closing the panel preserves the shell; switching workspaces creates a new shell on next use. The “Pi 扩展” terminal remains available for inherited extension subprocesses and is selected automatically when an extension requests terminal input.

See [the feature mapping](feature-mapping.md) for the integration boundaries.

## Configuration

The desktop interface supports Simplified Chinese and English. Select the language
under **Settings → Appearance → Interface language**; it applies immediately and
is saved locally without changing Pi configuration. Conversations, user-defined
names, paths and original extension content retain their source text. See
[interface localization and UI verification](interface-localization.md).

Under **Settings → Appearance → Fonts**, search fonts installed on this device and
choose separate interface and code/terminal fonts, or enter a family name manually.
Each font selector also accepts text to filter its own list. Changes preview immediately, update
open terminals and are saved on this device across restarts. Choose **App default
font** to restore the original font stack. Missing fonts or glyphs use fallbacks.
Font discovery uses macOS System Profiler, Windows' system font collection, or
Fontconfig (`fc-list`) on Linux, and works before selecting a workspace.

The application uses Pi's normal agent directory, credentials, settings and session format. On Windows, the default agent directory is `%USERPROFILE%/.pi/agent`. Project resources are loaded after project trust is granted. The configured `sessionDir` is honored. Back up existing data before sharing it with a different Pi version; compatibility with every historical Pi/extension release is not guaranteed.

Optional environment variables:

| Variable               | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `PI_CODING_AGENT_DIR`  | Pi's standard agent directory override                                            |
| `PI_DESKTOP_AGENT_DIR` | Override the desktop SDK host's agent directory, including built-in MCP discovery |
| `PI_DESKTOP_CWD`       | Initial workspace when no saved workspace is selected                             |
| `PI_DESKTOP_PORT`      | Preview backend port, default `4319`                                              |

Global and project settings are shared with Pi. Appearance, conversation pins and input drafts are stored locally by the frontend. Recent workspaces are stored in `desktop.json` in the agent directory; the last opened session for each workspace is stored in `desktop/active-sessions.json`. Node inherits the application's environment; credentials that only exist in another shell are unavailable until supplied to this process or stored through Pi.

## Extension Compatibility

The SDK host supplies `ExtensionUIContext` and reports `ctx.mode === "tui"` so interactive extensions reach the converted UI APIs. Pi has no desktop mode. The desktop uses its own transport. An outer Node supervisor owns a real PTY for the SDK worker; terminal I/O remains responsive during synchronous extension subprocesses.

Standard `select`, `confirm`, `input`, `editor`, notification, status, text widget and editor-text APIs work through React controls. SDK access also lets the host implement editor reads, text insertion and tool expansion state.

`custom()`, component widgets, headers/footers/editors and tool/message/entry renderers use a generic component bridge. It runs original factories and maps all 17 standard pi-tui component types plus Pi's `CustomEditor`, `BorderedLoader`, `DynamicBorder` and `VisualLinePreview` into desktop inputs, selectors, text, images, layouts, scrolling, pointer regions and progress controls. Original component instances, callbacks, subclass input logic and cleanup remain active. This path does not identify extensions by name or source hash. See [component mapping and remaining limits](component-mapping.md).

Direct `tui.showOverlay()` calls also create desktop surfaces through that bridge. Stacked overlays retain their original focus handles and callbacks, including input awaited before the parent factory returns. Direct overlays and `addChild` registrations belong to the shared generation and survive their creating factory until explicitly removed or the generation ends.

Default and mapped editors use browser-measured visual rows and caret positions for wrapped text, proportional fonts, vertical movement, paging and Shift selection. The shared component bridge retains Pi's original input handlers, history, callbacks and atomic paste segments. Pi's history and page-boundary rules remain active; bidi caret affinity and arbitrary custom geometry still require validation.

The default composer uses an original SDK CustomEditor through the generic bridge, retaining its object/history/configuration across custom-editor replacement. Seven native Container roots contain original user/assistant/summary/skill messages, complete tool rows, live/completed bash rows, a shared FooterComponent/provider, status indicators and host notice components. Public SDK bash calls retain original live-to-persisted object identity. Original header/resources, pending queue and string-widget components also populate the shared tree. Normal chat keeps its React presentation; see [application content](application-content.md) and [the SDK acceptance scope](sdk-acceptance.md).

Native text insertion containing newlines or other control bytes, including committed composition text, uses Pi's bracketed-paste path. Whole/cross-line selection replacement, original callbacks and a single undo are preserved. Default and custom mapped editors retain Pi's multiline state, normalization and large-paste previews.

Selected Backspace/Delete also reaches the original component input handler. Consumed keys retain their text/selection; delegated deletion uses the shared component bridge and one original undo transaction. This behavior is verified with ordinary extension subclasses rather than extension-specific adapters.

Factories' `tui.terminal.setTitle()` and `setProgress()` map to the native window title and taskbar/dock progress indicator. Direct TUI setters share generation-wide last-writer state; opaque/PTY output effects retain their separate owners. `ctx.ui.setTitle()` also updates the actual native window, and title/progress state is retained in snapshots for reconnecting clients.

Theme settings, native SDK helpers and desktop CSS tokens share the active theme. System themes and automatic light/dark pairs follow desktop appearance changes; fixed themes and direct instances retain their selection. Named custom themes watch their source files, survive atomic replacement and retain the last valid colors during invalid edits. Reload, replacement and disposal release old watchers. The appearance selector uses the same SDK theme API.

Standard `Text` and `TruncatedText` retain ANSI colors and compound decorations as structured desktop spans. Pi supplies palette conversion and OSC 8 link parsing; HTTP/HTTPS links open through the desktop's existing link handler. `Text` and `Box` background callbacks cover their native content/padding areas. Markdown reuses Pi's parsed tokens, source options, original theme functions and code highlighting to produce desktop headings, lists, quotes, tables and code blocks. Terminal-only heading prefixes are omitted in DOM headings, and dividers use the desktop theme’s subtle border color. Defaults and inline ANSI retain their styling/reset behavior. Component updates retain their original callbacks. Cursor/title/image escape instructions in text are discarded, and literal HTML stays text.

Desktop Markdown also retains inline code, reference/autolinks, hard breaks, strikethrough, nested mixed lists and GFM task states. Unordered lists use muted round bullets; ordered list columns align across different digit counts. Character references decode once in text and link destinations without reparsing source or changing code/copy contents. Markdown images support HTTP(S), raster data URLs and files within the current workspace (through the existing size/path-bounded file reader), with the same fit-to-image preview as pasted attachments. Unsupported image sources fall back to their label or file link. Pi’s existing math/Mermaid transforms remain in place; footnotes and arbitrary HTML execution are not added.

Input prompts and placeholder transformations, editor/border colors, selection themes and settings label/value/description themes use the same component bridge. Display labels are separate from the original option values; selection/change/cancel callbacks keep those original values. Unstyled options retain their own default color when selection changes. Loaders retain message styles, custom indicators and cancellation. Status text, working messages and string widgets share structured text styles and links while retaining their raw SDK values. Mixed option/placeholder styles and links use structured desktop controls; portalled menus retain the original component's keyboard and pointer routing.

Render-only components that provide character-art strings without standard component structure use an xterm.js fallback with the original input handlers and result callbacks. Custom terminal drawings and decorations added only to rendered lines are not inferred as semantic desktop elements. xterm.js supports its documented terminal protocols; arbitrary terminal/image protocols are not universally supported. See docs/terminal-compatibility.md. The older six example-specific presentations are disabled by default and retained as opt-in regression support through `legacyExampleAdapters: true` or `PI_DESKTOP_LEGACY_EXAMPLE_ADAPTERS=1`. Native adapter registration remains available for explicitly supplied presentations.

SDK access removes some official RPC interface limits. It does not guarantee full extension UI compatibility or automatic compatibility with future SDK releases. The app pins its SDK independently of the user's CLI, so upgrading the global CLI does not replace this application's runtime. SDK upgrades still require updating and testing the desktop integration.

Pi's original fd/rg preparation now feeds the native editor's recursive/scoped @file completion. Explicit retries preserve extension completion wrappers; preparation, lookup and status inspection are available through the SDK context and private transport without a UI control. See [managed tools and completion](managed-tools.md). Verification follows whole categories, with consolidated repairs and affected-group reruns.

Original startup/full changelogs, sequential initial messages/images and startup diagnostics are available through the SDK context and private transport. Accepted session transitions stop the startup batch at native cancellation, while cancelled transitions retain it. See [startup inputs and content](startup.md).

Original background catalog/version/package/tmux checks, subscription warnings, crash records and bug hints are available through the SDK context and private transport. Fatal worker exit closes its supervisor after event drain while ordinary terminal history stays inspectable. See [startup policies](startup-policies.md).

The complete SDK namespace and live runtime objects are available to native modules through `DesktopHost.sdk` and `withSdk()`. Callback-based construction can be customized through a runtime factory, and trusted desktop modules can be invoked over the private transport. See [the SDK support audit](sdk-support.md) for usage, newly exposed operations, verification and remaining work. Full SDK desktop support is an active implementation goal, not a completed compatibility claim.

## Verification

Implement one functional category before running its source/browser/native verification groups. Collect each group's failures, repair them together, then rerun the affected groups. Broaden or repeat verification when new changes, failures or unresolved concerns justify it. Browser groups that share a backend run with one worker; native groups run sequentially.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:ui
npm run desktop:build
npm run test:native
```

Integration tests use the real Pi SDK with an isolated agent directory and a local OpenAI-compatible test server. They cover streaming, tools, attachments, sessions, drafts, queues, cancellation, private transport, native SDK access and the standard component bridge. Browser workflows validate native controls at desktop/narrow sizes. Native QA connects Playwright to the built Tauri WebView2 and uses the bundled Node and SDK. The older example presentations are enabled explicitly for their regression tests; they do not establish generic extension compatibility.

Real provider OAuth accounts, paid model requests, external MCP services and third-party packages need validation against their actual services. Their controls are implemented, but they are not claimed as tested against every provider or extension.

`npm audit` currently reports an inherited high-severity denial-of-service advisory in `brace-expansion@5.0.9`, bundled inside Pi SDK 1.0.0. Root npm overrides and `npm audit fix` do not replace that bundled copy. The application does not patch Pi's installed source. This remains an upstream dependency issue to resolve before a public release.
