# Design Application — Pi Desktop

> Source Design: [Design.md](./Design.md)
> Source Preview: [Design.preview.html](./Design.preview.html)
> Target: Pi Desktop React/Tauri shell, chat, files, tree, resources, settings and existing dialogs
> Mode: build
> Signature mechanism IDs: `M1`, `M2`, `M3`
> Source default theme: observed Harness depiction is dark; Claude documentation does not establish exact app colors
> Target default theme: existing Pi system/light initialization remains authoritative; light is an adaptation and saved SDK themes still apply
> Decision labels: `[Source]`, `[Product]`, `[Adaptation]`, `[Recommended]`

## Target Scope

- [Product] Redesign the whole application's layout and finish, including navigation,
  empty/populated chat, composer, inspector, files, tree, resources, settings and
  overlays. Preserve existing SDK controls, actions, callbacks and xterm support.
- [Product] Chinese UI, keyboard labels, history/search/pins, model choice, input,
  queues and auxiliary surfaces remain usable. Folder selection needs a filesystem
  browsing API distinct from the workspace-confined file preview API.
- [Product, revised 2026-10-07] The sidebar manages workspaces and conversations.
  Conversation destinations use one persistent strip inside the session; files
  have one navigation entry. Inspector defaults closed and opens on demand.
- Matrix: 1440, 1024, 768, 390 and 375px; representative populated, empty, settings,
  files/resources/tree, menu/drawer and dark-theme states.
- Exclude copying brand assets, marketing effects, new automations, arbitrary
  extension UI redesign and an expanded SDK compatibility matrix.

### Presentation refinement — scope

[Product] Retain all existing capabilities while moving the whole presentation
closer to mature Agent Harness desktops. Review each displayed feature; remove
redundant annotations and explain necessary metadata in tooltips. This extends the
previous layout category to the presentation inventory below, including code and
diff content, configuration lists and standard extension surfaces.

Additional source: the official Codex app routes now redirect to
https://learn.chatgpt.com/docs/app and https://learn.chatgpt.com/docs/features.
[Observed] The features page depicts grouped Pinned/Projects/Recents navigation,
New chat and an Add menu. It does not prove exact legacy Codex app colors or tool
result behavior. Current captures are in `.local/modern-evidence/`.
[Observed] Claude desktop documentation places session actions by the session
title/sidebar, configuration by the prompt and file review in adjacent panes.
[Adaptation] Pi keeps its current destination model and SDK-owned components;
presentation choices below apply those mechanisms to its existing capabilities.

| Displayed feature                       | Final carrier / presentation                                                                        | Required evidence                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Projects and session history            | Compact left rail; active selection; dates and pins; full paths/counts in tooltip                   | Switch session, filter/search/pin, retain draft                 |
| Header/title/status                     | One destination/title; rename and overflow actions; idle dot with runtime tooltip; active task text | Menu/title remain reachable, disconnected/active states visible |
| Empty conversation                      | Short headline, enclosed prompt and actionable starters                                             | Starter updates original SDK editor                             |
| Composer/model/thinking                 | Original editor without a generated visible field label; short placeholder; adjacent selectors/send | Text, shortcuts, attachments, queues, custom editor callbacks   |
| Usage and working feedback              | Compact context entry; full metrics in inspector/tooltip; extension working text retained           | Context entry opens inspector; running feedback remains visible |
| Messages and time                       | Document/bubble anatomy; actions on hover/focus; time in tooltip                                    | Copy/fork and streaming; messages remain selectable             |
| Thinking                                | Native details disclosure; original content and visibility policy                                   | Open/close matches SDK policy                                   |
| Tools and output                        | Neutral enclosed rows, bounded state accent; original renderers; fallback arguments disclosed       | Success/error/pending and original custom callbacks             |
| Code blocks                             | Quiet enclosure, syntax retained, copy action with tooltip; local horizontal scroll                 | Exact copy text and highlighted content                         |
| Tables, lists, links and images         | Original Markdown semantics; local overflow, sized images and link actions                          | Wide/narrow content and click behavior                          |
| Git changes                             | File sections, hunk/line hierarchy and changes counts; raw metadata disclosed                       | Changed content, no lost diff lines, copy raw diff              |
| File preview                            | Folder list plus document pane; tooltip path, copy/attachment actions, contained code               | Open/read/attach/copy and image/truncation states               |
| Conversation tree                       | Role/node selection and hierarchy; technical types in tooltip                                       | Filter/navigation/label/branch behavior                         |
| Resources/commands/diagnostics          | Compact resource rows; optional descriptions, tooltip source; command actions and actual errors     | Filter/use/reload and diagnostics remain available              |
| Inspector                               | Context/tool controls plus disclosures; statuses carry values, technical keys in tooltip            | Metrics, compaction, tools and display toggles                  |
| Settings/model accounts/MCP/packages    | Same shell; grouped actionable fields; tooltip locations; actual validation/errors                  | Save, accounts, MCP and packages; both themes                   |
| Extension widgets/dialogs/overlays      | Retain original content and callbacks; neutral host enclosure/focus; xterm when needed              | Native form/overlay and representative component groups         |
| Notices/authentication/loading/shutdown | Necessary feedback and actions, concise hierarchy                                                   | Visible actionable errors and required choices                  |

Verification remains grouped by presentation category. Real providers, unknown
extension internals, future versions and extra platforms are not added to scope.

## Source Contract

| Mechanism ID | Carrier + operator + role                           | Source scope                                        | Transfer obligation                                                                           |
| ------------ | --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| M1           | Compact grouped rail + tonal selection + navigation | Harness depicted rail; Claude project/session model | One compact left navigation; project/session grouping; visible active destination             |
| M2           | Quiet canvas + readable measure + comprehension     | Harness task depictions                             | Compact title, readable message column, restrained empty state, no redundant persistent strip |
| M3           | Rounded prompt + toolbar grouping + action          | Harness chat/plugin prompt                          | Context and model controls inside one prompt enclosure; clear send action                     |
| M4           | Adjacent evidence + disclosure + comprehension      | Harness review/trace; Claude panes                  | Inspector opt-in; existing auxiliary destinations retained                                    |
| M5           | Tonal wells + hairlines + hierarchy                 | Harness dark depiction                              | Neutral chrome separators and consistent selected wells, both supported themes                |
| M6           | System typography + restrained accent + hierarchy   | Harness depiction                                   | 14px target body and compact 12–13px metadata; coherent control sizing                        |

[Source] Marketing depiction scales rather than proving actual app breakpoints.
[Adaptation] Pi uses responsive drawers, original system fonts and original assets.
Its SDK theme tokens and extension render styles remain authoritative; shell chrome
uses neutral semantic roles so terminal border colors do not create a grid of lines.

## Target Mechanism Map

