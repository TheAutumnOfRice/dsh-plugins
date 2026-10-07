/**
 * The /m (phone) HTTP surface of message tools.
 *
 * `/m` is the mobile UI served by dsh-mobile-ui: plain browser JS on the SAME
 * origin as this host, with no Typert Remote client and no way to speak the
 * generated wire codecs. The phone therefore reaches the three operations
 * through two same-origin routes instead of the `messageTools` Remote — and
 * through the same service methods, so a phone withdrawal/edit/restore lands
 * the identical replacement a desktop one does (one code path, one audit
 * trail; no new session event vocabulary).
 *
 * Both routes are fenced. A request carrying an `Origin` must be same-origin,
 * and a POST must be JSON under a size cap. The fence deliberately does NOT
 * require a browser cookie: /m is reached over LAN addresses and tunnels where
 * the `dsh-auth-*` cookie is absent (that is why dsh-mobile-ui re-serves the
 * RPC paths itself), so a cookie test would break exactly the client this
 * surface exists for. Mutating requests are same-origin-only regardless, which
 * is the CSRF/DNS-rebinding property that matters.
 * @module @khorsheed/dsh-client-message-tools/mobile-api
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isMessageToolsEdit, isMessageToolsRestore } from './marker.ts'
import { isEditableTarget } from './withdraw.ts'
import type {
  MessageToolsEditRequest, MessageToolsEditResult,
  MessageToolsRestoreRequest, MessageToolsRestoreResult,
  MessageToolsWithdrawRequest, MessageToolsWithdrawResult,
} from './types.ts'

/** Route the /m page reads the current session's message list from. */
export const MOBILE_STATE_PATH = '/message-tools/m/state'
/** Route the /m page performs withdraw / edit / restore on. */
export const MOBILE_ACTION_PATH = '/message-tools/m/action'

/** Largest accepted action body; an edit's text is the only variable part. */
const MAX_ACTION_BYTES = 64 * 1024
/** Rows returned per state read, newest first (the phone lists the tail). */
const MAX_ROWS = 120
/** Longest text kept per row — the phone edits it, so the cap stays generous. */
const MAX_TEXT_CHARS = 8000

/** One user-visible message row on the phone. */
export interface MobileMessageRow {
  /** Log seq of the message (the value `withdraw`/`edit`/`restore` take). */
  readonly seq: number
  /** The message's own text (an edit replacement carries the edited text). */
  readonly text: string
  /**
   * `active` — on the model surface, so it can be withdrawn or edited;
   * `withdrawn` — hidden by a withdrawal, so it can be restored.
   */
  readonly state: 'active' | 'withdrawn'
  /** Where the row came from: the user's original, an edit, or a restore replay. */
  readonly origin: 'user' | 'edited' | 'restored'
  /** Whether the message also carried an image block (text-only edit/resend). */
  readonly hasImage: boolean
  /** Total length of the row's text before the display cap. */
  readonly chars: number
}

/** The state read's payload. */
export interface MobileStatePayload {
  readonly ok: true
  readonly sessionId: string
  /** Newest first. */
  readonly messages: readonly MobileMessageRow[]
  /** Rows on the surface + withdrawn beyond {@link MAX_ROWS}, for the count line. */
  readonly total: number
  /** True when the list was capped. */
  readonly truncated: boolean
}

/** The three operations the service exposes, read structurally (no import cycle). */
export interface MobileActionSlice {
  withdraw(request: MessageToolsWithdrawRequest): Promise<MessageToolsWithdrawResult>
  restore(request: MessageToolsRestoreRequest): Promise<MessageToolsRestoreResult>
  edit(request: MessageToolsEditRequest): Promise<MessageToolsEditResult>
}

/** The session store slice the state read needs. */
interface SessionSlice {
  snapshotEvents(): readonly SessionEvent[]
  readonly surface: { readonly nodes: readonly number[] }
}

/**
 * Join one message's text blocks and note whether it carried an image. Only
 * text is editable on the phone: an image arrives as base64 the composer
 * cannot re-attach, so the row says so instead of silently dropping it.
 */
function readContent(content: readonly unknown[]): { text: string; hasImage: boolean } {
  let text = ''
  let hasImage = false
  for (const block of content) {
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') text += candidate.text
    else if (candidate.type === 'image') hasImage = true
  }
  return { text, hasImage }
}

/**
 * Fold a session log + live surface into the phone's message list.
 *
 * A row is exactly an *editable target* (the same predicate withdrawal and
 * edit validate against: a user-sourced original, an edit replacement, or a
 * restore replay). Withdrawal placeholders, edit triggers, and assistant-text
 * restore replays carry no actions and are therefore absent — the phone can
 * only offer an action the service would accept.
 *
 * @param events - the full session log (seq === index).
 * @param surfaceNodes - the current model-visible surface seqs.
 * @returns newest-first rows plus the uncapped count.
 */
