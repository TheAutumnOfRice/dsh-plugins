/**
 * Withdrawal planning: a pure fold from the session log and the live surface
 * to the replacement intent. Kept free of cordis and Session internals so the
 * unit tests drive it directly; the service only validates and appends.
 * @module @khorsheed/dsh-client-message-tools/withdraw
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  RESTORED_ASSISTANT_NOTICE,
  isMessageToolsEdit, isMessageToolsReplacement, isMessageToolsRestore, isMessageToolsRestoreAssistant,
} from './marker.ts'

/**
 * Whether a target seq names an editable user message: an append-surface
 * user-source message (an original), a message-tools restore replay (a
 * restored row withdraws and edits like the message it replays), or a
 * message-tools edit replacement (edit chains — the previous edit's
 * replacement is the surface node). Assistant-text restore replays carry no
 * actions and are excluded.
 */
export function isEditableTarget(event: SessionEvent | undefined): event is SessionEvent<'user/message'> {
  if (event === undefined || event.type !== 'user/message') return false
  if (isAppendSurfaceEvent(event)) {
    return event.data.source.kind === 'user' || isMessageToolsRestore(event)
  }
  return isMessageToolsEdit(event)
}

/** The span [target, surface tail] with full provenance, or undefined when off-surface. */
function surfaceSpan(
  surfaceNodes: readonly number[],
  targetSeq: number,
): { start: number; end: number; sourceEventSeqs: number[] } | undefined {
  const startIndex = surfaceNodes.indexOf(targetSeq)
  if (startIndex === -1) return undefined
  const sourceEventSeqs = surfaceNodes.slice(startIndex)
  const end = sourceEventSeqs[sourceEventSeqs.length - 1]
  /* v8 ignore next -- the slice is non-empty by construction (startIndex names a member) */
  if (end === undefined) return undefined
  return { start: targetSeq, end, sourceEventSeqs }
}

/** Why a withdrawal cannot be planned. */
export type WithdrawalPlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'already-withdrawn'
/** The validated replacement intent for one withdrawal. */
export interface WithdrawalPlan {
  /** Seq of the withdrawn user message (a current surface node). */
  readonly start: number
  /** Seq of the last current surface node; the span replaces [start, end]. */
  readonly end: number
  /** Every shadowed surface node, in surface order (surface validation requires the complete set). */
  readonly sourceEventSeqs: readonly number[]
}

/** Planning outcome: a replacement intent or a failure code. */
export type WithdrawalPlanResult =
  | { readonly ok: true; readonly plan: WithdrawalPlan }
  | { readonly ok: false; readonly code: WithdrawalPlanFailure }

/**
 * Plan a withdrawal: the target must be an editable user message (original,
 * restore replay, or edit replacement — see `isEditableTarget`) still present
 * on the live surface; the span covers it and every surface node after it.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs, in order.
 * @param targetSeq - seq of the user message to withdraw.
 * @returns the replacement intent, or the failure code.
 */
export function planWithdrawal(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
): WithdrawalPlanResult {
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) {
    return { ok: false, code: 'not-a-user-message' }
  }
  const span = surfaceSpan(surfaceNodes, targetSeq)
  if (span === undefined) return { ok: false, code: 'already-withdrawn' }
  return { ok: true, plan: span }
}

/** Why an edit cannot be planned. */
export type EditPlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'already-withdrawn'
  | 'empty-text'

/** Planning outcome: a replacement intent or a failure code. */
export type EditPlanResult =
  | { readonly ok: true; readonly plan: WithdrawalPlan }
  | { readonly ok: false; readonly code: EditPlanFailure }

/**
 * Plan an edit: the target must be an editable user message still present on
 * the live surface, and the new text must be non-blank. The span covers the
 * target and every surface node after it — editing an old message discards
 * what followed it. The replacement's content is the new text (no
 * placeholder), so the model context reads the edited message in place.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs, in order.
 * @param targetSeq - seq of the user message to edit.
 * @param text - the edited text.
 * @returns the replacement intent, or the failure code.
 */
export function planEdit(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
  text: string,
): EditPlanResult {
  if (text.trim() === '') return { ok: false, code: 'empty-text' }
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) {
    return { ok: false, code: 'not-a-user-message' }
  }
  const span = surfaceSpan(surfaceNodes, targetSeq)
  if (span === undefined) return { ok: false, code: 'already-withdrawn' }
  return { ok: true, plan: span }
}

/** Why a restore cannot be planned. */
export type RestorePlanFailure =
  | 'target-not-found'
  | 'not-a-user-message'
  | 'not-withdrawn'

