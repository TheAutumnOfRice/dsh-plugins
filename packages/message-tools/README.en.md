# dsh-client-message-tools

English | [中文](README.md)

Sent messages can still be edited or withdrawn — and a withdrawal really deletes them from the model's memory, not just marks them.

Said something too fast, or the conversation went off the rails? Until now all you could do was send another message to correct course. This plugin puts a row of small buttons on every message you send: copy, edit, withdraw. Editing rewrites in place and re-sends, and the model answers the new text; withdrawing takes that message and everything after it out of the model context, folding it into an expandable "N messages withdrawn" divider — and the original text lands back in your composer draft (never auto-sent). Changed your mind? The divider's "restore to end of conversation" puts it all back.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions1.png" width="640" alt="copy, edit, and withdraw action buttons under a user message">

## Features

- **Action row on every user message** — copy, edit, and withdraw on user bubbles and admitted steering messages.
- **Edit in place** — inline editor with a working model chip; saving regenerates the turn from that point, and edited bubbles edit again.
- **Real withdrawal, not a marker** — the message and the whole tail after it leave the model context, collapsing into an expandable 「已撤回 N 条消息」 divider; expanding it replays the withdrawn user text, the images sent with those messages, and the assistant text (image-only messages count toward N).
- **Draft backfill** — a landed withdrawal puts the original text back into the composer draft, never auto-sent.
- **Restore to tail** — 「恢复到对话末尾」 replays user messages verbatim and assistant text as a 「已恢复」 group; tool calls never replay.

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions2.png" width="640" alt="in-place editing: the message becomes an input with a model picker; saving re-sends it as a new message, and the edited original leaves the model context">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions3.png" width="640" alt="the confirmation dialog before withdrawing, explaining that the message and everything after it will be hidden from the model and the original text backfilled into the composer">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions4.png" width="640" alt="withdrawn content folds into an expandable divider with a restore-to-end-of-conversation button at the bottom">

<img src="https://raw.githubusercontent.com/Khorsheed/dsh-basic/main/docs/screenshots/message-actions5.png" width="640" alt="restored messages return to the tail of the conversation as they were, grouped under a Restored section">

## Install

```sh
dsh plugin --profile web add @khorsheed/dsh-client-message-tools
```

Restart the web instance to activate; uninstall restores the previous composition exactly.

```sh
dsh plugin --profile web remove @khorsheed/dsh-client-message-tools
```

## Phone (/m)

