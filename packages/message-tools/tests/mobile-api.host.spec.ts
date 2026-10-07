import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import MessageToolsService from '../src/index.ts'
import {
  foldMobileMessages, mobileRoutes, MOBILE_ACTION_PATH, MOBILE_STATE_PATH,
} from '../src/mobile-api.ts'

const SESSION = SessionId('s1')

/** The real composition minus the Web server: the /m routes are simply absent. */
async function boot() {
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(MessageToolsService)
  return { ctx, service: ctx.get('messageTools') as MessageToolsService }
}

function appendUser(ctx: Context, text: string): number {
  const session = ctx.sessions.get(SESSION)!
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' }).seq
}

interface Captured {
  status: number
  headers: Record<string, unknown>
  body: string
}

function capture(): { captured: Captured; res: ServerResponse } {
  const captured: Captured = { status: 0, headers: {}, body: '' }
  const res = {
    setHeader: (name: string, value: unknown) => { captured.headers[name] = value },
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      captured.status = status
      if (headers !== undefined) Object.assign(captured.headers, headers)
    },
    end: (payload?: string) => { captured.body = payload ?? '' },
  }
  return { captured, res: res as unknown as ServerResponse }
}

function request(
  method: string,
  url: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body)]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...options.headers },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  } as unknown as IncomingMessage
}

/** One route call over a fake socket pair; returns what the handler answered. */
async function call(
  ctx: Context,
  service: MessageToolsService,
  which: 'state' | 'action',
  method: string,
  url: string,
  options: { body?: string; headers?: Record<string, string> } = {},
): Promise<Captured> {
  const routes = mobileRoutes(ctx, service)
  const route = which === 'state' ? routes.state : routes.action
  const { captured, res } = capture()
  await route.handler(request(method, url, options), res)
  return captured
}

const JSON_HEADERS = { 'content-type': 'application/json' }

