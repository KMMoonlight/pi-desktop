# Native conversation notices

The desktop calls Pi 1.0.0's original InteractiveMode notice methods through the version-bound component runtime. The receiver supplies the current original AgentSession, SettingsManager and SessionManager plus a synchronous chat sink; it does not construct the CLI or change SDK exports, prototypes or source. Original Spacer and ThemedText instances enter the shared native message container. The desktop renders those same objects through the generic ANSI text mapper into chronological conversation rows.

## Notice policy

All four categories follow `SettingsManager.getShowCacheMissNotices()`:

| Category                    | Original source                                                                    | Lifetime                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cache warming               | `addCacheWarmingUsage`, including the original note and cost precision             | Reconstructed from persisted `usage` entries with `kind: "cache_warm"`      |
| Cache miss                  | `maybeShowCacheMissNotice`, `addCacheMissNotice` and original `collectCacheMisses` | Derived from original assistant usage; never persisted as a separate notice |
| Compaction / branch billing | `addCompactionCostNotice`                                                          | Reconstructed from summary-entry usage, after its visible summary           |
| Dropped thinking            | `maybeShowThinkingDropNotice`                                                      | Live successful assistant completions only; omitted during reconstruction   |

Pi's original cache thresholds, noise floor, TTL, model-switch precedence, cost suffix, token formatting and previous-branch thinking-count rules remain authoritative. Aborted/error assistant completions do not add cache or thinking notices. Unrelated usage categories are ignored. Summary costs require a projected visible summary contribution.

## Ordering and ownership

`message_end` reaches public subscribers before the current assistant response is appended to SessionManager. The original live detectors run at that point; a synchronous snapshot can already show their rows beside the Agent state message. After persistence, reconstruction adopts the live native pair without creating duplicates or replacing its instances. Stable notice IDs use persisted entry IDs or hashes of original messages rather than embedding message text.

Usage entries attach after the preceding visible contribution, including leading usage before the first message. Assistant notices follow their message and tool-call rows. Summary billing follows its summary. A live compaction rebuild follows branch chronology, placing retained messages before the newly completed summary. Session resume/resource rebuild uses the context-entry order of Pi's original reconstruction, where the current compaction summary precedes retained context. Only presentation order changes; SDK messages and session JSONL remain intact.

Repeated snapshots preserve native notice instances and direct component mutations. Theme invalidation follows original ThemedText behavior: its builder regenerates themed content, so a direct `setText` value can be replaced after invalidation. Both native and desktop presentations render those original objects. Desktop rows retain their DOM identity across unchanged snapshots and native text updates.

Changing the show-cache-notices setting rebuilds the notice view. Transient thinking notices disappear; persisted warming, cache misses and summary usage are reconstructed when enabled again. Session resets/reload/switch/fork/import clear session-owned notices while retaining the shared ApplicationComponents/TUI owner. Hard retirement disposes the notice owner and ignores late events.

## API and scope

Backend SDK operations can inspect the original rows through `desktop.terminalRuntime.capture().application.conversationNotices.entries(afterMessageId?)`. Desktop snapshots expose optional `conversationNotices` entries containing a stable ID, an optional preceding desktop message ID and ANSI-mapped text presentation. No extra action endpoint or extension-specific adapter is needed.

This category covers conversation billing/cache/diagnostic notices. Original startup resource/header/pending/widget content and other CLI-only application policies remain separate completion targets. It does not establish compatibility with future SDK versions, physical input devices, every private component ownership pattern, arbitrary terminal protocols or real external accounts.