The plugin list of `/m` (dsh-mobile-ui's phone UI) gains a **Messages** entry: withdraw, edit-and-resend, and restore work from the phone too.

- The list shows the session's **actionable messages** newest first — originals, edit replacements, and restore replays, exactly the targets withdraw/edit accept (withdrawal placeholders, edit triggers, and assistant-text replays are absent, because the service rejects actions on them). Each row carries its seq, state (Live / Withdrawn), origin (Edited / Restored) and text; live rows offer `Edit & resend` / `Withdraw`, withdrawn rows offer `Restore`, and an image-carrying message is flagged (the editor is text-only, matching the desktop).
- The phone has no Remote client, so the page uses this plugin's own two **same-origin** routes: `GET /message-tools/m/state?session=<id>` for the list and `POST /message-tools/m/action` for `{action: withdraw|edit|restore, sessionId, targetSeq, text?}`. Both call the **same** service methods the desktop does, so a phone action lands the identical replacement event and introduces no new event type.
- Both routes accept same-origin requests only (an `Origin` must match `Host`; a `Sec-Fetch-Site` other than `same-origin`/`none` is refused with 403), and a POST must be `application/json` under 64 KiB. They deliberately do **not** require a cookie: `/m` is commonly reached over a LAN address or a tunnel where the `dsh-auth-*` cookie is absent (which is why dsh-mobile-ui re-serves the RPC paths itself), so a cookie check would lock out the very client this surface exists for.
- The renderer lives at `<package>/lib/mobile/plugin.js` and is discovered by dsh-mobile-ui from the profile dependencies at boot — **adding or changing it needs a dsh web restart**; the build (`pnpm run build`) copies the repository's `mobile/plugin.js` into `lib/mobile/`.
- `@deepseek-ai/dsh-host-webserver` is an **optional** peer: compositions without a Web server (headless, desktop host) simply do not mount these routes, and keep the full service and tool surface.

## Compatibility

- npm release line (`@deepseek-ai/dsh@0.1.5-rc.1`): ✅ full — adapted to the 0.1.5-rc.1 format v2/v3 (`assistant/attempt` replaces `assistant/chunk`; the surfaceOp replace fields `start`/`end` are renamed `startSeq`/`endSeq`), full build+test green; minHost moves up to 0.1.5-rc.1 — older hosts stay on the previous release line. The Session V4 producer-owned source (kind `message-tools`) also writes durably on a 0.1.5 host: 0.1.5's `user/message` admission only requires a non-empty kind string.
- source line (deepseek-harness master): ✅ (verifiedHost: 0.1.7-rc.2) — Session V4 adaptation: the write side moved to the producer-owned source (kind `message-tools`; V4 native admission refuses the retired `kind: 'plugin'` wrapper), and the read side accepts the new kind, `plugin:message-tools` (the V3→V4 migrated form), and the released V3 wrapper (served verbatim on a 0.1.5 host); the `conversation.chat.node` rc.1 contract (the new hookContext/inject shapes, the `SessionEventLike` match-event union) re-verified; the ui-primitives icon rename (`Icon*Outline14/16` → `Icon*OutlineMedium`) followed.

**Version line mapping**: the first release after 0.2.0 supports host `0.1.5-rc.1` and later; hosts on `0.1.2-rc.1` stay on `0.2.0`, hosts on `0.1.0-rc.6` ~ `0.1.1-rc.2` stay on the 0.1.x release line (last release `0.1.0`).

## Known Limitations

- **Full-span hiding relies on an undocumented DOM attribute** — if upstream drops it, hiding degrades to renderer-only (user messages still hidden) with one `console.warn`, never an error.
- **Edit and withdrawal backfill are text-only** — image attachments of the original message do not enter the resend or the backfilled composer draft; they stay visible in the divider's expanded replay, so you can send them again yourself (the host has no public "set draft text + images" API — images can only be re-registered as a fresh upload).
- **Restore is a tail replay, not an in-place repair** — assistant text replays as framed user-role messages, tool calls/results never; the span stays out of the model context, and the restore entry exists only on withdrawal dividers.
- **Context and queued messages are out of scope** — context messages keep the official renderer (no action row); the official queue dock already edits/removes queued messages.

## How it works

<details>
<summary>Internals (click to expand)</summary>

**Architecture.** The browser half shadows the official user-message renderer (`conversation.chat.node`, keys `user` and `steering`, priority -1) with a visual clone that adds the action row, and registers four `ConversationNodeDefinition`s: a withdrawal projects as an expandable 「已撤回 N 条消息」 divider (N = user-visible messages hidden by the span), an edit replacement as an in-place bubble with an 「已编辑」 badge, and a restore entry as a replayed row in the 「已恢复」 group. The host half is the `messageTools` Typert Remote service (`withdraw` / `edit` / `restore`); the client mounts its generated Remote contribution via `ctx.remote.$mount`, so no core-package edits are needed.

**Edit** is an in-place replacement: the host appends one `user/message` replacement whose content IS the edited text (spanning the target and the surface tail — editing an old message discards what followed it), then starts regeneration via `agent.followup` with a minimal producer-sourced trigger. The edited text appears exactly once in the model context; the old content stays in the log as the audit trail. A running turn is cancelled first and awaited until fully settled — settle means the cancelled turn's teardown (tool results, `turn/end`) has fully landed in the log, not the `running` flip; the wait is bounded, a turn that never settles rejects with 「编辑失败」, and a failed cancel rejects without editing. Edit chains work: an edited bubble edits again, targeting the previous replacement's seq. The editor's model chip shares the per-session `ModelDirectory` (`ctx.get('modelDirectories')`, optional) with the composer and the /model popup — without ui-model-selection no chip renders — and the switch applies to the regenerated turn.

**Withdrawal** is real, not a marker: the host appends a `user/message` surface replacement (the compaction mechanism) spanning the target and every surface node after it, so the span leaves `session.surface` and never reaches the model again; the same cancel-and-settle choreography as edit keeps streaming content from landing after the replacement. The event carries the producer-owned source (kind `message-tools`), cites every shadowed node in `sourceEventSeqs`, and is durable (`SessionStore.flush`) before the method returns — it is the audit trail. No new event type is introduced: an out-of-harness type cannot carry `ignorable: true`, and a persisted unknown type would make session-persistence refuse the log on reload. A landed withdrawal backfills the target's original text into the composer draft (blank fills, non-empty appends a new line, info notice) — never auto-sent, nothing on failure; edits never backfill.

**Projection and hiding.** The plugin's Definition claims the replacement into a divider anchored at its seq. Hiding is two-layer: the shadowed user renderer renders nothing inside a hidden span, and a dynamic stylesheet drops every chat row whose `data-chat-flow-key` (`ChatNodeSeat.tsx`) anchors inside the span, covering assistant steps, tool calls, and turn tails. The hider probes that undocumented attribute on its first non-empty rule set and, on a miss, enters a bounded retry (MutationObserver plus deadline) so a not-yet-mounted chat doesn't disable it; only an expired window disables it — one `console.warn`, renderer-only hiding — and the observer outlives the disable, so late-mounting rows reactivate it. It never throws. The divider expands in place to a read-only replay of the span (user originals — text and the images sent with them — plus assistant text, folded from the live node store; images render through the official attachment gallery slot `renderMessageImages`, and a composition without it degrades to the text replay instead of throwing) with the 「恢复到对话末尾」 action; a span whose rows fell out of the loaded window shows 「撤回的内容不在当前已加载的历史中」 instead.

**Restore** is a tail replay of the whole withdrawn span, never an in-place repair: the surface fold is positional — a replaced span splices into exactly one node (`applySurfacePlan`) — so the span cannot re-enter the model context where it was, and its model-side hiding is never undone. The host walks the log interval `[start, seq)` delimited by the replacement itself and appends every replayable entry in original order: user messages verbatim (an edit replacement's content IS the last edit's text, so it replays as such) and each assistant reply's text as a framed producer-sourced user message — `assistant/message` requires the model source and the trace forbids assistant appends outside a step, so role fidelity is carried by the frame `(以下是先前被撤回、现随恢复放回的助手回复)`, stripped from display. An interrupted attempt without `assistant/message` is merged from its `assistant/attempt` event's embedded compact stream (reasoning-only content preserved). Tool calls/results never replay: the pairing cannot be re-entered and side effects are not replayable. Replayed rows render as the 「已恢复」 group — user bubbles with the full action row, assistant text via the official `MarkdownText` — and the divider carries a 「已恢复」 badge while a live restore row cites the span; withdrawing the restored rows again clears the badge and re-enables the action (restore events stay in the log).

**Why the projection cannot hide the span (the upstream seam a durable fix needs).** The assembler runs every Definition's `match` per event with no veto (`conversation-assembler.ts:370`), and `match(event)` reads only the current event; shadowed events keep `surfaceOp: 'append'` (the range metadata lives on the replacement only), so they still match the built-in Definitions, which exclude *replacement* events, not shadowed ones. Node `visibility` is set only by the owning Definition, the assembler forbids withdrawing a materialized node, and a node key is bound to its Definition's kind — a plugin can neither flip nor impersonate an official node. Shadowing the other `conversation.chat.node` keys fails too: the official components are not exported, and `command`/`turn-tail`/`tool-call` declare child slots a shadow cannot re-declare (`tool-call` owns the unbounded per-tool-name `tool.call.toolview` slot). The official compaction pipeline makes the same choice by design — a replaced span stays in the transcript.

**Model experience.**

- *Edit replacement* — the model reads the edited text and nothing that followed the original, plus one short trigger (`(用户编辑了上一条消息，请按编辑后的内容重新回答)`). Token effect: the shadowed span's tokens leave subsequent requests; the edit adds the edited message plus the trigger. KV cache: the prompt prefix is invalidated from the edit point.
- *Withdrawal replacement* — the span is replaced by one placeholder (`(用户撤回了这条消息及其后的所有内容)`). Token effect: the span's tokens leave; one short message is added. KV cache: the prefix is invalidated from the replacement point — the same trade compaction makes; withdrawing an older message discards more cached prefix.
- *Restore replay* — the span's replayable content (user messages verbatim, assistant text behind the frame) appends at the tail in original order, producer-tagged and citing original events; tool tokens stay out. KV cache: none beyond an ordinary tail append.

**Exports.** `/client` exports the plugin body (`apply`/`inject`) and the `MessageToolsRemote` type; the host export is the `MessageToolsService` class plus wire types under `/types`.

</details>

## Development

Part of the [dsh-plugins](https://github.com/Khorsheed/dsh-plugins) monorepo (`packages/message-tools`). Issues and contributions welcome there.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
