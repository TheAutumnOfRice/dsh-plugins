/**
 * message-tools host half: the `messageTools` Typert Remote service. Its
 * withdraw/edit methods land surface replacements — the compaction mechanism —
 * so the target message and everything after it leave the model-visible
 * surface (edit replacements carry the edited text as their content), and its
 * restore method tail-replays a withdrawn span's replayable entries, while
 * the browser half shadows the user-message renderer and projects the
 * withdrawal divider, edited bubble, and restored rows.
 * @module @khorsheed/dsh-client-message-tools
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `sessions` SessionStore merge onto Context.
import type {} from '@deepseek-ai/dsh-session'
// Value: the branded seq constructor the surface markers require.
import { SessionSeq } from '@deepseek-ai/dsh-session'
// Type-only: pulls the `agents` registry merge onto Context.
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  EDIT_TRIGGER_NOTICE, WITHDRAWN_NOTICE,
  editReplacementSource, editTriggerSource, messageToolsSource, restoreAssistantSource,
} from './marker.ts'
import { mobileRoutes } from './mobile-api.ts'
import { registerRestoreProjection } from './restore-projection.ts'
import { planEdit, planRestore, planWithdrawal } from './withdraw.ts'
import type {
  MessageToolsEditRequest, MessageToolsEditResult,
  MessageToolsRestoreRequest, MessageToolsRestoreResult,
  MessageToolsWithdrawRequest, MessageToolsWithdrawResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Withdrawal Remote owned by the message-tools plugin. */
    messageTools: MessageToolsService
  }
}

/**
 * messageTools Remote service: appends the withdrawal replacement to the
 * owning Session and flushes it durable. The replacement event's
 * producer-owned source is the audit trail; no new session event type is
 * introduced, so session reload stays safe for harnesses without this plugin.
 */
export class MessageToolsService extends TypertRemoteService {
  static inject = ['sessions', 'agents']

  /**
   * @param ctx - host context carrying the session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'messageTools')
    // Seam registry S12: on a host whose session fold can carry a user/message
    // projection, restore replays derive assistant-role without the frame;
    // every degrade path leaves the framed user-role channel verbatim.
    registerRestoreProjection(ctx)
    // The /m (phone) surface: the mobile UI is plain browser JS with no Remote
    // client, so it drives the same three methods through two same-origin
    // routes. `inject` is scoped and optional — a headless/TUI composition has
    // no web server and keeps its full service without these routes.
    ctx.inject(['webServer'], (webCtx) => {
      const webServer = webCtx.get('webServer')
      if (webServer === undefined) return
      const routes = mobileRoutes(webCtx, this)
      webCtx.effect(() => webServer.register(routes.state), 'message-tools: /m state route')
      webCtx.effect(() => webServer.register(routes.action), 'message-tools: /m action route')
    })
  }

  /**
   * Withdraw a user message: replace it and every surface node after it with
   * a minimal producer-sourced placeholder, hiding the span from the model.
   * @param request - session identity and target message seq.
   * @returns the replacement receipt, or a rejection from the closed failure union.
   */
  @Remote('withdraw')
  async withdraw(request: MessageToolsWithdrawRequest): Promise<MessageToolsWithdrawResult> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    const planned = planWithdrawal(session.snapshotEvents(), session.surface.nodes, request.targetSeq)
    if (!planned.ok) return { ok: false, error: { code: planned.code } }
    const replacement = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: WITHDRAWN_NOTICE }],
      source: messageToolsSource(),
    }), {
      surfaceOp: { op: 'replace', startSeq: SessionSeq(planned.plan.start), endSeq: SessionSeq(planned.plan.end) },
      sourceEventSeqs: planned.plan.sourceEventSeqs.map(seq => SessionSeq(seq)),
    })
    await this.ctx.sessions.flush(session)
    return {
      ok: true,
      value: { replacementSeq: replacement.seq, shadowedCount: planned.plan.sourceEventSeqs.length },
    }
  }

  /**
   * Restore a withdrawn span: replay every replayable entry of it (user
   * messages verbatim — including the last edit's new text — and framed
   * assistant text; tool calls/results never replay) as fresh
   * producer-sourced `user/message` appends at the conversation tail, in
   * original order, each citing its original event in `sourceEventSeqs`. The
   * surface replace model is positional — a replaced span folds into one
   * node — so the span cannot be restored in place; the replayed entries are
   * simply the newest messages the model sees. Assistant text replays as
   * framed user-role messages: `assistant/message` requires the model source
   * and the turn/step trace forbids assistant appends outside a step.
   * @param request - session identity and withdrawn message seq.
   * @returns the restore receipt, or a rejection from the closed failure union.
   */
  @Remote('restore')
  async restore(request: MessageToolsRestoreRequest): Promise<MessageToolsRestoreResult> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    const planned = planRestore(session.snapshotEvents(), session.surface.nodes, request.targetSeq)
    if (!planned.ok) return { ok: false, error: { code: planned.code } }
    const appendedSeqs: number[] = []
    for (const entry of planned.plan.entries) {
      const message = entry.role === 'user'
        ? createUserMessage({
          content: [...entry.content],
          source: messageToolsSource(),
        })
        : createUserMessage({
          content: [{ type: 'text', text: entry.text }],
          source: restoreAssistantSource(),
        })
      appendedSeqs.push(session.append('user/message', message, {
        surfaceOp: 'append',
        sourceEventSeqs: [SessionSeq(entry.sourceSeq)],
      }).seq)
    }
    await this.ctx.sessions.flush(session)
    /* v8 ignore next -- entries is never empty (the target itself always replays), so [0] exists */
    return { ok: true, value: { restoredSeq: appendedSeqs[0] ?? request.targetSeq } }
  }

  /**
   * Edit a user message in place: replace it and every surface node after it
   * with the edited text itself (no placeholder, no tail duplicate — the
   * edited text appears exactly once, in the replacement event), then start a
   * regeneration turn. The harness has no wake-without-append path, so the
   * turn is started by `agent.followup` carrying a minimal producer-sourced
   * trigger message (the ankh-guard/schedule pattern); the trigger is not the
   * edited text and lands once, as itself.
   * @param request - session identity, target seq, edited text.
   * @returns the replacement receipt and whether the turn was triggered, or a rejection.
   */
  @Remote('edit')
  async edit(request: MessageToolsEditRequest): Promise<MessageToolsEditResult> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) return { ok: false, error: { code: 'session-not-found' } }
    const planned = planEdit(session.snapshotEvents(), session.surface.nodes, request.targetSeq, request.text)
    if (!planned.ok) return { ok: false, error: { code: planned.code } }
    const replacement = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: request.text }],
      source: editReplacementSource(),
    }), {
      surfaceOp: { op: 'replace', startSeq: SessionSeq(planned.plan.start), endSeq: SessionSeq(planned.plan.end) },
      sourceEventSeqs: planned.plan.sourceEventSeqs.map(seq => SessionSeq(seq)),
    })
    await this.ctx.sessions.flush(session)
    const agent = this.ctx.agents.get(request.sessionId)
    if (agent !== undefined) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: EDIT_TRIGGER_NOTICE }],
        source: editTriggerSource(),
      }))
    }
    return { ok: true, value: { replacementSeq: replacement.seq, triggered: agent !== undefined } }
  }
}

export default MessageToolsService
