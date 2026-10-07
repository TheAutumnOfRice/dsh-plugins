/* message-tools /m plugin-tab entry: withdraw / edit-and-resend / restore.
 *
 * The phone UI (/m, served by dsh-mobile-ui) is plain browser JS on the same
 * origin as the host and has no Typert Remote client, so this page drives the
 * plugin's own two same-origin routes instead:
 *   GET  /message-tools/m/state?session=<id>   -> the session's message rows
 *   POST /message-tools/m/action              -> { action, sessionId, targetSeq, text? }
 * Both land the same service methods the desktop message actions call, so a
 * phone withdrawal/edit/restore is the same replacement event in the log.
 *
 * Contract: fills ctx.el (the core owns the page frame), binds its own
 * buttons, honours ctx.refresh()/ctx.onDispose(), desktop SVG glyphs only.
 */
(function () {
  var slots = window.__mobileSlots
  if (!slots || typeof slots.registerPluginTab !== 'function') return

  var STATE_URL = '/message-tools/m/state'
  var ACTION_URL = '/message-tools/m/action'
  var zh = (navigator.language || '').toLowerCase().indexOf('zh') === 0
  var T = zh ? {
    title: '消息工具',
    refresh: '刷新',
    empty: '当前会话里还没有可操作的消息。',
    noSession: '先打开一个会话，再回到这里。',
    count: function (n, w) { return n + ' 条消息' + (w ? ' · 已撤回 ' + w + ' 条' : '') },
    withdrawn: '已撤回',
    active: '生效中',
    edited: '已编辑',
    restored: '已恢复',
    image: '含图片（编辑不会带回图片）',
    withdraw: '撤回',
    edit: '编辑重发',
    restore: '恢复',
    cancel: '取消',
    save: '保存并重发',
    working: '处理中…',
    confirmWithdraw: '撤回这条消息？它和它之后的所有内容都会从模型上下文里移除（可在“已撤回”处恢复）。',
    confirmRestore: '把这条消息和它被撤回的那一段重新放回对话末尾？',
    done: '已提交',
    failed: '操作失败：'
  } : {
    title: 'Messages',
    refresh: 'Refresh',
    empty: 'No actionable messages in this session yet.',
    noSession: 'Open a session first, then come back.',
    count: function (n, w) { return n + ' message' + (n === 1 ? '' : 's') + (w ? ' · ' + w + ' withdrawn' : '') },
    withdrawn: 'Withdrawn',
    active: 'Live',
    edited: 'Edited',
    restored: 'Restored',
    image: 'has images (an edit does not re-attach them)',
    withdraw: 'Withdraw',
    edit: 'Edit & resend',
    restore: 'Restore',
    cancel: 'Cancel',
    save: 'Save & resend',
    working: 'Working…',
    confirmWithdraw: 'Withdraw this message? It and everything after it leave the model context (restorable below).',
    confirmRestore: 'Replay this message and its withdrawn span at the tail of the conversation?',
    done: 'Submitted',
    failed: 'Failed: '
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function num(n) { return n == null ? '' : String(n) }
  function post(body) {
    return fetch(ACTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return null }) })
  }
  function getState(sessionId) {
    return fetch(STATE_URL + '?session=' + encodeURIComponent(sessionId), { method: 'GET' })
      .then(function (r) { return r.json().catch(function () { return null }) })
  }

  slots.registerPluginTab({
    id: 'message-tools',
    title: T.title,
    icon: 'edit',
    order: 20,
    summary: function (ctx) {
      if (!ctx.sessionId) return Promise.resolve(T.noSession)
      return getState(ctx.sessionId).then(function (s) {
        if (!s || !s.ok) return T.noSession
        var withdrawn = 0
        for (var i = 0; i < s.messages.length; i += 1) if (s.messages[i].state === 'withdrawn') withdrawn += 1
        return T.count(s.total, withdrawn)
      }).catch(function () { return 'unavailable' })
    },
    page: function (ctx) {
      var sessionId = ctx.sessionId
      var alive = true
      var editing = null // seq whose editor is open
      ctx.onDispose(function () { alive = false })

      // The core owns the page frame; this page fills its holder with a status
      // line plus the list, and re-renders only the list in place.
      ctx.el.innerHTML = '<div class="mtNoteBar" style="min-height:16px;opacity:.8;font-size:12px"></div>'
        + '<div class="mtList"></div>'
      var barEl = ctx.el.querySelector('.mtNoteBar')
      var listEl = ctx.el.querySelector('.mtList')

      function note(text) { if (barEl) barEl.textContent = text || '' }
      function live() { return alive && listEl && listEl.isConnected }

      function render(s) {
        var withdrawn = 0
        for (var i = 0; i < s.messages.length; i += 1) if (s.messages[i].state === 'withdrawn') withdrawn += 1
        var html = '<div class="setCard"><h4>' + esc(T.count(s.total, withdrawn)) + '</h4>'
        html += '<div class="cardActions"><button class="btn ghost" data-act="reload">\u21bb ' + esc(T.refresh) + '</button></div></div>'
        if (!s.messages.length) return html + '<div class="empty">' + esc(T.empty) + '</div>'
        for (var j = 0; j < s.messages.length; j += 1) {
          var m = s.messages[j]
          html += '<div class="setCard" data-seq="' + m.seq + '">'
          html += '<div class="mtHead"><span class="chip">#' + m.seq + '</span>'
          html += '<span class="chip">' + esc(m.state === 'withdrawn' ? T.withdrawn : T.active) + '</span>'
          if (m.origin !== 'user') html += '<span class="chip">' + esc(m.origin === 'edited' ? T.edited : T.restored) + '</span>'
          html += '</div>'
          if (editing === m.seq) {
            html += '<textarea class="mtEdit" rows="5" style="width:100%;box-sizing:border-box">' + esc(m.text) + '</textarea>'
            if (m.hasImage) html += '<div class="mtNote" style="opacity:.7;font-size:12px">' + esc(T.image) + '</div>'
            html += '<div class="cardActions">'
            html += '<button class="btn ghost" data-act="cancel">' + esc(T.cancel) + '</button>'
            html += '<button class="btn" data-act="save">' + esc(T.save) + '</button></div>'
          } else {
            html += '<div class="mtText" style="white-space:pre-wrap;word-break:break-word">' + esc(m.text) + '</div>'
            if (m.hasImage) html += '<div class="mtNote" style="opacity:.7;font-size:12px">' + esc(T.image) + '</div>'
            html += '<div class="cardActions">'
            if (m.state === 'active') {
              html += '<button class="btn ghost" data-act="edit">' + esc(T.edit) + '</button>'
              html += '<button class="btn ghost" data-act="withdraw">' + esc(T.withdraw) + '</button>'
            } else {
              html += '<button class="btn ghost" data-act="restore">' + esc(T.restore) + '</button>'
            }
            html += '</div>'
          }
          html += '</div>'
        }
        return html
      }

      function draw() {
        if (!live()) return
        if (!sessionId) { listEl.innerHTML = '<div class="empty">' + esc(T.noSession) + '</div>'; return }
        getState(sessionId).then(function (s) {
          if (!live()) return
          if (!s || !s.ok) {
            listEl.innerHTML = '<div class="empty">'
              + esc(T.failed + ((s && s.error && s.error.code) || 'state')) + '</div>'
            return
          }
          listEl.innerHTML = render(s)
          bind()
        }).catch(function () { if (live()) listEl.innerHTML = '<div class="empty">unavailable</div>' })
      }

      function run(seq, body) {
        note(T.working)
        return post(body).then(function (r) {
          if (!alive) return
          if (!r || r.ok !== true) {
            note(T.failed + ((r && r.error && r.error.code) || 'unknown'))
            return
          }
          note(T.done)
          editing = null
          draw()
        }).catch(function () { if (alive) note(T.failed + 'network') })
      }

      function bind() {
        if (!listEl) return
        listEl.querySelectorAll('[data-act]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (btn.dataset.act === 'reload') { draw(); return }
            var card = btn.closest('[data-seq]')
            if (!card) return
            var seq = Number(card.dataset.seq)
            var act = btn.dataset.act
            if (act === 'edit') { editing = seq; draw(); return }
            if (act === 'cancel') { editing = null; draw(); return }
            if (act === 'save') {
              var area = card.querySelector('.mtEdit')
              var text = area ? area.value : ''
              if (!text.trim()) { note(T.failed + 'empty-text'); return }
              void run(seq, { action: 'edit', sessionId: sessionId, targetSeq: seq, text: text })
              return
            }
            if (act === 'withdraw' && !window.confirm(T.confirmWithdraw)) return
            if (act === 'restore' && !window.confirm(T.confirmRestore)) return
            void run(seq, { action: act, sessionId: sessionId, targetSeq: seq })
          })
        })
      }

      draw()
    }
  })
})()