| Target surface/state    | Region                      | Role                       | Mechanism IDs | Adaptation                                                             | Acceptance check                                                              |
| ----------------------- | --------------------------- | -------------------------- | ------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Primary · empty         | Rail and main title         | Locate project/session     | M1, M2, M5    | [Adaptation] 252px rail, 56px title, quiet selected rows               | No persistent main navigation row while rail is open                          |
| Primary · empty         | Headline and prompt         | Start a task               | M2, M3, M6    | [Adaptation] centered headline/prompt, useful existing prompt starters | Prompt remains visible; no large metric column; starter fills original editor |
| Primary · populated     | Transcript and dock         | Read and continue work     | M2, M3, M5    | [Adaptation] central 820px reading measure, user well, bottom prompt   | Stream, tool result and original input work; timeline scrolls independently   |
| Primary · populated     | Session rail                | Return to work             | M1, M2        | [Adaptation] compact history rows and search, existing pin action      | Select a session, preserve its draft and locate active row                    |
| Primary · settings      | Rail and settings form      | Configure workspace        | M1, M2, M5    | [Adaptation] same shell, grouped readable settings                     | Settings/model controls remain reachable and theme changes work               |
| Primary · files         | Rail and file/preview split | Inspect project evidence   | M1, M2, M4    | [Adaptation] current file/diff split with quieter rows                 | Open fixture file and add it to prompt                                        |
| Primary · tree          | Rail and chronological tree | Navigate conversation      | M1, M2, M4    | [Adaptation] existing branch tree with aligned controls                | Current tree and existing navigation actions render                           |
| Primary · resources     | Rail and resource list      | Inspect capabilities       | M1, M2, M4    | [Adaptation] aligned metadata and grouped actions                      | Resources/reload/filter and command entry remain accessible                   |
| Primary · loading/error | Main feedback and shell     | Explain readiness/recovery | M1, M2, M5    | [Adaptation] subdued status and compact feedback                       | Error/status text and original actions remain visible                         |
| Supporting · inspector  | Disclosed pane              | Inspect usage/tools        | M4, M5, M6    | [Adaptation] 304px neutral pane with close control                     | Opens/closes at desktop and narrow widths; tools/settings accessible          |
| Supporting · overlays   | Menu/dialog/drawers         | Complete focused action    | M3, M4, M5    | [Adaptation] quiet rounded surfaces, accessible scrim                  | Menu and existing extension dialogs retain focus and callbacks                |

## State & Responsive Matrix

| State/viewport                             | Product job                  | Mechanism IDs  | Transformation                                                    | Acceptance check                                        |
| ------------------------------------------ | ---------------------------- | -------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| Empty/populated · 1440px                   | Start/read work              | M1, M2, M3     | Fixed rail; measured chat; inspector disclosure                   | Composer and transcript align; no page overflow         |
| Settings/files/resources/tree · 1440px     | Inspect/configure            | M1, M2, M4     | Main carrier replacement, retained rail                           | Existing destinations and controls operate              |
| Empty/populated · 1024px                   | Read work at smaller desktop | M1, M2, M3     | Rail retained; inspector floats                                   | Prompt fits; inspector close reachable                  |
| Empty/populated · 768px                    | Continue with more space     | M1, M2, M3     | Rail becomes drawer; compact destination strip                    | Nav opens/closes; input remains visible                 |
| Empty/populated/settings · 390px and 375px | Work in narrow window        | M1, M2, M3     | Drawer navigation; wrapped prompt toolbar; local list/code scroll | No document overflow; send and close controls reachable |
| Dark empty/populated · 1440px and 390px    | Continue in saved theme      | M1, M2, M3, M5 | Same geometry, inverted tonal ladder                              | Neutral boundaries and readable text remain distinct    |

## Token Bindings

| Source role      | Source value                              | Target token                               | Target usage                | Status                                     |
| ---------------- | ----------------------------------------- | ------------------------------------------ | --------------------------- | ------------------------------------------ |
| Quiet canvas     | dark depicted canvas                      | `--ui-canvas: #fafaf9`                     | Light task canvas           | [Adaptation] existing light default        |
| Rail surface     | #343a43 depicted dark                     | `--ui-sidebar: #f1f2f4`                    | Light navigation            | [Adaptation] neutral tonal step            |
| Input well       | #2c2c2e depicted dark                     | `--ui-input: #ffffff`                      | Light prompt                | [Adaptation] bordered well on quiet canvas |
| Text / secondary | #f9fafb / #cfd3d6 dark                    | `--ui-ink: #25272c`, `--ui-muted: #7c8089` | Shell type                  | [Adaptation] light hierarchy               |
| Separator        | approximate depicted dark hairline        | `--ui-line: #e2e3e6`                       | Shell separator             | [Recommended] independent neutral chrome   |
| Decisive action  | blue depicted send                        | `--ui-action: #536fe0`                     | Send, keyboard focus        | [Recommended] restrained blue              |
| Reading measure  | source prompt 685.8px at scaled depiction | `--chat-measure: 820px`                    | Chat and composer alignment | [Recommended] native desktop legibility    |

Dark counterpart [Adaptation]: canvas #18191b, rail #22252a, input #292c31,
ink #edeef0, muted #9a9fa8, line #34373d, action #88a0f4. Saved SDK appearance
still selects the theme, while original extension tokens remain unchanged.

## Implementation Sequence

1. Create `src/shell.css` for semantic theme roles and layout; import after styles.
2. Update `src/App.tsx` rail navigation, optional inspector, empty/chat composition
   and drawer scrims while retaining original event handlers and accessible labels.
3. Apply prompt/transcript, auxiliary forms/lists and responsive finish as one
   coherent category. Keep generic extension component rules in their existing layer.
4. Run one grouped type/build/browser verification, inspect representative captures,
   consolidate defects and rerun only affected groups. Reuse the 1451 preview tab.

## Acceptance Checks

- **Signature coverage:** each primary state visibly combines M1/M2 or M2/M3;
  empty and populated chat include all three.
- **Theme:** retain SDK-selected light/dark behavior; verify both tonal ladders.
- **Computed style:** verify rail width, compact header, neutral borders, prompt
  radius/measure, body typography and isolated document overflow.
- **Behavior:** navigation, history/draft, prompt/send, file attachment, settings,
  theme and extension dialog/terminal callbacks retain existing functionality.
- **Responsive:** inspect the five widths above, drawer dismissal and toolbar wrap.
- **Screenshot:** compare empty/populated/settings/files/resources/tree and dark
  captures to the source rail/canvas/prompt relationships and pre-change baseline.

## Known Gaps

No authenticated source app or proprietary assets are required. Source exact
desktop responsive behavior and Claude style tokens are unavailable and treated as
adaptations. Local fixture content is evidence for the UI, not a real-provider
verification. No installer rebuild or all-extension revalidation is part of this
layout change; build and relevant existing UI workflows verify the affected scope.

## Layout Category Verification — 2026-10-07

