/**
 * Host-side pre-step interception for Prompt Optimizer.
 *
 * This module deliberately knows nothing about the browser composer. DSH has
 * already admitted the user's Queue/Steer submission before agent/pre-step,
 * so returning the downstream decision unchanged preserves the delivery mode.
 * We only pause step admission while the optimizer/review decision settles.
 */

const HUMAN_SOURCE_KINDS = new Set(['user', 'user-rpc'])
const ACTIONS = new Set(['confirm', 'original', 'skip', 'regen', 'cancel'])

export function humanMessageText(message) {
  if (!message || message.role !== 'user') return ''
  const kind = message.source && typeof message.source.kind === 'string' ? message.source.kind : ''
  if (!HUMAN_SOURCE_KINDS.has(kind)) return ''
  const blocks = Array.isArray(message.content) ? message.content : []
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

export function lastHumanMessage(messages) {
  const rows = Array.isArray(messages) ? messages : []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const text = humanMessageText(rows[i])
    if (text) return { message: rows[i], text }
  }
  return null
}

function agentSessionId(agent) {
  if (!agent) return ''
  if (agent.session && agent.session.id !== undefined) return String(agent.session.id)
  if (agent.id !== undefined) return String(agent.id)
  return ''
}

function publicRun(run) {
  if (!run) return null
  return {
    id: run.id,
    sessionId: run.sessionId,
    messageId: run.messageId,
    turn: run.turn,
    step: run.step,
    permission: run.permission,
    phase: run.phase,
    text: run.text,
    packet: run.packet || '',
    edited: run.edited == null ? (run.packet || '') : run.edited,
    chars: typeof run.chars === 'number' ? run.chars : 0,
    ms: typeof run.ms === 'number' ? run.ms : null,
    unsourced: typeof run.unsourced === 'number' ? run.unsourced : null,
    route: run.route || null,
    reason: run.reason || null,
    usage: run.usage && typeof run.usage === 'object' ? run.usage : null,
    usageTotal: typeof run.usageTotal === 'number' ? run.usageTotal : null,
    t0: run.t0,
  }
}

