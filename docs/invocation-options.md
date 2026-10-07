# Interactive invocation options

`DesktopStartupOptions` accepts all eleven fields of Pi 1.0.0's
`InteractiveModeOptions`. Supply them through `new DesktopHost(agentDir,
{ startup: options })` or `host.initialize(cwd, options)`. The seven message,
diagnostic and verbose options are documented in [startup.md](startup.md).

| Field                  | Behavior                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `tuiMode`              | Chooses the original regular/fullscreen renderer ahead of stored settings.                       |
| `initialThemeSetting`  | Chooses this invocation's named, system or automatic light/dark theme ahead of stored settings.  |
| `terminal`             | Supplies a live Node Terminal object, including its original methods and input/resize callbacks. |
| `autoTrustOnReloadCwd` | Enables Pi's original implicit-trust save policy after a successful resource reload.             |

Scalar options also work through `initialize.args.startup` in the private JSON
transport. A Terminal contains functions and must be supplied inside a Node SDK
operation or runtime module; JSON transport rejects it explicitly. `startup.run`
reruns the initial-input/notice batch, while renderer/theme/terminal/trust options
belong to workspace initialization.

Invocation layout/theme choices do not write settings. Reload, new/switch/fork/import
and reconnect retain workspace ownership. An explicit mode switch or successful
named theme selection replaces the current choice. `host.setThemeSetting(setting)`
and `theme.setting` apply an invocation theme setting without persistence; use
`SettingsManager.setTheme()` separately when persistence is intended. Successful
extension `ui.setTheme(name)` retains its existing saved-name behavior. Native
theme-selection methods run on an isolated original controller receiver; original
resource objects and the host's file watchers supply the actual desktop theme.
Automatic pairs follow desktop appearance, missing names fall back to the system
theme and report the failure, and in-memory themes remain independent of appearance
until settings are reapplied. The desktop system theme uses Pi's appearance-based
fallback. Exact terminal-palette and private-controller late-reply parity are
compatibility boundaries under [the current acceptance scope](sdk-acceptance.md).

A supplied Terminal starts and stops with its workspace renderer. Its physical
input joins the shared desktop keyboard/focus pipeline. Native device replies use
Pi's original color, appearance and cell-size parsers before keyboard dispatch;
color queries and appearance-notification requests reach the supplied Terminal.
Direct methods preserve the original receiver, result and rejection. Title and
progress also update desktop presentation without replacing the supplied object's
methods. Native diff frames remain in the desktop drawing backend. Mode switches
retain the stable public terminal reference, and retired renderer callbacks cannot
modify the successor. Other raw programs retain the existing xterm.js/PTY path.

Implicit trust runs Pi's unchanged `maybeSaveImplicitProjectTrustAfterReload` on
the application's isolated native receiver, using the hosted agent directory.
It saves only for the exact configured cwd, a trusted current session, newly
present trust-requiring project resources and no existing direct/parent decision.
Existing grants and denials consume the guard without being overwritten; a save
consumes it too. Missing resources, an untrusted session and failed writes retain
the guard for retry. Warnings use original Pi components. A new session keeps the
guard state; a successor workspace gets its own launch configuration.

Validation completes the category first, runs grouped source/browser/type checks,
repairs collected failures and reruns affected groups. Native checks reuse one
desktop executable. Exact logs, repair boundaries, backend restaging, hashes and
acceptance boundaries are recorded in [sdk-support.md](sdk-support.md).
