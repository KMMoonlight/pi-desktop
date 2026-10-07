# Shared renderer modes and terminal ownership

The desktop uses the pinned Pi 1.0.0 `createInteractiveTui` factory, original `TuiMainScreen`/`TuiAltScreen`, `createChatViewport` and `createInteractiveTuiReference`. Pi's original scheduler, diff renderer, full-redraw counter, regular capture/restore state and fullscreen viewport state execute against desktop cell geometry. Standard component presentation remains in the desktop UI; opaque component frames and raw extension programs use xterm.js.

## Renderer output

`RendererTerminal` gives native drawing/lifecycle operations a synchronous desktop terminal lease. During that lease, renderer escape sequences go to the desktop drawing sink; the renderer retains the authoritative frame, cursor and viewport state. Completed native frames refresh the existing desktop mapping endpoints. Renderer scheduling remains Pi's original next-tick/16ms coalescing and force-redraw behavior. Internal redraws do not activate the raw PTY panel.

Outside that synchronous lease, the same terminal reference delegates calls to the physical terminal, including `start`, `write`, movement, clearing, input draining and stop. Native desktop sessions use the original `ProcessTerminal` on the worker PTY. Async extension callbacks execute after the lease ends. Title/progress and terminal color queries retain the existing desktop presentation bridge. A source-only host without a PTY continues to reject unsupported physical terminal operations.

The drawing sink is a presentation backend, not a second visible full-app terminal. It does not emulate terminal/device replies. Existing PTY/query adapters handle those separately. The desktop cell geometry is distinct from the physical raw-program terminal size.

## Mode replacement

`desktop.terminalRuntime.capture().switchMode("regular" | "fullscreen")` is available to backend SDK operations without a visible mode selector. `applySettings()` applies `SettingsManager.getTuiMode()`, fullscreen scrollbar, copy-on-select and wheel-scroll settings. Initialization honors the stored mode.

Switching follows Pi's remount sequence: preserve children/focus/terminal/cursor/shrink/debug, capture regular render state, stop the old renderer with `preserveScreen`, clear its mounted roots, create the next original renderer, restore regular state when returning, remount roots and stable fullscreen layout, invalidate/focus/start and rebind context terminal input. The stable public proxy and stored methods retarget to the current renderer. Application containers, editor, footer/provider, mapping endpoints and directly registered child objects retain their identities. Old renderer timers cannot refresh current mappings.

Any native overlay entry blocks a different mode, including hidden and dimensionally invisible entries. Requesting the current mode succeeds. Removal of an overlay restores switching; the overlay handle and original focus behavior remain unchanged.

## Input and lifecycle

The fullscreen renderer's constructor-installed viewport listener runs before extension/global hooks exactly once. Its scroll/search/mouse consumption remains original Pi behavior. Ordinary desktop input retains mapped control state and shared focus routing.

Mode replacement creates a new direct-listener Set, matching Pi's renderer replacement. Direct `tui.addInputListener` registrations remain with the old renderer; old unsubscribe closures cannot delete a registration in the new renderer. Tracked `ctx.ui.onTerminalInput` subscriptions rebind to the new renderer, and their existing unsubscribe closures remove the rebound subscription. Ordinary resource/session resets keep the current renderer and retain their previously documented live-Set unsubscribe semantics. Debug and desktop terminal presentation state retarget across mode replacement.

Public `tui.start()`/`stop(options)` execute original native lifecycle hooks and pause/resume desktop input ownership. Stopping cancels native render timers and fullscreen transient timers; starting resets the fullscreen native frame as Pi specifies. `stopInteractive()` applies the SDK fullscreen exit-output setting. A transcript exit removes overlays, switches to regular, renders and stops; a resume-hint exit preserves the fullscreen screen. Workspace retirement then retires all endpoint, timer and physical terminal ownership. If an original extension hook throws during transcript remount/render, retirement reports it and still completes ownership cleanup.

This contract concerns the shared renderer. Private per-surface layout TUIs remain detached; they are not the extension-facing renderer. It does not establish full SDK completion, arbitrary private API compatibility or full device-protocol support.