/**
 * One replayed entry of a restored span, in original order. User entries
 * replay content blocks verbatim (originals, edit replacements — whose
 * content IS the last edit's new text — and earlier restore replays);
 * assistant entries carry the reply's joined text, framed for the model.
 */
export type RestoreReplayEntry =
  | {
    readonly role: 'user'
    /** The entry's content blocks, replayed verbatim. */
    readonly content: SessionEvent<'user/message'>['data']['content']
    /** Seq of the original event this entry replays. */
    readonly sourceSeq: number
  }
  | {
    readonly role: 'assistant'
    /** The model-facing text (frame included — see RESTORED_ASSISTANT_NOTICE). */
    readonly text: string
    /** Seq of the original event this entry replays. */
    readonly sourceSeq: number
  }

/** The validated restore intent for one withdrawn message. */
export interface RestorePlan {
  /**
   * Every replayable entry of the withdrawn span, in original (surface)
   * order; the host appends them back-to-back at the tail. Never empty: the
   * target message itself always replays. Tool calls/results never replay —
   * the call/result pairing cannot be re-entered and their side effects are
   * not replayable; the assistant text already summarizes them.
   */
  readonly entries: readonly RestoreReplayEntry[]
}

/** Restore planning outcome: a restore intent or a failure code. */
export type RestorePlanResult =
  | { readonly ok: true; readonly plan: RestorePlan }
  | { readonly ok: false; readonly code: RestorePlanFailure }

