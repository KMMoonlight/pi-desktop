# Startup content and initial inputs

The desktop exposes invocation inputs through `DesktopStartup`, available as
`DesktopSdkContext.startup`. A host can receive options in its constructor's
`startup` field or as the second argument to `initialize(cwd, options)`. The
private transport accepts them under `initialize.args.startup`. Reconnecting to
an already initialized workspace returns its snapshot and does not repeat the
initial messages. Constructor launch options apply to the first successful
initialization; a later invocation can call `startup.run` explicitly.

Supported invocation fields retain their Pi SDK types: `initialMessage`,
`initialImages`, `initialMessages`, `startupDiagnostics`, `migratedProviders`,
`modelFallbackMessage` and `verbose`. Verbose initialization is supplied to the
original builtin-header receiver before construction and overrides original
quiet startup. The four layout/theme/terminal/implicit-trust fields are documented
in [invocation options](invocation-options.md); together these cover all eleven
native initialization fields. Background policies are documented in
[startup policies](startup-policies.md).

Initial inputs call the current original `AgentSession.prompt` sequentially. A
truthy first message receives its image options; subsequent messages receive the
original single-argument call, including an explicitly empty string. Native
prompt-template/extension/provider behavior remains in the SDK. Thrown Errors
produce their message, other thrown values produce `Unknown error occurred`, and
the next initial message continues, matching `InteractiveMode.run`. `completed`
counts resolved SDK prompt calls; the SDK's message/error events still describe
model results. Runtime diagnostics and model fallback are used when no explicit
override is supplied. Diagnostic order, credential-migration wording and model
configuration warnings follow native startup behavior and use existing native
notice rows.

Only one initial-input run may be active. Direct calls accept an AbortSignal;
transport calls accept an operation `id` and join `sdk.cancel`. Shutdown, resource
reload and session retirement abort the current native prompt, prevent remaining
initial messages, suppress obsolete errors, and join the host's lifecycle drain.
Original session objects and authorization callbacks remain active until that
work settles. An extension/provider that ignores native cancellation can still
delay shutdown, as with other native SDK operations.

An active batch observes the hosted instance's public `session.abort()` boundary.
Accepted new/switch/fork/import operations stop the batch before awaiting native
shutdown handlers; those handlers keep their session lifetime until Pi invokes
its original invalidation callback. Cancelled transitions and validation failures
leave the batch running. Direct SDK abort also stops the batch. The temporary
observer preserves the original abort receiver, Promise and error, and restores
its owned descriptor after settlement without overwriting later replacements.

The original `getChangelogForDisplay`, `showStartupNoticesIfNeeded` and
`handleChangelogCommand` run on the existing isolated InteractiveMode receiver.
Fresh startup records Pi's current version without showing entries, resumed
sessions preserve their version, and upgrades use native filtering and normalized
links. The original collapse setting, Spacer/Text/ThemedText/DynamicBorder/Markdown
instances and one-time notice flag remain authoritative. A full changelog request
uses the original command's ordering and markup without changing the last-seen
version. Ordinary session/resource resets clear chat notices and preserve the
workspace's already-consumed startup flag; a new workspace creates a new receiver.

Changelog version reporting uses the original SDK install-telemetry policy,
including its settings, `PI_TELEMETRY`, nonempty `PI_OFFLINE` gate, user agent and
bounded request. Integration workers record that request locally and isolate the
agent directory before SDK import. General test fixtures disable install telemetry
and start with the pinned version. No actual telemetry endpoint exchange is used
as verification evidence.

| Action              | Arguments                                             | Result                                                               |
| ------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `startup.inspect`   | None                                                  | Last run state, session, attempted/resolved counts and thrown errors |
| `startup.run`       | Options directly or under `options`, optional `id`    | A settled run snapshot, or original cancellation/rejection           |
| `startup.changelog` | Optional `kind: "startup" \| "full"`, `display: true` | Native markdown and component count                                  |

Direct `startup.changelog` returns the original component objects as well as raw
markdown, preserving functions for generic desktop factories. `display: true`
appends those objects to the shared native application tree. No new desktop
control is required. Verification maps the same original rows through a generic
Container widget; initial user/assistant/image messages use the normal desktop
conversation. Opaque components and raw terminal programs continue to use xterm.js.

This category uses one grouped source/type/browser validation, consolidated
repairs and affected-group reruns, followed by one native build and sequential
native workflow groups. Exact current evidence and remaining full-SDK requirements
are recorded in [the support log](sdk-support.md).
