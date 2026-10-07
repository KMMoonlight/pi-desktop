# Background startup policies

`DesktopSdkContext.startupPolicies` supplies the background behavior normally
started by Pi's InteractiveMode: model-catalog refresh, Pi version checks,
extension-package update checks, tmux keyboard diagnostics and Anthropic
subscription-auth warnings. `run(name, signal?)` returns the native result;
`runTransport` and `startup-policy.run` convert catalog error Maps into provider,
message and stack records for JSON. Inspection returns isolated job state and the
last serializable result. These functions require an initialized workspace and
do not require a new UI control.

Initial workspace startup launches catalog/version/package/tmux checks once and
starts subscription checks after synchronous startup warnings. Same-workspace
reconnection does not repeat them. Current model and cached auth-status changes
can trigger the native subscription check; its warning flag survives ordinary
session/resource resets. A new workspace receives a new native receiver. Settings,
credential type, subscription-key detection, auth lookup failures and one-time
warning behavior use the original Pi method. A retired auth result cannot consume
the successor's warning flag.

Catalog refresh uses Pi's original shared coordinator, retains independent waiter
cancellation and the 15-second startup timeout, and preserves the original result
object for SDK callers. Native version checking retains its semver validation,
user agent, request timeout, skip-version flag and failure suppression. Package
checking uses the original DefaultPackageManager with the hosted cwd/agent
directory/settings, returns original display names and suppresses failures like
InteractiveMode. Tmux checking invokes the original two-process, bounded query.
Any nonempty `PI_OFFLINE` value suppresses catalog/version/package network checks,
including `"0"`, following Pi. Windows package completion restores the original
Pi title while its initiating session is current. Footer provider counts follow
the original scoped-model rule.

Checks join the host lifecycle drain. Catalog cancellation reaches its original
coordinator. The native version/package/tmux interfaces do not accept a host
AbortSignal; their existing work settles before the hosted operation completes.
Cancelled, reloaded, replaced or disposed owners cannot append late notices or
overwrite successor job state. Native callbacks that ignore cancellation retain
their original limitations. `PI_DESKTOP_SKIP_STARTUP_POLICIES=1` suppresses only
automatic scheduling; ordinary test fixtures set it, and isolated policy workers
explicitly opt in. Explicit calls retain native policy gates.

Version/package/warning/bug-report notices are constructed by original
InteractiveMode methods, preserving Spacer, DynamicBorder, ThemedText and
Markdown instances for the generic desktop component mapper. No extension-specific
adapter is used. Opaque components and raw terminal programs still use xterm.js.

Crash persistence, retention, age filtering, newest-record selection,
announcement and deletion use Pi's original crash-log utilities with an explicit
path inside the host's agent directory. Crash startup notices follow ordinary
diagnostics and precede initial inputs. SDK server uncaught exceptions preserve
session/cwd/stack information, print the original extension hint/report
instructions, kill Pi's tracked detached children and exit with code 1. The next
startup announces recent unannounced records. Assistant errors invoke the
original retry/cancellation filters and one-time `/bug` hint.

Fatal worker exit flushes an explicit shutdown event to the authenticated native
channel before termination. The desktop supervisor drains that event and waits
for the worker to exit before closing. Ordinary terminal exit keeps its history
available for inspection until the desktop host is shut down.

| Action                   | Arguments                                                                    | Result                                                            |
| ------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `startup-policy.inspect` | None                                                                         | Automatic-start flag and per-check state                          |
| `startup-policy.run`     | `name`: catalogs/version/packages/tmux/subscription; optional operation `id` | Native policy data with JSON catalog errors                       |
| `crash.read`             | None                                                                         | Original retained crash records                                   |
| `crash.take`             | Optional `display`, finite `now`                                             | Newest recent unannounced record; marks pending records announced |
| `crash.clear`            | None                                                                         | Clears the host crash file                                        |
| `crash.record`           | Native `kind`, `error` or string `message` and optional `stack`              | Persisted native record or undefined                              |
| `crash.hint`             | `error` or string `message` and optional `stack`                             | Original loaded-extension hint                                    |
| `crash.instructions`     | None                                                                         | Original report instructions for the current session              |

The SDK class also exposes `recordCrash`, `readCrashes`, `takeCrash`, `clearCrashes`,
`crashHint` and `crashInstructions`, retaining Error/function-rich values in Node.
Private native access stays behind a version gate for the pinned Pi 1.0.0 SDK;
SDK source, exports and prototypes are unchanged. Automatic compatibility with
future versions is not inferred from current tests.

Verification follows whole categories: one grouped source/type/browser run,
consolidated repairs and affected-group reruns, then one build and grouped native
workflows. Real remote/account interactions and installed-copy behavior retain
their separate verification limits. Current evidence is in the support log.
