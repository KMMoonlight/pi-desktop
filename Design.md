# Design — DeepSeek Harness desktop composition

> Analyzed: 2026-10-07
> Scope: Official Harness page's depicted desktop UI; Claude Code Desktop's documented project/session organization
> Locale: English source, Chinese target
> Signature mechanisms: M1 compact project navigation; M2 quiet conversation canvas; M3 enclosed prompt dock
> Evidence labels: `[Observed]`, `[Inferred]`, `[Recommended]`
> Preview: [Design.preview.html](./Design.preview.html)

## Runtime source refinement — 2026-10-07

[Observed] The full official source at commit
`5badb15009ae1756c3afe0ae0cef1faafc290ccc` refines the scaled marketing depiction
below. The implementation uses these runtime values when the two differ; the
paired Preview remains the original depiction specimen, not a desktop template.
Complete evidence and region mapping: `docs/deepseek-shared-ui-audit.md` and its
43-item secondary audit.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas / sidebar | #fff / #f9fafb | #151517 / #1b1b1c |
| Input / bubble | #fff / #edf3fe | #2c2c2e / #2c2c2e |
| Selector | #f5f6f7 | #353638 |
| Primary / secondary / tertiary text | #0f1115 / #61666b / #81858c | #f9fafb / #cfd3d6 / #adb2b8 |
| Business accent | #4176e6 | #7aaaff |

[Observed] Runtime default rail is 280px, project/session rows 34/32px,
title+tabs 76px with active underline, message bubbles 20px radius and 10/16px
padding, prompt 28px radius with a growing textarea, model triggers 28px, enum
selectors 36px filled, menu rows 34px, settings dialog 800px with 188px category
rail, and auxiliary pane headers 38px. UI and code stacks include system/CJK
fallbacks. These instantiate the existing M1–M6 mechanisms at actual app scale.

[Product] Light remains the user's selected default. Context stays inside the
prompt; terminal stays in the current bottom dock; Pi scope, SDK renderers and
extension callbacks remain authoritative. No Harness-exclusive account balance,
marketplace, per-turn file snapshot, docking or automation feature is implied.

## Overview

The Harness product depiction puts a compact workspace/session rail beside a
quiet conversation canvas. Tonal surfaces establish hierarchy, and a rounded
prompt dock collects configuration and the decisive send action. These findings
describe the depicted app, not the landing page's blue glow or marketing hero.

- Navigation occupies a narrow stable rail rather than a second row across chat.
- Workspace and session rows repeat compact anatomy with a tonal active state.
- Assistant content reads as a document; user input has a separate rounded well.
- The prompt's enclosure gathers context, model configuration and submission.
- Auxiliary evidence is disclosed beside the primary task when needed.

## Coverage & Sources

| Page/job              | Surface context                                      | URL                                     | Viewport/state/snapshot                          | Evidence                                                                                                              |
| --------------------- | ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Harness conversation  | First-party HTML product depiction, dark             | https://www.deepseek.com/en/harness/    | 1440, 1024, 768, 390; public English; 2026-10-07 | Rendered hero app, DOM and computed carriers in `.local/design-evidence/harness-carriers.json`                        |
| Harness plugins       | First-party depicted plugin task and manager         | https://www.deepseek.com/en/harness/    | 1440; scrolled feature region                    | `.local/design-evidence/harness-Everything-is-a-plugin.png`                                                           |
| Harness file review   | First-party depicted document chips and diff         | https://www.deepseek.com/en/harness/    | 1440; scrolled feature region                    | `.local/design-evidence/harness-Complete-a-range-of-tasks.png`                                                        |
| Harness traces        | First-party depicted developer evidence              | https://www.deepseek.com/en/harness/    | 1440; scrolled feature region                    | `.local/design-evidence/harness-Developer-tools.png`                                                                  |
| Claude Code workspace | Official documentation, not authenticated app pixels | https://code.claude.com/docs/en/desktop | 1440; public English documentation               | Describes session/project sidebar, prompt configuration and optional panes; `.local/design-evidence/claude-code.json` |

No login, downloads, external submissions or app installation were performed.
The Harness marketing page scales its app depiction; this does not prove the
running desktop app's breakpoints. Exact source declarations below are scoped to
that depiction. Claude's pixels and proprietary fonts are not inferred from docs.

## Design Mechanism Map

| ID  | Carrier                | Operator                                                       | Role          | Scope                                                       | Priority   | Evidence                                                                                                            |
| --- | ---------------------- | -------------------------------------------------------------- | ------------- | ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| M1  | Workspace/session rail | Narrow measure, grouping, repeated rows, tonal selection       | Navigation    | Harness depicted conversation; Claude documented projects   | Signature  | [Observed] sidebar is 228.8px within a 1020px depicted window; session/workspace rows; Claude session documentation |
| M2  | Conversation surface   | Large quiet field, restrained chrome, readable central measure | Comprehension | Harness conversation and feature task depictions            | Signature  | [Observed] narrow title strip, assistant document, separated user bubble in rendered captures                       |
| M3  | Prompt dock            | Rounded enclosure, toolbar grouping, corner send action        | Action        | Harness conversation and plugin task                        | Signature  | [Observed] composer rgb(44,44,46), radius 19.8px at depicted scale; low toolbar contrast                            |
| M4  | Auxiliary evidence     | Progressive disclosure and adjacent pane                       | Comprehension | Harness diff/trace depiction; Claude documented pane layout | Structural | [Observed] file/diff feature capture; [Observed] Claude documents chat, diff, editor and browser panes              |
| M5  | Surfaces               | Tonal steps with quiet hairlines                               | Hierarchy     | Harness dark UI depictions                                  | Structural | [Observed] sidebar rgb(52,58,67), prompt rgb(44,44,46), selected action white at 8% opacity                         |
| M6  | Text and controls      | Compact labels, consistent system stack, sparse accent         | Hierarchy     | Harness depicted controls                                   | Supporting | [Observed] system stack includes Segoe UI and CJK fallbacks, 12.32px rail labels at depicted scale                  |

