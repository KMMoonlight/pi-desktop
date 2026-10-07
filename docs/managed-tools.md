# Managed tools and original file completion

The desktop host prepares `fd` and `rg` with the pinned Pi SDK's unchanged
`utils/tools-manager` implementation. Pi determines the managed binary directory,
PATH lookup (`fd`/`fdfind` and `rg`), release resolution, download, extraction,
offline policy and status wording. The desktop does not maintain another binary
installer or patch SDK sources, exports or prototypes.

Preparation happens before the initial editor binds. Its original `fd` result is
passed to Pi's `CombinedAutocompleteProvider`, enabling recursive and scoped
`@file` suggestions, native ordering and completion application. Resource reload
rebuilds the provider with the same prepared path. Session and workspace changes
keep the host-owned preparation state; editor/history continuity follows the
existing workspace runtime contract.

`DesktopSdkContext.managedTools` and these transport actions expose preparation
without requiring a UI control or an initialized workspace:

| Action                  | Arguments                | Result                                                                  |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `managed-tools.inspect` | None                     | State, prepared paths, original statuses and unexpected error           |
| `managed-tools.path`    | `tool: "fd" \| "rg"`     | Original current native lookup, or `null`                               |
| `managed-tools.prepare` | Optional `refresh: true` | Original prepared paths; unavailable results remain `undefined` in Node |

Concurrent callers join one preparation. Completed results are cached, including
unavailable tools; `refresh: true` explicitly retries preparation and updates the
current editor's provider. Unexpected loader/tool failures can be retried after
both native tool attempts settle. In JSON transport unavailable properties can be
omitted; inspection consistently represents unavailable paths as `null`.

Repreparation rebuilds the base provider while retaining extension wrapper
factories. Wrapper order, fresh rebuilding on registration and the merged trigger
characters follow original `InteractiveMode.setupAutocompleteProvider` semantics.
Resource/session resets clear those factories before extension startup, as Pi does.

Original managed-tool status rows use `InteractiveMode.showManagedToolStatus` in
the existing isolated application receiver. Their original Spacer/ThemedText
instances enter the shared native chat tree in callback order, including quiet
startup. Rows buffered before the first editor mount precede existing messages.
Adjacent ordinary informational notices cannot overwrite these rows. Standard
components map through the generic desktop bridge; opaque components and raw
terminal programs retain xterm.js.

Host retirement promptly rejects waiting preparation and path consumers and
suppresses late statuses and path adoption. **Pi's native downloader has no
cancellation interface:** an already running download/extraction may finish its
bounded cache operation after retirement. The desktop does not claim cancellation
of that native network/cache work.

Verification is grouped by category: complete implementation and fixtures first,
then collect source/type/browser failures, repair them together, and rerun the
affected groups. Native workflows run sequentially against one final executable.
Current exact evidence and remaining full-SDK requirements are in
[the support log](sdk-support.md). This category does not implement remaining CLI
changelog, initial-message or broader startup policies, and does not establish
compatibility with future SDK releases.
