'use strict'
let current = null, period = 'total'
const el = id => document.getElementById(id)
const amount = n => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)
function render() {
  if (!current) return
  const s = current
  const stale = !s.lastSeen || Date.now() - s.lastSeen > 60_000
  el('status').className = s.error || s.replay ? 'error' : ''
  el('status').textContent = s.error ? `${s.error}. Ожидают записи: ${s.pending}.` : s.replay ? 'Воспроизведение записи: история не пополняется.' : !s.readerActive ? `История на паузе: ${s.readerError ?? 'считыватель выключен или запускается'}.` : stale ? 'Ожидание новых пакетов кины. Накопленная история сохранена.' : 'Учёт активен · история сохраняется локально'
  for (const currency of ['unbound', 'bound']) el(currency).textContent = s.rates[currency] === null ? (s.earned[currency] ? '…' : '0') : amount(s.rates[currency])
  const h = s.history
  el('total').textContent = h ? amount(h.totals[period]) : '…'
  el('people').replaceChildren()
  for (const person of h?.rows ?? []) {
    const row = document.createElement('tr'), label = document.createElement('td'), value = document.createElement('td')
    label.textContent = person.name
    if (person.server) { const server = document.createElement('small'); server.textContent = nyerk.serverName(person.server); label.append(server) }
    value.textContent = amount(person[period]); row.append(label, value); el('people').append(row)
  }
  el('empty').hidden = Boolean(h?.rows.length)
  el('started').textContent = h ? `Учёт с ${new Date(h.startedAt).toLocaleString('ru-RU')}.` : 'История пока недоступна.'
  el('icons').checked = s.config.bubbleIcons
}
document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
  period = button.dataset.period
  document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
  render()
}))
el('icons').addEventListener('change', async () => {
  el('icons').disabled = true
  try { await nyerk.send('config', { bubbleIcons: el('icons').checked }) }
  catch (error) { el('status').textContent = `Не удалось сохранить настройку: ${error.message}`; el('icons').checked = current?.config.bubbleIcons ?? true }
  finally { el('icons').disabled = false }
})
nyerk.on('stats', data => { current = data; render() })
nyerk.ready.then(() => nyerk.send('refresh')).catch(error => { el('status').textContent = error.message })