## Rail, document and prompt

Composes: M1, M2, M3, M5. The rail handles navigation; the canvas carries work;
the prompt gathers actions. Removing a redundant main navigation strip makes the
conversation's primary role visible. A larger blank canvas alone would not express
the source: it needs the compact rail and strongly enclosed prompt together.

## Colors

| Role             | Value   | Context                     | Evidence                                                 |
| ---------------- | ------- | --------------------------- | -------------------------------------------------------- |
| Canvas           | #141414 | Depicted dark conversation  | [Observed] rendered source; screenshot-derived estimate  |
| Sidebar surface  | #343a43 | Depicted sidebar            | [Observed] computed rgb(52,58,67)                        |
| Composer surface | #2c2c2e | Depicted prompt             | [Observed] computed rgb(44,44,46)                        |
| Text.primary     | #f9fafb | Depicted sidebar and prompt | [Observed] computed rgb(249,250,251)                     |
| Muted text       | #cfd3d6 | Depicted prompt toolbar     | [Observed] computed rgb(207,211,214)                     |
| Accent           | #7a9cec | Depicted send control       | [Inferred] rendered blue send control; approximate value |
| Hairline         | #292929 | Depicted title separator    | [Inferred] rendered dark separator; approximate value    |
| Surface.hover    | #40454d | Dark specimen hover well    | [Recommended] solid approximation of the tonal selection |
| Inverse surface  | #f9fafb | Preview inverse specimens   | [Recommended] light surface paired with dark canvas ink  |

Target light/dark values are adaptations in DESIGN.application.md. Status colors
are target semantic requirements, not source palette guarantees.
The hover and inverse roles complete the generator's standard specimen controls;
they do not establish additional source app states or target requirements.

## Typography

| Role              | Family                                           | Size    | Weight | Evidence                                                                  |
| ----------------- | ------------------------------------------------ | ------- | ------ | ------------------------------------------------------------------------- |
| Sidebar label     | Segoe UI, system-ui, Microsoft YaHei, sans-serif | 12.32px | 400    | [Observed] scaled product depiction computed style                        |
| Conversation text | Segoe UI, system-ui, Microsoft YaHei, sans-serif | 12.6px  | 400    | [Observed] depiction root; not a standalone desktop font-size requirement |
| Target body       | Segoe UI, system-ui, Microsoft YaHei, sans-serif | 14px    | 400    | [Recommended] unscaled native desktop legibility                          |

## Layout & Spacing

The observed depicted window measures 1020 by 612px with a 228.8px rail. The
composer dock measures 685.8px and encloses a prompt with a 19.8px radius. These
values describe source proportions. Target desktop spacing uses a normalized
4/8/12/16/24/32px scale [Recommended], not copied marketing-window geometry.

| Viewport         | Transformation                                                                         |
| ---------------- | -------------------------------------------------------------------------------------- |
| 1440px           | [Observed] full product depiction retains rail and prompt anatomy                      |
| 1024px and 768px | [Observed] marketing depiction scales within the page                                  |
| 390px            | [Observed] marketing depicts the app at reduced size; real app drawer behavior unknown |

## Components

### Workspace rail

Brand, new-session action, auxiliary destinations, grouped workspace and session
rows, bottom account/status utility. Selection uses a tonal well [Observed].

### Conversation

Compact title strip, user bubble, assistant document, muted thinking disclosure,
and a prompt dock [Observed]. Product tasks supply the content.

### Prompt dock

Rounded input surface with attachment/context control, compact configuration and
send control. Disabled and focus states of the live app are not observed.

### Evidence pane

File/diff and trace information are adjacent secondary carriers in the source
depictions. Target disclosure mechanics are an adaptation to Pi's existing views.

## Do's and Don'ts

| Do                                                                           | Avoid                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Compose compact navigation, readable content and an enclosed prompt together | Copying the public page's glow, marketing hero or download controls into the app |
| Distinguish selection and nesting with tonal steps                           | Coloring every separator with the agent's terminal theme accent                  |
| Keep working detail available through disclosure                             | A permanently open tool/metric column dominating every empty conversation        |
| Use original Pi content, icons and interactions                              | Copying source brand assets or adding unsupported automation features            |

## Known Gaps

The public source depicts the app; it does not prove authenticated behavior,
physical input, actual desktop breakpoints or all themes. Claude supplies documented
information architecture, not exact style tokens. Target light theme, Chinese
copy, empty state and narrow drawers are explicit adaptations. These gaps do not
require adding features or inspecting unrelated public marketing pages.
