export function formatKina(n) {
  if (n < 1000) return String(Math.round(n))
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 2 : n < 1e5 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`
}
export function perHour(s, now) {
  if (!s?.earned || s.lastAt === null) return null
  const ms = s.activeMs + Math.min(Math.max(now - s.lastAt, 0), 300000)
  return ms < 60000 ? null : s.earned / ms * 3600000
}
export function ratesText(session, now) {
  const text = s => { const rate = perHour(s, now); return rate === null ? (s?.earned ? '…' : '0') : formatKina(rate) }
  return `Kina/h ${text(session)} · Bound/h ${session.boundActive === false ? 'paused' : text(session.bound)}`
}
export function personalClock(ref, dispose) {
  const now = ref(Date.now())
  const timer = setInterval(() => now.value = Date.now(), 5000)
  dispose(() => clearInterval(timer))
  return now
}
export function boundCard(create, session, now) {
  const bound = session.bound
  const rate = perHour(bound, now)
  return create('div', { class: 'rounded-lg bg-card p-3 text-center', style: 'grid-column:1/-1' }, [
    create('div', { class: 'text-3xl font-semibold tabular-nums text-yellow' }, session.boundActive === false ? 'paused' : rate === null ? (bound?.earned ? 'measuring…' : '0') : formatKina(rate), 1),
    create('div', { class: 'text-xs text-darker' }, `Bound Kina per hour · ${formatKina(bound?.earned ?? 0)} earned`, 1),
  ])
}

export class AlertQueue {
  constructor() { this.keys = []; this.current = null; this.changedAt = 0 }
  select(alerts, now) {
    const sorted = [...alerts].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    this.keys = sorted.map(a => `${a.id}@${a.at}`)
    if (!this.keys.includes(this.current)) { this.current = this.keys[0] ?? null; this.changedAt = now }
    else if (now - this.changedAt >= 3000) {
      this.current = this.keys[(this.keys.indexOf(this.current) + 1) % this.keys.length]
      this.changedAt = now
    }
    const index = this.keys.indexOf(this.current)
    return index < 0 ? null : sorted[index]
  }
}
export function personalBubble(store, ref, computed, watch, mounted, dispose, bridge, normalIcon) {
  const state = ref({ config: { bubbleIcons: true }, icons: [] })
  const selected = ref(null), failed = new Set(), queue = new AlertQueue()
  let timer, off
  const tick = () => { selected.value = queue.select(state.value.config.bubbleIcons ? store.alerting : [], Date.now()) }
  mounted(() => {
    off = bridge().on('personal:state', data => { state.value = data; tick() })
    bridge().invoke('personal:get').then(data => { state.value = data; tick() }).catch(() => {})
    timer = setInterval(tick, 250)
    tick()
  })
  watch(() => store.alerting, tick, { deep: true })
  dispose(() => { off?.(); clearInterval(timer) })
  return computed(() => {
    const alert = selected.value
    const def = state.value.icons.find(i => i.id === alert?.id)
    const src = alert ? (failed.has(def?.src) ? 'personal-icons/event.svg' : def?.src ?? 'personal-icons/event.svg') : normalIcon
    return { src, title: alert ? `${def?.name ?? alert.id} · ${new Date(alert.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${store.alerting.length} уведомл. — нажмите, чтобы открыть` : null,
      failed: () => { if (def?.src && !failed.has(def.src)) { failed.add(def.src); state.value = { ...state.value } } } }
  })
}