The source is the official [DeepSeek Agent Harness page](https://www.deepseek.com/en/harness/),
as clarified by the user. Claude's documented desktop organization supplements
navigation; no authenticated Claude app pixels or exact tokens are claimed.

Implementation: `src/shell.css` supplies neutral shell roles and responsive
geometry; `src/App.tsx` supplies grouped navigation, optional inspector, drawer
dismissal and empty-conversation composition. `src/main.tsx` loads the shell layer
after the original component styles. SDK component themes and xterm remain in
their original rendering paths.

| Rendered state                               | Viewport        | Theme          | Visible mechanisms                                                 | Result                   |
| -------------------------------------------- | --------------- | -------------- | ------------------------------------------------------------------ | ------------------------ |
| Empty conversation                           | 1440, 1024      | Light          | M1 grouped rail, M2 quiet canvas, M3 enclosed prompt               | Pass                     |
| Empty conversation                           | 768, 390, 375   | Light          | M1 disclosed rail/compact navigation, M2 canvas, M3 wrapped prompt | Pass                     |
| Populated/tool conversation                  | 1440            | Light and dark | M1 history, M2 measured document/user well, M3 bottom prompt       | Pass                     |
| Populated conversation                       | 390             | Dark           | M1 compact navigation, M2 local transcript, M3 prompt              | Pass                     |
| Files and preview                            | 1440            | Light          | M1 rail, M2 quiet content, M4 split evidence                       | Pass                     |
| Tree and resources                           | 1440            | Light          | M1 destination/history, M2 restrained content, M4 working detail   | Pass                     |
| Settings                                     | 1440            | Light          | M1 destination, M2 readable form, M5 neutral sections              | Pass                     |
| Settings/files/resources and extension forms | 390             | Light          | M1 drawer navigation, M2 compact content, M4 disclosure            | Existing UI group passed |
| Menu, inspector and navigation drawers       | Wide and narrow | Light          | M1 navigation, M4 disclosure, M5 surface hierarchy                 | Pass                     |

Representative captures live in `.local/screenshots/layout-*.png`; the before
capture and original source carriers live in `.local/design-evidence/`.
Computed live-preview evidence confirms a 252px rail, 56px header, 19px prompt
radius, 820px composer region, neutral hairlines and hidden duplicate navigation.
At smaller desktop widths the rail contracts; below 800px it becomes a drawer.
The five viewport checks report no document overflow and keep send/close controls
reachable. Generated source-preview overflow checks also passed at 600px.

Grouped functional verification:

- Final browser group: **17/17 passed** across `layout.spec.ts`, `desktop.spec.ts`,
  `default-editor.spec.ts` and `themes.spec.ts`.
- Relevant SDK source group: **11/11 passed** in `tests/sdk.test.ts`.
- Source Design, generated Preview and application-contract validators passed.
  The two-source warning is bounded to the user's two named references.
- Final production frontend/backend and Windows release executable builds passed.
  `tests/native.ts --default-editor` passed against the final executable: WebView2
  input actions, clipboard text/image, message queues and session drafts. The
  native capture was inspected in `.local/screenshots/native-default-editor.png`.

The initial category run had 14/17 passes. Consolidated repairs addressed the
native editor's prompt-starter synchronization, two fixtures competing for one
shortcut, a file/history locator collision and an assertion treating a system
select option as a permanently visible control. The final group above includes
all affected browser workflows; the earlier failing logs remain separate.

Acceptance stops at this layout category. Real-provider authentication, unknown
extensions, future Pi versions, other operating systems and installer packaging
are outside this change. Existing SDK/theme/terminal mechanisms are retained;
this record does not claim exhaustive compatibility revalidation.

## Presentation Category Verification — 2026-10-07

The presentation inventory above is complete for the agreed scope. The shell now
uses compact navigation, a quiet reading canvas, an enclosed composer and disclosed
evidence (M1–M4). Necessary paths, runtime information, timestamps and technical
status keys are available through tooltips. Repeated headings and generated prompt
instructions have been removed. Settings, resources, tree and file views follow
the same neutral surface and type hierarchy (M5–M6).

The original SDK editor, Markdown transforms, tool renderers, extension widgets,
keyboard handling and xterm paths remain in use. Standard Editor/SelectList
completion maps to a desktop suggestion list with original selection/confirmation
callbacks. A click submits the requested value through the stable editor action,
so pending input can replace the suggestion list without invalidating that click.
Code keeps Pi's highlighting and copies parsed source rather than terminal padding.
File diffs disclose raw metadata while retaining every hunk, line and raw copy data.

| Inventory coverage                              | Evidence and result                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects, history, header and empty state       | `layout.spec.ts`, `desktop.spec.ts`, `presentation.spec.ts`; session switching/drafts, destination titles, starters and tooltip metadata passed                                        |
| Composer, models, thinking and usage            | Original text/actions, keyboard and click completion, clipboard text/images, queues and drafts passed; context entry opens inspector                                                   |
| Messages, thinking, tools and output            | Original renderers, expansion, success/error/pending states, controls and callbacks passed; tool chrome is neutral and bounded state borders remain distinct                           |
| Code, tables, lists, links, images and diagrams | Original Markdown/Mermaid streaming and lifecycle passed; exact source copy, neutral table borders and local overflow were checked                                                     |
| Git changes and file preview                    | A real fixture repository produced grouped file hunks with line numbers; file read/attachment and raw diff copy passed; content is readable at 1440, 768 and 390px                     |
| Tree, resources, commands and diagnostics       | Rendered destination captures and retained workflow checks; technical types/paths use tooltips; active tree selection uses the shell's tonal hierarchy                                 |
| Inspector and working feedback                  | Context/actions and tool/display disclosures remain accessible; metrics and running/error feedback are retained                                                                        |
| Settings, accounts, MCP and packages            | All five settings tabs were captured; save/validation/theme controls passed; locations and endpoints are disclosed in tooltips                                                         |
| Extension dialogs, widgets and overlays         | Native form/overlay/input workflows passed; custom content and callbacks retain SDK ownership                                                                                          |
| Terminal                                        | Four shared-terminal presentation cases passed at wide/narrow widths; xterm interaction remains in its existing path; host utility actions use tooltips                                |
| Notices, authentication, loading and shutdown   | Required model/configuration feedback and original dialog actions remain; native startup/close completed; external authentication services were not retested for a presentation change |

Current grouped verification:

- Presentation/navigation/Markdown group: **13/13 passed** in
  `.local/modern-refinement-browser.log`.
- Completion and affected presentation group: **5/5 passed** in
  `.local/modern-refinement-affected-final.log`.
- Final source-copy/Markdown group: **4/4 passed** in
  `.local/modern-copy-markdown-verified.log`.
- Existing SDK group: **11/11 passed** in `.local/modern-sdk.log`; relevant
  original-editor completion cases: **2/2 passed** in
  `.local/modern-refinement-completion-sdk-final.log`.
- Windows WebView2 editor, completion and tool-display groups passed in
  `.local/modern-refinement-native-*.log`. The final executable also passed the
  Markdown/transformer/Mermaid group in `.local/modern-presentation-native-markdown.log`.
- Final frontend/backend/type checks and Windows release build passed in
  `.local/modern-presentation-release.log`. The build updates both runtime backends.

These groups overlap and are not summed into an inflated total. Earlier failing
logs remain diagnostic records; they are superseded only by the affected passing
groups above. Consolidated repairs covered shared transcript width, duplicate
headings, fixture locator/cleanup/readiness, Windows CRLF and pixel quantization,
stale completion clicks and terminal indentation in copied code.

Rendered QA: `.local/modern-evidence/review.json` records **18 captures** across
1440, 1024, 768, 390 and 375px, with no document overflow. `review-*.png` covers
empty/chat/completion, inspector, files/tree/resources, all settings tabs and dark
chat. `diff-*-final.png` covers real file changes at three widths. Narrow content
captures dismiss the navigation drawer so the actual content is visible. Native
editor, tool and Markdown screenshots are in `.local/screenshots/`. The final live
preview source-copy check passed in `.local/modern-preview-copy-final.log`.

The preview remains on **http://127.0.0.1:1451/** with a clean empty fixture session.
The release executable is `src-tauri/target/release/pi-agent-desktop.exe` and uses
its existing adjacent runtime resources. Temporary browser/test/native sessions
were closed; only the retained preview servers remain.

Acceptance ends at the current Windows presentation category. It does not add
unknown extension introspection, speculative asynchronous combinations, future Pi
guarantees, other platforms, external-provider authentication or installer packaging.

## Desktop Workspace Repair — 2026-10-07

[Product] Apply the seven confirmed desktop interaction differences. Retain the
current SDK, generic extension mapping, original renderers and xterm callbacks.
Parallel sessions, worktree creation, permission modes and a full file editor
remain outside this repair. Official terminal placement evidence is recorded in
`docs/terminal-placement-references.md`.

| Target carrier                            | Role / mechanisms                   | Adaptation                                                                                  | Observable acceptance                                                                                   |
| ----------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Session toolbar and bottom terminal dock  | Auxiliary work / M2, M4, M5         | Default closed, adjustable height, keyboard toggle; retain extension modal dock             | Opening reserves space below chat, does not cover composer; resize and PTY input still work             |
| Chat with adjacent file/change pane       | Read task and evidence / M2, M4, M5 | Side pane on desktop, dismissible overlay on narrow windows                                 | Chat remains mounted and draft survives opening/closing files; file and diff actions work               |
| Transcript file links                     | Navigate evidence / M2, M4          | Preview workspace paths and line references in the same pane                                | Encoded paths and requested line open correctly; web links and extension-dialog opener behavior survive |
| Composer add menu                         | Supply context / M3, M5             | One entry for images, project files, skills, prompts and commands                           | Each choice feeds the existing attachment/editor SDK behavior; Escape and focus work                    |
| Session rail                              | Locate work / M1, M5                | Separate pinned sessions and collapsible project groups, retain search and workspace filter | Pin/unpin, search, project grouping and session switching show the right session                        |
| Standard tool row                         | Inspect execution / M2, M4          | Per-call expansion control and state label; custom self-renderers remain authoritative      | Expanding one result preserves other tool states and original renderer callbacks                        |
| Thinking selector and provider management | Configure work / M3, M5             | Friendly thinking labels; connected accounts first and explicit add-provider disclosure     | SDK enum values stay unchanged; all provider login/API-key actions remain reachable                     |

Verification is grouped into workspace/navigation/context, transcript/links/tools,
and terminal/extension compatibility. Run those groups after implementation,
repair verified failures, then rerun affected groups. Inspect light/dark rendered
states at 1440, 1024, 768, 390 and 375px and build the Windows executable.

## Desktop Workspace Verification — 2026-10-07

All seven repairs in the preceding map are implemented: the session toolbar
opens a bottom terminal dock; file/change evidence stays beside chat or in a
dismissible narrow overlay; message file references open that pane and locate
lines; the composer uses one context menu; history groups projects and separates
pins; standard tools expand individually; thinking names and provider disclosure
use the intended presentation. The context menu uses a body portal so the
composer cannot clip it. Default history discovery includes Pi's project session
directories while explicit custom session directories retain their flat meaning.
Relative file targets also survive the original Pi Markdown/OSC rendering path.

Current grouped verification:

- Workspace/navigation/context, transcript/links/tools and existing compatibility
  workflows: the 31-case browser group recorded **30 passes and one obsolete
  terminal-close assertion** in `.local/workspace-browser-verified.log`. The
  assertion now targets the session toolbar. The entire affected terminal group
  then passed **5/5** in `.local/workspace-terminal-verified.log`, covering that
  case plus mouse, focus, PTY input, resize and color-probe replay. Together these
  records cover the 31 distinct browser cases; overlapping reruns are not added.
- Relevant SDK source group: **11/11 passed** in `.local/workspace-sdk.log`.
- Windows WebView2 workspace group passed in `.local/workspace-native.log`:
  file-line navigation, the context menu, pins, tool controls, accounts and dock.
  The native terminal group also passed in
  `.local/workspace-native-terminal.log`, including synchronous child input,
  resize and original component callbacks.
- The final type check passed after the native helper was added. Frontend,
  backend, adjacent runtime staging and Windows release executable builds passed
  in `.local/workspace-release.log`. The application contract validator reports
  **0 warnings**. The release is
  `src-tauri/target/release/pi-agent-desktop.exe`; installer packaging was not run.

Rendered evidence is in `.local/workspace-evidence/`: `files-*.png` and
`terminal-*.png` cover 1440, 1024, 768, 390 and 375px; `dark-files.png`,
`projects.png`, `tools.png`, `accounts-add.png` and `native-workspace.png` cover
the remaining relevant states. Document overflow checks passed. Wide file
evidence and the bottom terminal reserve space for chat and its composer; narrow
file evidence has reachable dismissal controls. Extension fixture labels in
these captures belong to the fixture's original content.

The retained preview remains at **http://127.0.0.1:1451/**. Its owned backend was
updated on port 4351 while preserving the existing session, two messages and
empty draft in the same project and agent directories. Read-only UI verification
confirmed the connection, history entry, collapsed terminal, no document
overflow and no page errors; evidence is `preview-final.json` and
`preview-final.png`. The temporary verification browser closed. Test listeners
on 1540, 4331 and 9225 are closed; the retained UI/backend listeners remain.

Acceptance ends at these seven Windows desktop interaction repairs. The
existing SDK, extension mapping and xterm mechanisms are retained. This record
does not extend acceptance to arbitrary hidden components, hypothetical callback
combinations, unknown Pi versions, other platforms or external authentication.

## Conversation and Settings Structure Repair — 2026-10-07

[Product] Apply the nine requested changes using the mechanisms verified in
`docs/conversation-settings-layout-references.md`. The user's sidebar and input
requirements supersede the earlier navigation and separate-pins adaptation.

| Target carrier | Role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Workspace/session rail | Locate conversations / M1, M5 | New session, add workspace, search, workspace groups; pins stay inside their workspace | Recent empty workspaces remain reachable; switching and search work; no history counter or refresh control |
| Session destinations | Navigate session work / M1, M4 | One strip for chat, files/changes, tree and resources; one files navigation button | All destinations work with expanded/collapsed sidebar and narrow widths; contextual file links use the same pane |
| Conversation process | Read replies and inspect execution / M2, M4 | Normal/thinking/detailed presets; concise standard tool steps; preserve interactive/custom renderers | Presets change display rather than model effort; individual expansion, errors and original callbacks work |
| Settings | Configure by task and scope / M1, M5 | Category rail and setting rows; frequent preferences, models, project, MCP, packages and advanced are separated | Existing actions remain reachable; scope is shown only where supported; draft edits have visible save state |
| Integration management | Manage existing services / M4, M5 | Installed/configured lists first; explicit add forms | Add, cancel, keyboard focus, validation and original SDK save/install actions work |
| Session feedback/composer | Show actionable state / M3, M5 | Remove idle Pi version/ready indicator; show disconnection/active state; usage inside composer | Idle header stays quiet; active/disconnected feedback remains; usage opens details from inside prompt |
| Inputs and labels | Edit data vs operate UI / M3, M5 | Form entries have one boundary; nested search/composer and toolbar selectors are borderless; keyboard focus stays visible | No doubled focus/border; search and SDK inputs still work; UI labels are not selectable while messages/code/input values are |

Acceptance is grouped: navigation/composer/inputs, conversation/tool compatibility,
and settings/integrations. Implement each category before testing it; repair real
failures and rerun affected groups. Check the five existing widths and a dark state,
then build and verify the Windows executable. Retain preview port 1451 and its
current session. This repair adds no SDK capability or new compatibility matrix.

## Conversation and Settings Structure Verification — 2026-10-07

All nine requested changes are implemented. The workspace rail contains new
session, add workspace, search and workspace groups, with settings at its foot.
Chat, files/changes, tree and resources share the session destination strip;
files/changes has one navigation entry and contextual links use that same pane.
Empty recent workspaces remain reachable and pins stay inside their workspace.
The history counter/refresh and idle Pi version/ready indicator are removed.
Context usage is inside the composer, with active/disconnected feedback retained.

Conversation turns retain SDK message order. Standard tools use concise action,
target and status summaries; normal/thinking/detailed presets control display.
Errors, interactive surfaces and custom self-renderers remain visible, and
original expansion and component callbacks are retained. Settings use seven
categories, scope controls where supported, list-first integration management,
explicit add/cancel forms and persistent draft/save feedback. Independent form
inputs have one boundary; embedded controls share the carrier boundary and keep
keyboard focus visible. Interface labels are not selectable; messages, code and
input values remain selectable.

Grouped verification covers the 32 distinct browser cases in
`.local/structure-browser-group.log`: 28 initially passed; the four failures were
obsolete locators/interaction assumptions after the navigation and collapsed-tool
changes. The complete affected group then passed **10/10** in
`.local/structure-browser-affected.log`, preserving the original component/link
callback checks. Overlapping reruns are not counted as additional cases.

- Windows WebView2 workspace/settings verification passed in
  `.local/structure-native.log`: file-line navigation, draft preservation,
  composer context, one files entry, tool controls, pins, provider management,
  settings categories, add/cancel focus and saving.
- Native xterm PTY, synchronous child input, resize and original component
  callbacks passed in `.local/structure-native-terminal.log`.
- Final type checking passed in `.local/structure-check-final.log`. Frontend,
  backend, both adjacent runtime backends and Windows release executable build
  passed in `.local/structure-release.log`. The contract validator reports
  **0 warnings**. Installer packaging was not run.

Rendered inspection covers 1440, 1024, 768, 390 and 375px, with light chat and
dark settings, no document overflow and reachable save/navigation controls.
Evidence is `.local/structure-evidence/chat-*.png`, `settings-*.png`, `steps.png`
and `native-settings.png`; the retained preview's seven setting categories are
captured in `.local/structure-preview/`.

The retained preview remains at **http://127.0.0.1:1451/**. The final read-only
capture in `.local/structure-preview-final.log` confirms the current session,
message count, draft and global/project settings were preserved, with no page
errors. Temporary browser/native sessions and test listeners on 1540, 4331 and
9225 are closed; the owned preview listeners on 1451 and 4351 remain. The release
executable is `src-tauri/target/release/pi-agent-desktop.exe`.

Acceptance ends at these nine layout and interaction repairs on the current
Windows desktop. SDK/extension/xterm compatibility is checked through the
existing affected workflows without expanding the compatibility boundary.

## Workspace and Conversation Polish — 2026-10-07

[Product] Repair the six reported interface issues. Reuse M1/M5 navigation,
M2/M4 conversation hierarchy and M3 input controls. Official workspace/sidebar
evidence is recorded in `docs/workspace-sidebar-references.md`; baseline captures
are in `.local/workspace-polish-evidence/before-*`.

| Target carrier | Role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Host dropdowns | Choose a value / M3, M5 | Theme-aware desktop listbox, one trigger boundary, viewport-aware popup and full labels | Mouse and keyboard selection, Escape/Tab, disabled values, dark theme and narrow composer work; SDK controls retain their callbacks |
| Add workspace | Register a local project / M1, M5 | Directory selection registers and opens that project's new session; browser uses an explicit path form | Cancel has no side effects, invalid path leaves current session intact, duplicate paths do not duplicate groups |
| Session sidebar | Locate and start work / M1, M5 | Compact actions, workspace disclosure separate from group new-session control, indented session rows and quiet hover actions | Expanding a group never switches session; group + starts in that workspace; all groups scroll without shrinking header/actions |
| Token feedback | Inspect generation / M3, M4 | Show output count and measured average tok/s using SDK usage and first-output/end events | No character-based estimates; missing timing/count does not show a fabricated rate; session changes do not inherit another response's rate |
| Shell action | Run a one-off command / M4, M5 | Name it explicitly and describe its conversation/context effect in the dialog | Original Pi executeBash path, confirmation and output remain usable; distinct from the interactive terminal |
| User message bubble | Read prompt vs answer / M2, M4 | Short prompts fit content and align right; long prompts/code wrap within the conversation measure | Short, multiline, code, attachments, selection and copy work at the five existing widths |

Finish the controls/navigation and conversation/metrics categories before grouped
verification. Repair demonstrated failures and rerun only affected groups. Verify
the existing five widths and dark theme, build the Windows application and check
affected native interactions. Retain port 1451 and the user's current session.

## Workspace and Conversation Polish Verification — 2026-10-07

The six requested repairs are complete. Host dropdowns now use themed desktop
listboxes with full option labels, selection indicators, viewport positioning
and keyboard controls. SDK extension selects retain their original controls and
callbacks. The sidebar uses compact workspace groups, indented session rows,
hover actions and a separate project new-session button. Adding a directory
registers the workspace and opens a new session there; disclosure, cancellation
and invalid paths preserve the original session and its draft. Duplicate paths
do not create duplicate workspace registrations. References are recorded in
`docs/workspace-sidebar-references.md`.

User bubbles fit short content, align right and constrain long content and code.
SDK Markdown transformers receive the actual used content width for each user
bubble, including browser subpixel padding rounding. Fast local-dialog closure
unmounts its overlay and releases the focus trap. Idempotent initialization of
the current workspace no longer rejects a snapshot request during a session
transition.

Replies and the composer show SDK output token counts and measured average
`tok/s`. The host times the first nonempty output through completion, excluding
the wait before first output; reported thinking/tool-call tokens are included.
Pi 1.0.0 exposes usage but does not supply an assistant output-rate field. Counts
are never inferred from characters. Timing is retained only for responses
observed by this running host; older responses without timing show counts only.
“运行 Shell 命令…” describes its existing Pi behavior: one workspace command,
with command/output recorded into the conversation for subsequent model context.

Grouped verification covers the 28 distinct browser cases in
`.local/workspace-polish-browser.log`. The initial group passed 25 cases; the
three failures were repaired. The final affected group passed **9/9** in
`.local/workspace-polish-browser-repaired.log`, including structure, transcript
layout/transformers and the two new polish workflows. Overlapping reruns are not
counted as additional cases.

- Output-rate checks passed **2/2** in
  `.local/workspace-polish-metrics-final.log`, including missing timing and empty
  deltas. Type checking passed in `.local/workspace-polish-check-final.log`.
- Windows WebView2 workspace/settings verification passed in
  `.local/workspace-polish-native.log`. This includes opening and cancelling the
  actual OS directory picker belonging to the test application, checking no
  workspace registration/session change, output-rate display and dropdown/save
  interaction. A first attempt to replace Tauri's readonly invoke function was
  discarded in favor of the actual native picker check.
- Native xterm PTY, synchronous child input, resize and original component
  callbacks passed in `.local/workspace-polish-native-terminal.log`.
- The final frontend/backend and Windows release executable build passed in
  `.local/workspace-polish-release-final.log`. The release executable is
  `src-tauri/target/release/pi-agent-desktop.exe`; installer packaging was not run.

Rendered evidence in `.local/workspace-polish-evidence/` covers 1440, 1024, 768,
390 and 375px dropdowns, short/long user bubbles, workspace groups and dark
settings. Popups remain within the viewport and document overflow checks pass.
The current native screenshots are `.local/workspace-evidence/native-workspace.png`
and `.local/structure-evidence/native-settings.png`.

The retained preview remains **http://127.0.0.1:1451/**, with its owned backend
updated on 4351. The current session, its three messages, draft and global/project
settings were preserved, verified in `.local/workspace-polish-preview-final.json`
and `.local/workspace-polish-preview-final.log`. No in-app browser tab was added;
temporary browser/native sessions and listeners on 1540, 4331 and 9225 are closed.

Acceptance ends at these six repairs on the current Windows desktop. The
SDK/extension/xterm mechanisms and existing compatibility boundary are retained.

## Official runtime conformance — 2026-10-07

[Product] Complete the shared-function comparison and implement its bounded
differences. `docs/deepseek-shared-ui-audit.md` contains 37 primary items and
includes the 43 secondary items in `docs/deepseek-shared-secondary-audit.md`.
Runtime source facts in Design.md refine earlier scaled depiction values.
The preview remains the original marketing-depiction specimen. The current
user-selected light theme, session, draft and settings on port 1451 are retained.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Shell/sidebar/populated and empty | Navigate projects / M1, M5, M6 | Runtime 280px rail, compact project/session rows, shared glyph slot, quiet actions | Workspace add/cancel/switch/search/disclosure work; collapse preference survives updates |
| Header/session destinations | Orient the current task / M1, M2, M6 | 76px continuous title/tabs, underline selection | One file entry, all four user-required destinations accessible at five widths |
| Composer/default and custom editor | Prompt the model / M2, M3, M5 | 28px enclosure, growing native editor, right model/effort, round send | Multiline/CJK/resize/clear and SDK editor/attachment/queue callbacks survive |
| Conversation/streaming/tools | Read response and process / M2, M4, M6 | Aligned document, 20px user bubble with outside actions, compact process | Accurate original SDK Markdown widths, copy/fork/select, tool renderer/expansion and measured tok/s |
| Menus/selects/context popup | Choose or inspect / M3, M4, M5 | Filled settings enums, embedded prompt controls, bounded portal menus, small context popup | Keyboard/Escape/focus and all popup boundaries verified; full inspector explicit |
| Settings/all seven categories | Configure the host / M3, M5, M6 | 800px modal, 188px icon rail, independent scrolling, provider cards | Close/focus/drafts/scope/save/auth and MCP/package forms preserve current semantics |
| Files/diff/resources | Inspect task evidence / M2, M4, M6 | 38px headers, 13px mono+CJK, 22px diff lines, muted gutters | Original file links/copy/attach and Git semantics; SDK resource actions remain |
| Terminal/open and extension dock | Execute shell interaction / M3, M4, M5 | Existing bottom xterm, neutral theme/chrome, in-place theme updates | No xterm remount on theme change; PTY input/resize/extension callbacks pass native checks |

[Adaptation] Settings use a modal above the current session; unsaved settings
are kept while closed and reopened. The terminal remains in the established
bottom dock rather than introducing Harness DockKit. MCP uses shared form/card
mechanisms because there is no official standalone MCP page. Pi worktree changes
remain uncommitted Git changes, not Harness per-turn snapshots. Runtime labels
stay nonselectable while document/input/path content stays selectable.

Verification matrix: 1440, 1024, 768, 390, 375px; populated/empty conversation,
menu/context, all settings categories, files/diff/resources and a dark sample.
Implement a whole category before grouped checks; repair observed failures and
rerun affected checks only. Reuse existing SDK/extension/xterm tests, Windows
release build and affected native checks. Do not expand to unknown Pi versions,
hidden arbitrary components, all OS or new reference-only business capabilities.

### Runtime conformance verification

All 37 primary and 43 secondary comparison items are accounted for in
`docs/deepseek-shared-ui-audit.md`: implemented shared mechanisms, previously
aligned behavior, or explicitly bounded Pi adaptations. No reference-only
business feature is counted as a missing implementation.

Rendered evidence in `.local/harness-audit/after/` covers five agreed widths,
light conversation and menus, all seven settings categories, files/resources/tree
and representative dark settings/terminal. `target-final.json` verifies actual
280px sidebar, 50px title + 26px tabs, 28px composer, 800px settings/188px rail,
38px file toolbar and official runtime light roles. User bubbles, document
responses, compact tools and the composer instantiate the source mechanisms
together; the alternate dark state retains those relationships.

Functional browser checks passed for workspace registration/cancel/search/
disclosure, menu keyboard/Escape, SDK editor growth and callbacks, Markdown
layout/transformers/policy, exact copy/file lines, integrations/resources, settings
drafts/scope/auth, and terminal focus/input/resize/theme/OSC overrides. Initial
SDK editor growth and shortcut interception defects were repaired; stale test
flows were corrected without relaxing original SDK callback/renderer assertions.
See the primary audit for per-category logs and the bounded adaptations.

`npm run check` and Windows `tauri build --no-bundle` passed. Native WebView2
checks passed for the desktop workspace/directory-picker cancellation/settings
save (`native-workspace.log`) and xterm PTY/original callbacks/theme/OSC behavior
(`native-terminal-final.log`). The release executable is
`src-tauri/target/release/pi-agent-desktop.exe`; installer packaging was not run.
The existing Vite large-chunk warning remains outside this UI change.

Read-only capture of the retained preview at http://127.0.0.1:1451/ confirms the
session, three existing messages, draft and global/project settings were preserved,
with no page errors or horizontal document overflow. No in-app tab was added.
Temporary listeners 1540/4331/9225 are closed; owned preview listeners 1451/4351
remain. The contract validator passes with zero warnings.

## Sidebar structure and settings flow repair — 2026-10-07

[Product] Repair the user's remaining sidebar structure and settings scrolling,
overlap and hints. Keep the existing session/draft/settings at port 1451 and use
the same bounded Windows/five-width verification matrix, including short windows.

[Observed] Official `WorkspaceBrowser.tsx` and its CSS compose a distinct
workspace section header with search and add actions above the grouped rows;
global New Session is separate. The current Pi rail instead places three large
controls above unlabeled groups. A read-only baseline over all seven settings
categories at five widths found nine compressed visible containers: toolbar
content needs 48px but receives 24px; model rows also disappear into a compressed
inner scroller. Actual tooltip font is Inter rather than the host system stack.
Evidence: `.local/sidebar-settings/before/` and `sidebar-settings-baseline.log`.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Sidebar header/actions/groups | Orient workspaces and select chats / M1, M5, M6 | Separate New Session from a labeled workspace header, embed search and a compact add action, use one title/date/action row, clarify duplicate names with parent directory | Add/search remain accessible, group disclosure does not switch runtime, new-in-group expands it, no clipped titles or duplicate pin glyphs |
| Settings shell/content/short window | Configure without disrupting chat / M3, M5, M6 | Header and save bar stay fixed; one content scroller uses natural block flow, no shrinking children or nested model scroller; reset content scroll on category/scope changes | All rows remain reachable in dense provider and advanced states at the five widths; no overlapping/clipped controls; wheel scrolling stays in the modal |
| Settings hints/forms/overlays | Explain settings and report results / M4, M5, M6 | Help adjacent to labels; project paths inline and selectable; bounded tooltips use host type; clear provider identity/actions and responsive management rows | Long hints stay in viewport above modal, descriptions and actions do not collide, inputs/drafts and SDK auth/MCP/package callbacks remain intact |

[Adaptation] Pi retains its four user-required session destinations, existing
pin semantics and workspace registration flow. This repair adds no archive,
workspace rename, drag sorting, cloud isolation or new extension compatibility
guarantee. Implement both affected categories before grouped verification.

### Sidebar and settings repair verification

The retained preview's read-only probe passes all 35 category/width states with
no clipped visible containers, overlapping controls, document overflow or page
errors. Its original session, messages, draft and global/project settings are
preserved (`.local/sidebar-settings/after/report.json`, `preview-after.log`).
Representative browser and native screenshots were visually inspected.

Grouped browser checks pass for the new workspace section, same-name directory
identification, expanding new-in-group, search clearing and restored draft;
dense provider lists, fixed save bar, short windows, category scroll reset,
offscreen-select dismissal, inline paths, actual system tooltip font and bounds,
and errors displayed and dismissed inside the settings modal. Existing SDK auth,
resources, settings scope/drafts, workspace registration/cancellation, conversation
controls and xterm instance/theme checks pass as well. Evidence is in
`grouped-tests.log` (first five passing checks), `interaction-final.log` (eight
passing checks), and `settings-final.log` (affected check passes after repair).

The resource tests' project mutation triggered a trust prompt in the shared
fixture and blocked later checks; fresh UI fixtures resolve that isolation
problem without changing project trust. The actual tooltip class was initially
overwritten by Reshaped; `contentAttributes.className` now binds the intended
styles, confirmed by the repaired check. Only affected checks were repeated.

The final Windows release build, including TypeScript/frontend/backend/Rust,
passes (`release-build-final.log`). The original executable's native workspace
workflow also passes with the real directory picker, existing SDK callbacks,
settings save, and added scroll/clipping/footer assertions (`native-workspace.log`,
`native-settings-scroll.png`). The executable is
`src-tauri/target/release/pi-agent-desktop.exe`; installer packaging was not run.
The existing Vite chunk-size warning is unchanged. Temporary 1540/4331/9225
listeners are closed; owned preview 1451 and backend 4351 remain. The application
contract validator passes with zero warnings. Acceptance ends at these two
categories and the established Windows/five-width scope.

## Folder-derived workspace names and minimal add flow — 2026-10-07

[Product] Workspace rows must use the selected folder's actual basename.
At that earlier checkpoint the preview pointed to two test directories named `workspace`;
that title came from their paths, not a fixed product title. Verify a distinct
CJK/spaced folder name through registration and subsequent session creation.
Do not rename, move or switch the user's existing workspace to disguise it.

[Observed] Official WorkspacePicker's add-only action goes directly to the
directory selection flow. Claude's Project folder chooses the task directory.
Existing workspace navigation belongs in the sidebar, not in the add form.
Source evidence remains `docs/workspace-sidebar-references.md` and the saved
official WorkspacePicker/DirectoryBrowser source.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Workspace rows/populated | Identify the task directory / M1, M5, M6 | Keep names derived from folder paths, parent disambiguation only for duplicates, full path on hover | A CJK/spaced folder appears by that exact name; no generic-name substitution or basename merging |
| Add workspace/empty, invalid, submitted | Select a task directory / M3, M4, M5 | Desktop keeps the native directory picker; browser fallback has just a folder-path field and cancel/add actions, errors adjacent to the field | No repeated history/path list or redundant help; empty submit disabled; cancellation/invalid paths preserve the original session; valid add opens a new session and deduplicates |

[Historical adaptation, superseded by the UI omissions repair below] The browser preview retained explicit path entry because it cannot
use Tauri's native picker. The previous exclusion of a web filesystem browser is superseded in this
repair. Complete this category before grouped checks at five agreed widths;
reuse workspace registration and native picker cancellation checks. Preserve
the current preview at 1451 and its session/messages/draft/settings.

### Workspace name and add-flow verification

The two preview directories at that earlier checkpoint both had basename `workspace`.
Registration of a real CJK/spaced directory displays `桌面项目 pi-agent` and
creates sessions in that exact directory. A repeated path with a trailing
separator does not create another workspace. The add form now has one focused
path field, cancel/add actions, and only relevant inline errors; the normal
desktop form height decreases from approximately 357px to 203px.

Grouped checks pass for the six unaffected navigation/settings/conversation
cases in `.local/workspace-picker/interactions.log`. The affected registration
check passes in `workspace-final.log`, including empty/invalid/cancelled/valid/
duplicate paths, corrected input clearing its error and original draft recovery.
The first pass identified missing automatic focus; field-level autoFocus fixes
it. A subsequent check caught an implementation mistake using the registration
response's current-session cwd; new sessions now use the operator's selected
path and preserve the SDK's own normalization.

Read-only preview capture passes at the five widths without page errors or
document overflow and confirms the existing session, cwd, messages, draft,
workspace list and global/project settings are unchanged (`after/report.json`,
`preview-final.log`). Empty/short/narrow dialog and real folder-name screenshots
were visually inspected. The final TypeScript/frontend/backend/Rust release
build passes (`release-build-final.log`); native WebView2 directory cancellation,
workspace and existing settings/file/terminal flows pass (`native-workspace.log`)
using the real system picker. Installer packaging was not run. Temporary
1540/4331/9225 listeners are closed; 1451/4351 remain. The contract validator
passes with zero warnings. That historical scope is superseded by the following repair.

## UI Interaction Omissions Repair — 2026-10-07

[Product] User explicitly requests fixing the workspace omission and auditing the
entire UI for the same unjustified reductions. Inventory and count are in
`docs/ui-interaction-omissions.md`. The previous path-only fallback and preserving
single-level file navigation are not current acceptance criteria.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Empty composer workspace selector | Start in a chosen project / M1, M3 | Registered folders with current check, full path, fixed add action | Choose another directory creates its session and preserves old draft |
| Browser folder picker/default, loading, error | Browse and open task directory / M3, M4, M5 | Two directory columns, breadcrumbs, editable path, parent/home/drives, dot-directory toggle and new folder; native keeps OS picker | Browse/create/open/cancel without unintended registration; inline failures; bounded modal at five widths |
| Sidebar search/collapsed, expanded | Find sessions / M1, M5 | Header icon expands search and close restores title | Ctrl+K focuses search; query expands matching projects; closing restores disclosure |
| Files/tree/review | Inspect related evidence / M1, M4, M5 | Lazy expandable file tree, visible-directory toggle, diff file opener/wrap, collapsible conversation hierarchy | Parent paths remain, selected file is revealed, original preview/attachment and SDK tree navigation work |
| Menus/local dialogs | Complete focused actions / M3, M5 | Standard keyboard navigation and errors inside active modal | Disabled items skipped, Escape returns focus, failure remains actionable |
| Tool steps/argument streaming, executing | Inspect current work / M2, M4 | Per-tool disclosure stays available before the result arrives; original SDK renderer owns content | Expand a pending call, read live arguments/results, collapse/reopen without cancelling generation |
| Custom provider/model settings | Configure real SDK endpoint / M4, M5 | Structured editor of Pi models.json; advanced unknown fields preserved | Saved endpoint/models reach registry; cancelling leaves file unchanged; errors stay within form |

[Observed] Official Harness source establishes the workspace, directory browser,
file tree/review and provider-editor anatomy. Claude documentation establishes
project selection beside the first prompt, without exact popup details.
[Adaptation] Pi session-tree collapse uses the SDK's real parentId, not a copied
Harness thread tree. Global model endpoint configuration follows Pi's registry.
The five-width/theme matrix and grouped verification above remain authoritative.

### UI omissions repair verification

All 11 confirmed workflow omissions in `docs/ui-interaction-omissions.md` are
implemented, including the pending-tool disclosure discovered by the original
renderer regression checks. The 42 distinct browser cases pass through grouped
runs and affected reruns; directory API checks, both themes at five widths,
Windows release build and the actual native workspace flow pass. Rendered
evidence and individual logs are in `.local/ui-omissions/`.

Source mechanisms M1/M3 carry project choice and session search; M4 carries the
folder browser, persistent file tree, conversation branches and pending tool
details; M5 keeps these overlays/forms within the existing tonal hierarchy.
SDK renderer callbacks, original terminal support and configuration persistence
remain in use. Advanced provider fields retain their JSON editing path.

Preview 1451 and its session, messages, draft, workspace registrations and settings
are preserved. Native/test windows and temporary listeners are closed. Installer
packaging, unknown Pi versions and arbitrary extension/platform combinations are
outside this verification, as previously requested by the user.

## Workspace identity and settings divider repair — 2026-10-07

[Product] The user selected `C:\Code\pi-agnet-desktop` for preview 1451.
The previous preview's two `workspace` labels were real fixture basenames;
preserve those sessions rather than rename directories or manufacture labels.
Register the selected project, open its session and retain the preview identity
for later restarts. Sidebar and composer must both display `pi-agnet-desktop`.
New frontend connections attach to an existing runtime rather than reselecting
the startup directory; first startup still restores the cached project. Explicit
workspace selection retains its existing initialization behavior.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Active workspace/sidebar and empty composer | Identify selected task directory / M1, M3 | Folder basename remains authoritative; preview uses user's selected real project | Actual 1451 snapshot cwd matches the project and rendered names match its basename; original sessions remain accessible |
| Settings/all seven categories | Read preferences without repeated rules / M4, M5 | A section owns the separator before the next section; preference rows have no separators | No group bottom borders or row bottom borders; appearance last item has no double rule; scroll/footer and drafts still work |
| Custom endpoint/model editor | Enter related configuration / M3, M5 | Explicit compact form grid rather than inherited preference rows; one model enclosure | Fields have no dividers and labels remain above controls; two columns on desktop, one on narrow widths; save/cancel unchanged |

[Adaptation] This repair concerns current workspace identity and visible settings
layout, not new SDK capabilities or additional platform compatibility. Use the
existing five-width/light-dark checks and grouped affected workflow tests.
Legacy number-only field styles are removed so text and numeric controls use
one shared input boundary, height and background in both themes.

### Workspace identity and settings repair verification

The initial 1451 capture reproduced the appearance page's two final rules and
the model form's inherited row dividers. It also confirmed the original two
folders were named `workspace`. After selecting the user's real project, a new
frontend connection reproduced a second cause: initialization reselected the
backend's startup fixture. The frontend now requests `resumeExisting` during
connection, and the host attaches to its active runtime. Explicit project
switches and first startup still initialize normally.

Final 1451 screenshots show `pi-agnet-desktop` in both sidebar and composer.
Original test sessions remain accessible, with their true folder names.
The new-frontend/reload regression preserves cwd, session ID and draft.
Recovery tests now start an absent runtime when testing first-start extensions;
an existing active runtime is deliberately retained when a view connects.

The affected 20 distinct browser cases pass through grouped runs and repaired
affected reruns (`workflows-final.log`, `connection-final.log`,
`settings-final.log`, `provider-verified.log`). Direct review covers all seven
settings categories at 1440/1024/768/390/375px in light and dark themes, plus model
form top/bottom captures. Computed row/group bottom rules are zero, form layout
has two/one columns as specified, and text/number field skins match. Live state,
workspace registrations and global/project settings are unchanged by this QA.
Evidence is in `.local/workspace-settings/`.

The final Windows release build and actual native desktop workspace/settings/
file/terminal workflow pass (`release-build.log`, `native-final.log`). Only
1451/4351 remain listening; temporary browser/native test servers are closed.
The source contract and SDK/xterm compatibility boundary remain unchanged.

## Overall rendered layout repair — 2026-10-07

[Product] Audit the current shell, conversation, evidence, terminal, menus,
dialogs and seven settings categories together. The live preview remains on
the user's project and keeps its session, draft and configuration. Verification
is grouped after a category is complete, with a finite representative state set.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Composer/workspace chooser | Identify the task directory without interrupting input / M1, M3 | Dedicated compact control anatomy; remove obsolete sidebar styling | Workspace, context and send controls align on desktop; narrow toolbar has intentional two-row flow; basename truncates safely |
| MCP/package add forms | Enter related integration configuration / M3, M5 | Header with cancel, label-above fields, outlined entry controls and right-aligned primary action | Empty-state does not coexist with an empty add form; all fields use one form layout; opening reveals header and focuses first field |
| Model defaults and endpoint editor | Distinguish preferences from endpoint editing / M4, M5 | Compact heading/scope row; editor owns its save action | Scope stays with section title; preference-save footer is hidden during endpoint editing and returns afterwards without losing drafts |
| Populated conversation/file preview/feedback | Read results and inspect supporting evidence / M2, M4, M5 | Keep SDK renderer, locally scrolling code/files and existing status semantics | Markdown, tool details, file content, local errors, authentication and representative extension UI render within their carriers in both themes |

[Observed] The existing official Harness source and contract remain the source
of anatomy and hierarchy. [Adaptation] These repairs address confirmed styling
collisions and inconsistent form composition, without new SDK or platform scope.
Check the existing five-width/light-dark matrix plus a short desktop viewport.
Baseline captures cover 104 live states; the remaining content states use an
isolated fixture so the live session is not populated for the audit.

### Overall layout repair verification

Confirmed drift is repaired at its source: obsolete sidebar workspace selectors
are removed, the composer has dedicated compact anatomy, integration forms use
one label-above layout and action hierarchy, and model scope/editor save regions
have distinct roles. Final code review also corrected the new form-focus helper
to follow the active category while retaining drafts in other categories.

Rendered review covers the complete primary carrier inventory at five widths
and both themes, plus short desktop height, populated Markdown/tools/file
preview, actual Git diff, local errors, authentication selection and standard
extension confirmation. Actual SDK theme assertions protect the content matrix.
The grouped workflows and affected reruns pass, including cross-category focus
and drafts. Source mechanisms M1/M3 carry compact project/input choice, M2/M4
carry readable conversation/evidence and M5 carries consistent forms/feedback.

The final Windows release build (`release-complete.log`) and actual native
workspace/settings/file/tool/terminal workflow (`native-complete.log`) pass.
The native screenshots were inspected. Live 1451 remains on the user's project
with the same session, messages, draft and registered workspaces; capture checks
also preserve global/project settings. Temporary test/native listeners close.
Detailed inventory, causes and evidence are in `docs/full-ui-layout-review.md`
and `.local/full-ui-review/`. This is the bounded current-UI verification already
agreed with the user; no new future-version or arbitrary-platform guarantee.

## Settings separator and action consistency repair

[Product] User reports remaining overlapping dividers and inconsistent buttons.
The new baseline reproduces a generic toolbar bottom border directly touching
the JSON editor's top border, and body actions with 28/36/44px heights and
4/6/12px radii. Earlier group/field checks did not inspect the toolbar or button
anatomy; previous whole-UI claims do not supersede these reproduced defects.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Settings toolbars and JSON editor | Navigate/actions next to configuration / M3, M5 | Dedicated settings toolbar, without inherited panel separator; editor retains its own boundary and space before it | Every settings toolbar has zero top/bottom border and no overlapping pseudo separator; JSON editor is separated from actions by at least 12px |
| Body actions in all seven settings categories and endpoint/model forms | Consistent action hierarchy / M3, M5 | One shared settings button: 32px height, 13px type, 8px radius; primary, secondary and quiet variants; icon-only utilities retain 28px square anatomy | Save/install actions share size and primary styling; secondary actions share outline style; text actions share quiet style; no dashed special provider-add carrier |
| Forms, confirm/cancel, footer and scope selection | Maintain focused edits / M4, M5 | Retain callbacks, draft state, disabled/loading and original persistence | Grouped provider CRUD/settings draft/scroll/focus tests pass; all edited states fit both themes and the five widths |

[Adaptation] Consistency is by action role: navigation, switches and embedded
scope/model selectors keep their established anatomy. Read-only live capture
preserves user session/settings; destructive and saving states use isolated
fixtures. Repair the settings category together before grouped verification.

## Interface language and remaining-state audit

[Product] Inspect the complete current UI for omissions and implement Simplified
Chinese and English. Keep live workspace, session, draft and settings intact.

| Target carrier/state | Product role / mechanisms | Adaptation | Observable acceptance |
| --- | --- | --- | --- |
| Appearance language preference | Choose the desktop language / M3, M5 | Persistent local preference, defaults to existing Simplified Chinese; immediate change without remounting the application | Change to English and reload; html language, labels, tooltips and dialogs follow the choice; workspace/session/composer and configuration drafts survive |
| Owned interface text throughout shell, settings, conversation, files, menus and dialogs | Explain controls and state / M2, M4, M5 | Shared typed catalog, interpolation and locale-sensitive dates/numbers; preserve user text, paths, identifiers and third-party extension content | Catalog parity; owned UI contains no untranslated Chinese in English; long labels fit the five-width and light/dark matrix |
| Remaining primary and transient states | Catch omitted visual anatomy / M3, M4, M5 | Check actual rendered controls, separators, loading/errors, editing/confirmation and evidence states together | Shared settings action geometry applies to actual buttons; no touching toolbar/editor rules, overlapping controls or page overflow; grouped workflows pass |

[Adaptation] Localization covers desktop-owned UI. Original SDK/extension content,
service errors, model/provider names, technical identifiers and user-created
session titles retain their source text. Native OS dialogs follow OS language.

### Interface language and settings verification

The shared settings class is passed through Button's supported `className` prop;
the actual body actions now have 32px height, 13px type and 8px radius. Dedicated
settings toolbars have no inherited panel boundary. Live capture verifies 160
settings states and 260 complete primary-carrier states without page overflow or
errors, preserving current project/session/draft/settings.

The catalog contains 486 owned copy entries. English rendering covers all seven
settings categories and primary carriers in both themes and the five widths,
including short desktop height. 128 English screenshots support the review.
Locale updates and reload preserve editor text, session identity, messages and
configuration; marked desktop options translate while callbacks receive original
values and third-party titles/content remain unchanged.

The final affected groups pass (`affected-workflows.log`, `mapped-verified.log`),
including mapped component close actions and editor completions. An obsolete
combobox assertion was updated to operate the existing completion listbox. The
final Windows release build and native workspace/settings/file/terminal/language
workflow pass (`release-final.log`, `native-release-final.log`). The first native
startup wait failure and its successful bounded reruns remain in the report.

Live 1451 uses the updated host. Its empty session was not yet on disk; recovery
restored the original session ID through the public SDK ID option and persisted
an empty header. Final preview checks preserve cwd, ID, messages, draft, registered
workspaces and both settings scopes. Detailed scope, evidence and limitations are
in `docs/interface-localization.md` and `.local/i18n/`.
