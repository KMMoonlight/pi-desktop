# Native application content

Pi 1.0.0 remains pinned and unmodified. The desktop application owns one shared native application tree per workspace. Its header, resource sections, pending messages and widget regions now use original Pi components rather than simplified Text substitutes.

## Construction and ownership

`backend/component-runtime.ts` uses an isolated receiver of the original InteractiveMode prototype. Original `showLoadedResources`, `updatePendingMessagesDisplay`, `setExtensionWidget` and `renderWidgetContainer` construct these regions. The receiver resolves the current original session, settings and session manager; it does not initialize extensions or create another session.

BuiltInHeader and ExpandableText are private classes in InteractiveMode. To obtain the original builtin header, the receiver runs the original init construction segment and exits at the first completed-header requestRender boundary. Signal registration, renderer mounting/start, theme initialization and changelog retrieval belong to the desktop host or separate startup policies and are suppressed on this extraction receiver. Execution stops before managed-tool installation, session rebinding and startup message rendering. No SDK source, exports or prototypes are changed. This boundary depends on Pi 1.0.0 and must be reviewed when upgrading; a missing constructed header throws an explicit compatibility error.

The original header retains compact/expanded help, configured key hints, theme regeneration, capability-based logo behavior and its original logo callback. Quiet startup modes construct the same original header or empty Text as Pi. Custom headers replace the middle occurrence and preserve surrounding original spacers. Ordinary session/resource resets retain the builtin header identity. Full CLI startup, changelog presentation, managed-tool setup and platform-specific logo animation verification are separate completion targets.

## Resources and pending messages

Resource sections call Pi's original path/scope/package grouping, collapsed and expanded listings, hidden-extension policy and diagnostic construction. The resource signature includes original context/system/append sources, skills, prompts, themes, extension metadata/errors/warnings, registered command and shortcut diagnostics, quiet startup and explicit display options. Unchanged snapshots retain original component instances and direct changes. Expansion and theme invalidation use original component methods. `ApplicationContent.showResources` exposes original force and quiet-diagnostic options to backend SDK operations without requiring another desktop control.

Pending rows use the original Spacer, TruncatedText and dequeue-key hint. SDK steering/follow-up queues and optional compaction input combine through the original method. Unchanged queues retain component identity and direct text mutations. Theme invalidation reconstructs these rows because their constructor strings contain ANSI colors. Queue truncation follows the available native width.

Normal desktop conversation/queue/resource views retain their React presentation. The shared native tree exposes these original components to SDK operations, and the verification fixture mounts the same objects through public generic header/widget factories to exercise desktop mapping. No adapter is selected by extension name.

## Widgets and retirement

String widgets call the original setExtensionWidget implementation: a Container holds up to ten Text rows and the original themed truncation marker. Desktop ANSI presentation renders that original container; source arrays are copied so later caller changes do not silently alter the stored widget. Direct changes to the original child Text remain visible.

An ordered Map combines string and factory widgets, including numeric string keys. React consumes that explicit order, preserving placement and mixed string/control order. Original renderWidgetContainer supplies the above-editor leading/default spacer and the below-editor region without a spacer. Factory components remain owned by the existing desktop registry and are neither invoked nor disposed again by ApplicationContent. Repeated keys that return the same original object retain their native occurrence count; unrelated directly registered children survive application updates.

Ordinary resets clear widgets, resource sections and pending rows while retaining the shared application owner/header. Hard retirement attempts every string cleanup and clears content even when cleanup throws. Already retired content cannot reconstruct or present rows. Standard components map to desktop controls; opaque custom output and raw terminal programs continue to use xterm.js and the existing PTY path.

## Evidence

Source cases compare unchanged original constructors and render output at several widths, all quiet/force modes, expansion/theme/direct mutations, queue merging, widget bounds/ANSI/order/placement, repeated shared occurrences, session reset and throwing cleanup. Browser and native workflows cover header/resources/pending/widgets through the same generic SDK probe. Grouped evidence establishes 1135 distinct passing source cases (full repair run 1134/1135 plus final affected group 101/101), 55 distinct passing affected browser cases (42/44, 17/19 and final 6/6 with overlap), and five native groups/eighteen workflows against one unbundled build. Type checking, SDK identity audit and formatting pass. Exact failed-run boundaries and source/artifact/log/screenshot hashes are recorded in `.local/application-content-receipt.json`. No fresh final fully green complete source/default browser suite or installer rebuild is claimed.

This category does not establish full SDK completion, automatic future-version compatibility, arbitrary private ownership or geometry, all terminal protocols, physical OS input, external-account behavior or installed-copy behavior.