/** Join the text blocks of one message's content into one plain string. */
function joinText(blocks: readonly unknown[]): string {
  return blocks
    .filter((block): block is { type: string; text: string } =>
      (block as { type?: string; text?: string }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Join an assistant message's visible text. Normal replies use text blocks;
 * interrupted replies may contain only reasoning. Prefer text when present,
 * otherwise preserve the reasoning so a restore does not drop the only
 * assistant content the user saw.
 */
function joinAssistantMessageText(blocks: readonly unknown[]): string {
  const text = joinText(blocks)
  if (text !== '') return text
  return blocks
    .filter((block): block is { type: string; text: string } =>
      (block as { type?: string; text?: string }).type === 'reasoning'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * The full log seqs shadowed by the latest message-tools withdrawal
 * replacement citing `targetSeq`, or undefined when no such replacement exists
 * (the message left the surface through another producer, e.g. compaction).
 *
 * `sourceEventSeqs` is authoritative for the shadowed *surface* nodes, but an
 * interrupted assistant step may exist only as `assistant/attempt` events (no
 * `assistant/message` ever landed). Attempts are not surface nodes, so
 * they are absent from `sourceEventSeqs`. The replacement's own `startSeq` and
 * `seq` delimit the whole withdrawn log interval — `[startSeq, seq)` — and are
 * still read from the replacement itself, never guessed from another producer.
 */
function findWithdrawnSpan(
  events: readonly SessionEvent[],
  targetSeq: number,
): readonly number[] | undefined {
  for (let index = events.length - 1; index > targetSeq; index--) {
    const event = events[index]
    if (event === undefined || !isMessageToolsReplacement(event)) continue
    // The brands are compile-time only; the fold addresses the log by plain number.
    const sources = event.sourceEventSeqs as readonly number[] | undefined
    if (sources?.includes(targetSeq) !== true) continue
    const span: number[] = []
    for (let seq: number = event.surfaceOp.startSeq; seq < event.seq; seq++) span.push(seq)
    return span
  }
  return undefined
}

/**
 * Fold one withdrawn span into its replay entries, in span (original) order.
 * Replayed: user-source messages, edit replacements (their content is the
 * last edit's new text), earlier restore replays, and assistant text (framed;
 * restore-assistant replays already carry the frame). Skipped: withdrawal
 * placeholders, edit triggers, other plugin context, and tool calls/results.
 *
 * Assistant text normally comes from `assistant/message` surface events (a
 * cancelled turn finalizes its delivered prefix there with `interrupted:
 * true`). An attempt that committed no surface message — failed, retried, or
 * stream-error — settles as an `assistant/attempt` log event carrying its
 * exact compact stream. Each such attempt folds into one assistant replay
 * when no final `assistant/message` exists for that step, so
 * withdrawing/restoring an interrupted reply does not lose the partial
 * assistant content. A retried step's earlier attempts are superseded by the
 * step's final message and do not replay.
 */
function replayEntries(
  events: readonly SessionEvent[],
  spanSeqs: readonly number[],
): RestoreReplayEntry[] {
  const entries: RestoreReplayEntry[] = []
  // A step's final message supersedes its attempts; collect the finalized
  // steps first so an attempt is skipped regardless of log order.
  const finalizedSteps = new Set<string>()
  for (const seq of spanSeqs) {
    const event = events[seq]
    if (event?.type === 'assistant/message') {
      finalizedSteps.add(`${event.data.turn}:${event.data.step}`)
    }
  }

  const pushAssistantText = (text: string, sourceSeq: number): void => {
    if (text !== '') {
      entries.push({ role: 'assistant', text: `${RESTORED_ASSISTANT_NOTICE}\n${text}`, sourceSeq })
    }
  }

  for (const seq of spanSeqs) {
    const event = events[seq]
    if (event === undefined) continue
    if (isMessageToolsEdit(event)) {
      entries.push({ role: 'user', content: event.data.content, sourceSeq: seq })
      continue
    }
    if (event.type === 'assistant/attempt') {
      if (finalizedSteps.has(`${event.data.turn}:${event.data.step}`)) continue
      pushAssistantText(joinAttemptStreamText(event.data.stream), seq)
      continue
    }
    if (event.type === 'user/message') {
      if (event.surfaceOp !== 'append') continue
      if (event.data.source.kind === 'user' || isMessageToolsRestore(event)) {
        entries.push({ role: 'user', content: event.data.content, sourceSeq: seq })
      } else if (isMessageToolsRestoreAssistant(event)) {
        // Restore-assistant replays already carry the model-facing frame; do
        // not add a second one.
        entries.push({ role: 'assistant', text: joinText(event.data.content), sourceSeq: seq })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      pushAssistantText(joinAssistantMessageText(event.data.message.content), seq)
      continue
    }
    // Log-only events (boundaries, headers, titles) contribute nothing.
  }

  return entries
}

/**
 * Join one attempt's compact stream into its visible text. Text deltas win;
 * reasoning is the fallback so an attempt that streamed only reasoning does
 * not lose the only assistant content the user saw (the same preference
 * {@link joinAssistantMessageText} applies to finalized messages). Packed
 * delta runs append per block index; a raw `block-end` record carries the
 * assembled block and replaces its index's accumulated deltas. Tool-call
 * runs never replay (their side effects are not replayable).
 */
function joinAttemptStreamText(
  stream: SessionEvent<'assistant/attempt'>['data']['stream'],
): string {
  const text = new Map<number, string>()
  const reasoning = new Map<number, string>()
  const append = (map: Map<number, string>, index: number, fragment: string): void => {
    map.set(index, (map.get(index) ?? '') + fragment)
  }
  for (const record of stream) {
    if (record.type === 'text-chunks') {
      append(text, record.index, record.texts.join(''))
    } else if (record.type === 'reasoning-chunks') {
      append(reasoning, record.index, record.texts.join(''))
    } else if (record.type === 'chunk') {
      const chunk = record.chunk
      if (chunk.type === 'text-delta') {
        append(text, chunk.index, chunk.text)
      } else if (chunk.type === 'reasoning-delta') {
        append(reasoning, chunk.index, chunk.text)
      } else if (chunk.type === 'block-end' && chunk.block.type === 'text') {
        text.set(chunk.index, chunk.block.text)
      } else if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') {
        reasoning.set(chunk.index, chunk.block.text)
      }
    }
  }
  const joined = [...text.values()].join('')
  return joined !== '' ? joined : [...reasoning.values()].join('')
}

/**
 * Plan a restore: the target must be an editable user message (the same
 * vocabulary as withdrawal — original, restore replay, or edit replacement)
 * that is no longer on the live surface (i.e. withdrawn). Restoring an edit
 * replacement replays the span's last edit text — the replacement's content
 * IS the new text. The surface model is positional — a replaced span folds
 * into exactly one node — so the withdrawn span can never be put back in
 * place; restore replays the span's replayable content (user messages, the
 * last edit's new text, assistant text) as fresh tail messages in original
 * order. When no message-tools replacement cites the target (a foreign
 * shadowing, e.g. compaction), only the target message replays — the span
 * boundary is never re-guessed.
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs.
 * @param targetSeq - seq of the withdrawn user message to restore.
 * @returns the restore intent, or the failure code.
 */
export function planRestore(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
  targetSeq: number,
): RestorePlanResult {
  const target = events[targetSeq]
  if (target === undefined) return { ok: false, code: 'target-not-found' }
  if (!isEditableTarget(target)) return { ok: false, code: 'not-a-user-message' }
  if (surfaceNodes.includes(targetSeq)) return { ok: false, code: 'not-withdrawn' }
  const span = findWithdrawnSpan(events, targetSeq)
  const entries: RestoreReplayEntry[] = span === undefined
    ? [{ role: 'user', content: target.data.content, sourceSeq: targetSeq }]
    : replayEntries(events, span)
  return { ok: true, plan: { entries } }
}