export function createPreStepInterceptController({
  optimize,
  readPolicy,
  getPacket,
  setPacket,
  clearPacket,
  readProgress,
  onBypass,
  now = () => Date.now(),
  terminalTtlMs = 1600,
} = {}) {
  if (typeof optimize !== 'function') throw new TypeError('pre-step interceptor requires optimize()')
  if (typeof readPolicy !== 'function') throw new TypeError('pre-step interceptor requires readPolicy()')

  const runs = new Map()
  let seq = 0

  const state = (sessionId) => {
    const run = runs.get(String(sessionId || '')) || null
    return run ? { active: true, run: publicRun(run) } : { active: false, run: null }
  }

  const publish = (run, patch) => {
    if (!run || runs.get(run.sessionId) !== run) return run
    Object.assign(run, patch || {})
    return run
  }

  const removeLater = (run) => {
    if (!run) return
    if (run.timer) clearTimeout(run.timer)
    run.timer = setTimeout(() => {
      if (runs.get(run.sessionId) === run) runs.delete(run.sessionId)
    }, terminalTtlMs)
    if (run.timer && typeof run.timer.unref === 'function') run.timer.unref()
  }

  const finish = (run, phase, patch = {}) => {
    publish(run, { ...patch, phase })
    removeLater(run)
  }

  const resolveAction = (run, action) => {
    if (!run || run.actionSettled) return false
    run.actionSettled = true
    run.actionResolve(action)
    return true
  }

  const begin = ({ sessionId, messageId, turn, step, permission, text }) => {
    const sid = String(sessionId || '')
    const previous = runs.get(sid)
    if (previous) {
      try { previous.controller?.abort('superseded') } catch { /* best effort */ }
      resolveAction(previous, { action: 'original', reason: 'superseded' })
      if (previous.timer) clearTimeout(previous.timer)
    }
    let actionResolve
    const action = new Promise((resolve) => { actionResolve = resolve })
    const run = {
      id: 'pre-step-' + (++seq).toString(36),
      sessionId: sid,
      messageId: messageId == null ? null : String(messageId),
      turn,
      step,
      permission,
      text,
      packet: '',
      edited: '',
      chars: 0,
      ms: null,
      unsourced: null,
      route: null,
      reason: null,
      usage: null,
      usageTotal: null,
      t0: now(),
      phase: 'optimizing',
      action,
      actionResolve,
      actionSettled: false,
      controller: null,
      timer: null,
    }
    runs.set(sid, run)
    return run
  }

  const decide = ({ sessionId, id, action, text } = {}) => {
    const sid = String(sessionId || '')
    const run = runs.get(sid)
    if (!run) return { ok: false, reason: 'no-active-review' }
    if (id && String(id) !== run.id) return { ok: false, reason: 'stale-review', currentId: run.id }
    const a = String(action || '')
    if (!ACTIONS.has(a)) return { ok: false, reason: 'bad-action' }
    if (a === 'confirm' && run.phase !== 'review' && run.phase !== 'error') {
      return { ok: false, reason: 'not-reviewing' }
    }
    if (a === 'confirm' && text !== undefined) run.edited = String(text)
    if ((a === 'skip' || a === 'original' || a === 'cancel' || a === 'regen') && run.phase === 'optimizing') {
      try { run.controller?.abort('user-decision') } catch { /* best effort */ }
    }
    if (!resolveAction(run, { action: a, text: text === undefined ? null : String(text) })) {
      return { ok: false, reason: 'decision-already-settled' }
    }
    return { ok: true, id: run.id, action: a }
  }

  const clearRunPacket = (sid, reason) => {
    try {
      if (typeof clearPacket === 'function') clearPacket(sid, reason)
      else if (typeof setPacket === 'function') setPacket(sid, '')
    } catch { /* packet clearing must not block the user's message */ }
  }

  const applyAction = async (run, action, downstream) => {
    const kind = action && action.action
    if (kind === 'regen') return { kind: 'regen' }
    if (kind === 'cancel') {
      clearRunPacket(run.sessionId, 'pre-step:cancel')
      finish(run, 'cancelled', { reason: 'cancelled-before-step' })
      return { kind: 'return', decision: { kind: 'reject' } }
    }
    if (kind === 'skip' || kind === 'original') {
      clearRunPacket(run.sessionId, kind === 'skip' ? 'pre-step:skip' : 'pre-step:original')
      finish(run, kind === 'skip' ? 'skipped' : 'sent', {
        reason: kind === 'skip' ? 'optimizer-skipped' : 'sent-original',
        packet: '',
        edited: '',
        chars: 0,
      })
      return { kind: 'return', decision: downstream }
    }
    if (kind === 'confirm') {
      const edited = action.text == null ? String(run.edited == null ? run.packet : run.edited) : String(action.text)
      if (edited !== run.packet && typeof setPacket === 'function') {
        const result = await setPacket(run.sessionId, edited)
        if (result && result.ok === false) {
          run.actionSettled = false
          run.action = new Promise((resolve) => { run.actionResolve = resolve })
          publish(run, { phase: 'error', reason: result.reason || 'packet-write-failed' })
          return { kind: 'wait' }
        }
      }
      finish(run, 'sent', { edited, packet: edited, chars: edited.length })
      return { kind: 'return', decision: downstream }
    }
    return { kind: 'return', decision: downstream }
  }

  const awaitAction = async (run, signal) => {
    if (!signal) return run.action
    if (signal.aborted) return { action: 'cancel', reason: 'turn-aborted' }
    return new Promise((resolve) => {
      let settled = false
      const finishWait = (value) => {
        if (settled) return
        settled = true
        try { signal.removeEventListener('abort', onAbort) } catch { /* old signal */ }
        resolve(value)
      }
      const onAbort = () => finishWait({ action: 'cancel', reason: 'turn-aborted' })
      try { signal.addEventListener('abort', onAbort, { once: true }) } catch { /* old signal */ }
      void run.action.then(finishWait)
    })
  }

  const handle = async (payload, next) => {
    const downstream = await next()
    if (!downstream || downstream.kind !== 'enter') return downstream
    if (payload && payload.signal && payload.signal.aborted) return downstream

    const hit = lastHumanMessage(downstream.messages)
    if (!hit) return downstream
    // Commands claimed by DSH never reach this point. If a slash line does
    // arrive as an ordinary message, leave it to the host rather than
    // second-guessing command ownership.
    if (hit.text.trimStart().startsWith('/')) return downstream

    const sid = agentSessionId(payload && payload.agent)
    if (!sid) return downstream

    let policy
    try { policy = readPolicy(sid) } catch { return downstream }
    if (!policy || policy.injectPacket !== true) {
      clearRunPacket(sid, 'pre-step:assist-off')
      try {
        if (typeof onBypass === 'function') onBypass({
          sessionId: sid,
          text: hit.text,
          messageId: hit.message && hit.message.id != null ? String(hit.message.id) : null,
          reason: 'assist-off',
          policy: policy || null,
        })
      } catch { /* diagnostics must never block the user's message */ }
      return downstream
    }

    const permission = policy.permission === 'review' ? 'review' : 'auto'
    const messageId = hit.message && hit.message.id != null ? String(hit.message.id) : null

    for (;;) {
      if (payload && payload.signal && payload.signal.aborted) return { kind: 'reject' }
      // A new human message must never inherit the previous message's packet
      // when optimization fails or is skipped.
      clearRunPacket(sid, 'pre-step:new-user-input')

      const run = begin({
        sessionId: sid,
        messageId,
        turn: payload && payload.turn,
        step: payload && payload.step,
        permission,
        text: hit.text,
      })
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      run.controller = controller
      const parentSignal = payload && payload.signal
      let detachParent = null
      if (controller && parentSignal) {
        const abort = () => { try { controller.abort('turn-aborted') } catch { /* best effort */ } }
        if (parentSignal.aborted) abort()
        else {
          try {
            parentSignal.addEventListener('abort', abort, { once: true })
            detachParent = () => { try { parentSignal.removeEventListener('abort', abort) } catch { /* best effort */ } }
          } catch { /* old signal */ }
        }
      }

      const optimizePromise = Promise.resolve().then(() => optimize({
        sessionId: sid,
        text: hit.text,
        messageId,
        signal: controller ? controller.signal : parentSignal || null,
        turn: payload && payload.turn,
        step: payload && payload.step,
        agent: payload && payload.agent,
      })).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      )

      const first = await Promise.race([
        optimizePromise.then((result) => ({ kind: 'optimized', result })),
        awaitAction(run, parentSignal).then((action) => ({ kind: 'action', action })),
      ])

      if (first.kind === 'action') {
        try { controller?.abort('user-decision') } catch { /* best effort */ }
        detachParent?.()
        const applied = await applyAction(run, first.action, downstream)
        if (applied.kind === 'regen') continue
        if (applied.kind === 'wait') {
          const again = await awaitAction(run, parentSignal)
          const settled = await applyAction(run, again, downstream)
          if (settled.kind === 'regen') continue
          return settled.decision || downstream
        }
        return applied.decision || downstream
      }

      detachParent?.()
      if (parentSignal && parentSignal.aborted) {
        clearRunPacket(sid, 'pre-step:turn-aborted')
        finish(run, 'cancelled', { reason: 'turn-aborted' })
        return { kind: 'reject' }
      }

      const result = first.result
      const out = result.ok && result.value && typeof result.value === 'object'
        ? result.value
        : { ok: false, reason: result.ok ? 'bad-optimizer-result' : String((result.error && result.error.message) || result.error || 'optimizer-threw') }
      const progress = typeof readProgress === 'function' ? (readProgress(sid) || null) : null
      const usage = progress && progress.usage && typeof progress.usage === 'object' ? progress.usage : null
      publish(run, {
        packet: typeof out.packet === 'string' ? out.packet : (typeof getPacket === 'function' ? String(getPacket(sid) || '') : ''),
        edited: typeof out.packet === 'string' ? out.packet : (typeof getPacket === 'function' ? String(getPacket(sid) || '') : ''),
        chars: typeof out.chars === 'number' ? out.chars : 0,
        ms: typeof out.ms === 'number' ? out.ms : (now() - run.t0),
        unsourced: typeof out.unsourced === 'number' ? out.unsourced : null,
        route: out.route || null,
        reason: out.reason || null,
        usage,
        usageTotal: usage && typeof usage.total === 'number' ? usage.total : null,
      })

      if (out.ok !== true) {
        clearRunPacket(sid, 'pre-step:optimizer-failed')
        if (permission !== 'review') {
          finish(run, 'sent', { reason: out.reason || 'optimizer-failed-open', packet: '', edited: '', chars: 0 })
          return downstream
        }
        publish(run, { phase: 'error', packet: '', edited: '', chars: 0, reason: out.reason || 'optimizer-failed' })
      } else if (permission !== 'review') {
        finish(run, 'sent')
        return downstream
      } else {
        publish(run, { phase: 'review' })
      }

      // Review mode: wait for an explicit user decision. Regenerate stays on
      // the same already-admitted DSH message; original/skip returns the
      // downstream decision unchanged; cancel intentionally rejects the step.
      for (;;) {
        const action = await awaitAction(run, parentSignal)
        const applied = await applyAction(run, action, downstream)
        if (applied.kind === 'regen') break
        if (applied.kind === 'wait') continue
        return applied.decision || downstream
      }
    }
  }

  const release = (sessionId, action = 'original', reason = 'external-release') => {
    const sid = String(sessionId || '')
    const run = runs.get(sid)
    if (!run) return false
    try { run.controller?.abort(reason) } catch { /* best effort */ }
    return resolveAction(run, { action, reason })
  }

  const releaseAll = (action = 'original', reason = 'external-release') => {
    let released = 0
    for (const run of runs.values()) {
      try { run.controller?.abort(reason) } catch { /* best effort */ }
      if (resolveAction(run, { action, reason })) released += 1
    }
    return released
  }

  const dispose = () => {
    for (const run of runs.values()) {
      try { run.controller?.abort('dispose') } catch { /* best effort */ }
      resolveAction(run, { action: 'original', reason: 'dispose' })
      if (run.timer) clearTimeout(run.timer)
    }
    runs.clear()
  }

  return { handle, state, decide, release, releaseAll, dispose }
}
