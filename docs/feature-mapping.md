# Pi Features in Desktop Workflows

| Pi capability                         | Desktop workflow                                                           | Integration                                                               |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| New/resume sessions                   | Sidebar new conversation and history search                                | SDK session runtime and session listing                                   |
| Cross-project history                 | Sidebar workspace filter; opening a session restores its workspace         | SDK session headers and runtime                                           |
| Session names                         | Conversation header rename                                                 | SDK session metadata                                                      |
| Branch/fork                           | Per-message branch action; original text returns to the composer           | SDK fork and editor event                                                 |
| Tree/labels                           | Dedicated conversation tree with active branch and labels                  | SDK session entry tree and navigation                                     |
| Branch summaries                      | Toggle in conversation tree before navigation                              | SDK branch summary generation                                             |
| Clone/import/export                   | Conversation action menu and native file dialogs                           | SDK runtime and HTML/JSONL exports                                        |
| Model/thinking                        | Composer selection; startup defaults in settings                           | SDK model runtime and persisted defaults                                  |
| Model cycling scope                   | Model/account settings                                                     | SDK scoped model list                                                     |
| Authentication                        | Provider settings, standard dialogs and browser authorization link         | SDK native authentication callbacks                                       |
| Streaming/thinking                    | Conversation transcript                                                    | SDK message events                                                        |
| Tool execution/progress               | Inline tool results and running tool output                                | SDK execution events                                                      |
| Stop/retry                            | Stop control and retry state                                               | SDK abort and retry events                                                |
| Steering/follow-up                    | Composer delivery selector and visible queue                               | SDK prompt/queue APIs                                                     |
| Context/compaction                    | Inspector usage meter and compaction action                                | SDK context usage and compaction                                          |
| Read/edit/write/bash                  | Agent tools, selectable in inspector                                       | SDK built-in tools                                                        |
| Manual shell execution                | Command dialog, running state, stop control and transcript result          | SDK bash execution/cancellation; custom backends available natively       |
| Project file inspection               | Files view, text/image preview and attach action                           | Confined filesystem reads                                                 |
| Git changes                           | Staged/unstaged diff inspection                                            | Git executable, no mutation                                               |
| Images/files                          | Composer image upload/paste; workspace file attachments                    | SDK image blocks and file content                                         |
| Skills/templates/commands             | Resource list and composer completion                                      | SDK discovered resources and prompt expansion                             |
| Extension/package management          | Package installation, update and removal in settings                       | Public SDK package manager                                                |
| MCP                                   | Server add/remove/enable in settings, status check, login/logout/reconnect | Built-in SDK MCP extension and config                                     |
| Detailed MCP config                   | Advanced MCP JSON editor for env, headers, OAuth and tool exposure         | Pi's native `mcp.json` format                                             |
| Settings                              | Global/project controls and validated JSON editor                          | SDK settings manager and resource reload                                  |
| Project trust                         | Project trust prompt and settings toggle                                   | SDK project trust store                                                   |
| Extension standard dialogs            | React selection, confirmation, input and multiline dialogs                 | Desktop `ExtensionUIContext`                                              |
| Extension status/text widgets         | Inspector status and above/below composer widgets                          | Desktop `ExtensionUIContext` and placement                                |
| Extension editor read/write           | Composer synchronization                                                   | Host editor state and frontend events                                     |
| Extension tool expansion              | Inspector toggle                                                           | Host expansion state                                                      |
| Extension component UI                | Native forms, selectors, toggles, buttons and editors                      | Shared Pi component-type mapping; original factories, instances and callbacks |
| Legacy example presentations          | Question/questionnaire dialogs, Todo tables, Q&A progress, status messages | Opt-in regression support, disabled by default; independent of generic mapping |
| Extension working/thinking UI         | Loading visibility/frames and collapsed thinking label                     | Live extension UI state                                                   |
| Extension autocomplete                | Native composer suggestions                                                | Pi completion engine and provider factories                               |
| Developer SDK APIs                    | Native runtime/module entry points without dedicated controls              | Full official SDK exports, live objects, callbacks and runtime factories  |
| Advanced model APIs                   | Programmatic complete/stream/image/classifier/deferred requests            | Actual SDK model runtime, streaming events and cancellation               |
| Context diagnostics/editing           | Programmatic prompt/projection inspection and context edits                | SDK canonical context and session manager                                 |
| Terminal tool/message/entry renderers | Native transcript slots with state, streaming and expansion context        | Shared component mapper retains original renderers, state and callbacks |
| Extension overlays                    | Responsive native overlays with visibility/focus/bounds handles            | Dynamic SDK overlay options in logical desktop units                      |
| Extension keyboard/input behavior     | Native key, paste and composition bridge plus shortcuts                    | Ordered consume/replace listeners and Pi's public key parser              |
| Appearance                            | Native theme tokens and desktop controls                                   | Live Theme and public Pi color conversion                                 |

The application is a separate SDK host. Pi's CLI process is not attached, and global Pi upgrades do not replace the pinned SDK. Files and configuration can be shared, but extensions must support the loaded SDK version and the available UI interfaces.

Full support remains in progress; see [the SDK coverage audit](sdk-api-audit.md). Standard Pi component types and their composition map to desktop controls without per-extension adapters. Arbitrary character-art output has no component structure to map. Exact custom geometry, real OS IME/mobile input and complex editor workflows still need validation.

An app updater and automatic SDK negotiation with a global Pi CLI are separate application features, not claims of SDK API coverage.