describe('message-tools /m surface', () => {
  it('folds the log into newest-first rows and marks withdrawn rows', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const first = appendUser(ctx, '第一条')
    const second = appendUser(ctx, '第二条')
    const session = ctx.sessions.get(SESSION)!

    let fold = foldMobileMessages(session.snapshotEvents(), session.surface.nodes)
    expect(fold.total).toBe(2)
    expect(fold.messages).toEqual([
      { seq: second, text: '第二条', state: 'active', origin: 'user', hasImage: false, chars: 3 },
      { seq: first, text: '第一条', state: 'active', origin: 'user', hasImage: false, chars: 3 },
    ])

    await service.withdraw({ sessionId: SESSION, targetSeq: first })
    fold = foldMobileMessages(session.snapshotEvents(), session.surface.nodes)
    // The withdrawal placeholder and any assistant rows carry no actions, so
    // the phone never offers an action the service would reject.
    expect(fold.total).toBe(2)
    expect(fold.messages.map(row => [row.seq, row.state])).toEqual([[second, 'withdrawn'], [first, 'withdrawn']])
  })

  it('marks an edited replacement and a restored replay with their origin', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const target = appendUser(ctx, '原文')
    await service.edit({ sessionId: SESSION, targetSeq: target, text: '编辑后' })
    const session = ctx.sessions.get(SESSION)!
    const edited = session.surface.nodes.at(-1)!
    let fold = foldMobileMessages(session.snapshotEvents(), session.surface.nodes)
    expect(fold.messages[0]).toMatchObject({ seq: edited, text: '编辑后', origin: 'edited', state: 'active' })

    await service.withdraw({ sessionId: SESSION, targetSeq: edited })
    await service.restore({ sessionId: SESSION, targetSeq: edited })
    fold = foldMobileMessages(session.snapshotEvents(), session.surface.nodes)
    expect(fold.messages[0]).toMatchObject({ text: '编辑后', origin: 'restored', state: 'active' })
  })

  it('flags an image-carrying message (the phone cannot re-attach it)', () => {
    const events = [{
      type: 'user/message', seq: 0, surfaceOp: 'append',
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', mediaType: 'image/png', data: 'AAAA' },
        ],
      },
    }] as unknown as Parameters<typeof foldMobileMessages>[0]
    const fold = foldMobileMessages(events, [0])
    expect(fold.messages[0]).toMatchObject({ text: '看图', hasImage: true, state: 'active' })
  })

  it('serves the state route for the current session', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const only = appendUser(ctx, '只有一条')
    const captured = await call(ctx, service, 'state', 'GET', `${MOBILE_STATE_PATH}?session=${SESSION}`)
    expect(captured.status).toBe(200)
    expect(captured.headers['Cache-Control']).toBe('no-store')
    expect(JSON.parse(captured.body)).toEqual({
      ok: true,
      sessionId: SESSION,
      messages: [{ seq: only, text: '只有一条', state: 'active', origin: 'user', hasImage: false, chars: 4 }],
      total: 1,
      truncated: false,
    })
  })

  it('rejects a bad session id, an unknown session, a wrong method and a foreign origin', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    expect((await call(ctx, service, 'state', 'GET', MOBILE_STATE_PATH)).status).toBe(400)
    expect((await call(ctx, service, 'state', 'GET', `${MOBILE_STATE_PATH}?session=session-nope`)).status).toBe(404)
    expect((await call(ctx, service, 'state', 'POST', `${MOBILE_STATE_PATH}?session=${SESSION}`, {
      body: '{}', headers: JSON_HEADERS,
    })).status).toBe(405)
    const foreign = await call(ctx, service, 'state', 'GET', `${MOBILE_STATE_PATH}?session=${SESSION}`, {
      headers: { origin: 'https://evil.example' },
    })
    expect(foreign.status).toBe(403)
    // The /m page itself may arrive over a tunnel: a same-origin Origin passes.
    expect((await call(ctx, service, 'state', 'GET', `${MOBILE_STATE_PATH}?session=${SESSION}`, {
      headers: { origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    })).status).toBe(200)
  })

  it('performs withdraw, edit and restore through the action route', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const first = appendUser(ctx, '第一条')
    const second = appendUser(ctx, '第二条')
    const session = ctx.sessions.get(SESSION)!

    const withdrawn = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'withdraw', sessionId: SESSION, targetSeq: first }),
    })
    expect(withdrawn.status).toBe(200)
    expect(JSON.parse(withdrawn.body)).toEqual({
      ok: true, value: { replacementSeq: second + 1, shadowedCount: 2 },
    })
    expect(session.surface.nodes).toEqual([second + 1])

    const restored = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'restore', sessionId: SESSION, targetSeq: second }),
    })
    expect(restored.status).toBe(200)
    const restoredSeq = (JSON.parse(restored.body) as { ok: boolean; value: { restoredSeq: number } })
      .value.restoredSeq

    // Restore replays at the tail, so the ORIGINAL stays off-surface and the
    // service refuses to edit it; the replay row is the editable target the
    // phone offers (origin 'restored').
    const stale = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'edit', sessionId: SESSION, targetSeq: first, text: 'x' }),
    })
    expect(JSON.parse(stale.body)).toEqual({ ok: false, error: { code: 'already-withdrawn' } })

    const edited = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'edit', sessionId: SESSION, targetSeq: restoredSeq, text: '手机改的' }),
    })
    expect(JSON.parse(edited.body)).toMatchObject({ ok: true, value: { triggered: false } })
    const landed = session.snapshotEvents()[session.surface.nodes.at(-1)!]!
    if (landed.type !== 'user/message') throw new Error('narrowing')
    expect(landed.data.content).toEqual([{ type: 'text', text: '手机改的' }])
  })

  it('refuses a malformed or non-JSON action with the closed failure codes', async () => {
    const { ctx, service } = await boot()
    ctx.sessions.create(SESSION, { meta: {} })
    const target = appendUser(ctx, '原文')

    // A non-JSON body is refused before the service is reached.
    expect((await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, { body: 'nope' })).status).toBe(415)
    // JSON that parses but names no operation, or names an unimplemented one.
    expect((await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS, body: '{',
    })).status).toBe(400)
    expect((await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS, body: '{}',
    })).status).toBe(400)
    expect((await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'delete', sessionId: SESSION, targetSeq: target }),
    })).status).toBe(400)

    // A well-formed request reaches the service, whose failure union answers.
    const blank = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'edit', sessionId: SESSION, targetSeq: target, text: '   ' }),
    })
    expect(blank.status).toBe(200)
    expect(JSON.parse(blank.body)).toEqual({ ok: false, error: { code: 'empty-text' } })

    // A foreign origin never reaches the service at all.
    const foreign = await call(ctx, service, 'action', 'POST', MOBILE_ACTION_PATH, {
      headers: { ...JSON_HEADERS, origin: 'https://evil.example' },
      body: JSON.stringify({ action: 'withdraw', sessionId: SESSION, targetSeq: target }),
    })
    expect(foreign.status).toBe(403)
    expect(ctx.sessions.get(SESSION)!.surface.nodes).toEqual([target])
  })
})
