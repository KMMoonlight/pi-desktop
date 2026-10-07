# Overnight Execution Audit

Scope: 2026-10-05 20:14:12 to 2026-10-06 08:47:08, Asia/Shanghai (UTC+08:00).

Elapsed time: 752.9 minutes. This includes 15 completed work rounds; the overlay-handle round starting at 08:47 is excluded.

## Process Time

Durations below are cumulative process durations. Concurrent processes overlap, so this is not an exclusive division of elapsed time.

| Activity | Commands | Cumulative Minutes | Failed Commands | Failed Minutes |
| --- | ---: | ---: | ---: | ---: |
| Browser tests | 61 | 258.0 | 24 | 56.5 |
| NSIS packaging | 16 | 96.2 | 0 | 0.0 |
| Native WebView tests | 51 | 73.8 | 2 | 3.0 |
| Integration tests | 121 | 52.9 | 47 | 13.7 |
| Native build | 20 | 47.7 | 0 | 0.0 |
| Types / formatting / SDK audit | 168 | 23.6 | 15 | 5.3 |
| Reads and inspection | 1396 | 19.3 | 66 | 1.3 |
| Other commands | 110 | 3.1 | 3 | 0.1 |

Failed runs include intentional red-before-fix regressions, startup timeouts and harness errors. They cannot all be classified as wasted work.

## Exclusive Recorded Command Lifetimes

This table sweeps recorded command start/end timestamps. Overlapping categories are counted once under the multi-category row. These intervals include tool startup/coordination overhead and differ from pure process duration.

| Recorded State | Minutes | Share of Elapsed Time |
| --- | ---: | ---: |
| No recorded command running | 352.4 | 46.8% |
| Multiple command categories running | 136.7 | 18.2% |
| Browser tests | 130.1 | 17.3% |
| NSIS packaging | 73.1 | 9.7% |
| Integration tests | 22.3 | 3.0% |
| Native WebView tests | 20.3 | 2.7% |
| Types / formatting / SDK audit | 10.2 | 1.4% |
| Native build | 4.9 | 0.6% |
| Reads and inspection | 2.7 | 0.4% |
| Other commands | 0.3 | 0.0% |

No-command-running time includes analysis, patch/source generation, messages, other tools, scheduling and waiting. It is not a measurement of coding time alone.

## Changed Lines by Phase

These are cumulative successful patch additions/deletions, including repeat edits and reversions. They exclude formatter changes and are not a baseline-to-final diff. Each phase's elapsed time includes implementation, investigation, verification and packaging.

| Time | Phase | Elapsed Minutes | Product + / - | Tests + / - | Docs + / - | Local Helpers + / - |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 20:14-01:10 | Layouts and transformed component frames | 296.3 | +485 / -205 | +1540 / -114 | +212 / -72 | +321 / -0 |
| 01:10-02:59 | Wrappers and collection ownership | 108.9 | +130 / -65 | +644 / -18 | +73 / -27 | +116 / -0 |
| 02:59-04:55 | Terminal child focus and presentation transitions | 116.0 | +62 / -9 | +824 / -26 | +73 / -16 | +112 / -0 |
| 04:55-08:08 | Disposal, reuse and asynchronous callback ownership | 193.2 | +413 / -155 | +1459 / -40 | +160 / -50 | +544 / -6 |
| 08:08-08:47 | Custom result and cleanup ordering | 38.5 | +39 / -18 | +291 / -18 | +40 / -8 | +93 / -0 |

## Changed-Line Totals

| Group | Added | Removed | File Edit Events | Distinct Files |
| --- | ---: | ---: | ---: | ---: |
| product | 1129 | 452 | 61 | 11 |
| tests | 4758 | 216 | 172 | 38 |
| documentation | 558 | 173 | 139 | 4 |
| localHelpers | 1186 | 6 | 45 | 41 |
| configurationOrOther | 0 | 0 | 0 | 0 |

Successful patch batches: 239. Distinct changed files: 94. Formatting --write commands: 97.

## Product Files

| File | Added | Removed | File Edit Events |
| --- | ---: | ---: | ---: |
| backend/component-mapping.ts | 491 | 212 | 25 |
| backend/component-disposal.ts | 400 | 126 | 9 |
| backend/component-delegation.ts | 85 | 47 | 5 |
| src/DesktopExtensions.tsx | 49 | 31 | 8 |
| backend/component-render.ts | 44 | 15 | 3 |
| backend/desktop-ui.ts | 27 | 14 | 4 |
| backend/authorization-scopes.ts | 12 | 4 | 1 |
| src/styles.css | 10 | 0 | 2 |
| shared/desktop-ui.ts | 6 | 3 | 2 |
| backend/terminal-host.ts | 4 | 0 | 1 |
| backend/tui-api.ts | 1 | 0 | 1 |

## Evidence and Limits

- Source: the original execution log for chat 01a0ff74-621a-7231-bca7-b9f6c29b550e; only CommandExecution/FileChange metadata and successful patch changes are analyzed.
- Repeated records are deduplicated by event ID. Malformed JSON records: 0.
- The workspace has no Git commit baseline. Counts therefore describe recorded patch activity, not final net source differences.
- There is one detected shell-copy command in this interval; it copies a log inside .local. Formatting changes are not reconstructed.
- Browser runtime includes a 455-case complete run (about 36 minutes) plus narrower regressions. Later releases do not inherit a fresh complete-suite result.
- The statistics do not establish feature completion or difficulty per line of code.
- Reproducer: .local/audit-overnight.mjs. Detailed machine-readable totals: .local/overnight-audit-2026-10-06.json.