export function foldMobileMessages(
  events: readonly SessionEvent[],
  surfaceNodes: readonly number[],
): { messages: MobileMessageRow[]; total: number } {
  const onSurface = new Set(surfaceNodes)
  const rows: MobileMessageRow[] = []
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq]
    if (!isEditableTarget(event)) continue
    const { text, hasImage } = readContent(event.data.content)
    const origin: MobileMessageRow['origin'] = isMessageToolsEdit(event)
      ? 'edited'
      : isMessageToolsRestore(event) ? 'restored' : 'user'
    rows.push({
      seq,
      text: text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text,
      state: onSurface.has(seq) ? 'active' : 'withdrawn',
      origin,
      hasImage,
      chars: text.length,
    })
  }
  rows.reverse()
  return { messages: rows.slice(0, MAX_ROWS), total: rows.length }
}

/** Answer one request with JSON and the no-store/nosniff pair the Web UI expects. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(payload)
}

/** Whether a request comes from this same origin (the CSRF/DNS-rebinding fence). */
function isSameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string') return true
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read a bounded JSON body; undefined means "already answered with the failure". */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    writeJson(res, 415, { ok: false, error: { code: 'unsupported-media-type' } })
    return undefined
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_ACTION_BYTES) {
      writeJson(res, 413, { ok: false, error: { code: 'body-too-large' } })
      return undefined
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    writeJson(res, 400, { ok: false, error: { code: 'invalid-json' } })
    return undefined
  }
}

/** The validated shape of one action request (one literal per variant, so the
 * handler's switch narrows). */
type MobileAction =
  | { readonly action: 'withdraw'; readonly sessionId: SessionId; readonly targetSeq: number }
  | { readonly action: 'restore'; readonly sessionId: SessionId; readonly targetSeq: number }
  | { readonly action: 'edit'; readonly sessionId: SessionId; readonly targetSeq: number; readonly text: string }

/** Validate an action body into the closed union, or a failure code. */
function parseAction(body: unknown): MobileAction | { readonly code: string } {
  if (typeof body !== 'object' || body === null) return { code: 'invalid-body' }
  const record = body as { action?: unknown; sessionId?: unknown; targetSeq?: unknown; text?: unknown }
  const { action, sessionId, targetSeq, text } = record
  if (typeof sessionId !== 'string' || sessionId === '') return { code: 'invalid-body' }
  if (typeof targetSeq !== 'number' || !Number.isInteger(targetSeq) || targetSeq < 0) return { code: 'invalid-body' }
  const id = sessionId as SessionId
  if (action === 'withdraw') return { action: 'withdraw', sessionId: id, targetSeq }
  if (action === 'restore') return { action: 'restore', sessionId: id, targetSeq }
  if (action === 'edit') {
    if (typeof text !== 'string') return { code: 'invalid-body' }
    return { action: 'edit', sessionId: id, targetSeq, text }
  }
  return { code: 'invalid-body' }
}

/**
 * The session read behind the state route. The store is the authority on which
 * ids exist, so an unknown id is a 404 — not a shape rejection: sessions
 * created through the SDK or a test harness carry ids this package must not
 * second-guess.
 */
function loadSession(ctx: Context, sessionId: string): SessionSlice | undefined {
  return ctx.sessions.get(sessionId as SessionId) as SessionSlice | undefined
}

/** Build the two /m routes this plugin owns. */
export function mobileRoutes(ctx: Context, service: MobileActionSlice): { state: WebRoute; action: WebRoute } {
  return {
    state: {
      kind: 'exact',
      path: MOBILE_STATE_PATH,
      handler: (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
          return
        }
        if (!isSameOrigin(req)) {
          writeJson(res, 403, { ok: false, error: { code: 'cross-origin-request' } })
          return
        }
        const sessionId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('session') ?? ''
        const session = loadSession(ctx, sessionId)
        if (session === undefined) {
          writeJson(res, sessionId === '' ? 400 : 404, { ok: false, error: { code: 'session-not-found' } })
          return
        }
        const { messages, total } = foldMobileMessages(session.snapshotEvents(), session.surface.nodes)
        const payload: MobileStatePayload = {
          ok: true,
          sessionId,
          messages,
          total,
          truncated: total > messages.length,
        }
        writeJson(res, 200, payload)
      },
    },
    action: {
      kind: 'exact',
      path: MOBILE_ACTION_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST')
          writeJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
          return
        }
        if (!isSameOrigin(req)) {
          writeJson(res, 403, { ok: false, error: { code: 'cross-origin-request' } })
          return
        }
        const body = await readJsonBody(req, res)
        if (body === undefined) return
        const parsed = parseAction(body)
        if ('code' in parsed) {
          writeJson(res, 400, { ok: false, error: { code: parsed.code } })
          return
        }
        try {
          switch (parsed.action) {
            case 'withdraw':
              writeJson(res, 200, await service.withdraw({ sessionId: parsed.sessionId, targetSeq: parsed.targetSeq }))
              return
            case 'restore':
              writeJson(res, 200, await service.restore({ sessionId: parsed.sessionId, targetSeq: parsed.targetSeq }))
              return
            default:
              writeJson(res, 200, await service.edit({
                sessionId: parsed.sessionId, targetSeq: parsed.targetSeq, text: parsed.text,
              }))
          }
        } catch (error) {
          writeJson(res, 500, { ok: false, error: { code: 'internal-error', message: String(error) } })
        }
      },
    },
  }
}
