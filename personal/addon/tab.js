'use strict'
let current = null, period = 'total'
const el = id => document.getElementById(id)
const amount = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
function render() {
  if (!current) return
  const s = current
  const stale = !s.lastSeen || Date.now() - s.lastSeen > 60_000
  el('status').className = s.error || s.replay ? 'error' : ''
  el('status').textContent = s.error ? `${s.error}. Pending writes: ${s.pending}.` : s.replay ? 'Replay mode: history is not updated.' : !s.readerActive ? `History paused: ${s.readerError ?? 'reader is disabled or starting'}.` : stale ? 'Waiting for new Kina packets. Saved history is retained.' : 'Tracking · history is saved locally'
  for (const currency of ['unbound', 'bound']) el(currency).textContent = currency === 'bound' && !s.readerActive ? 'Paused' : s.rates[currency] === null ? 'Calculating…' : amount(s.rates[currency])
  const h = s.history
  el('total').textContent = h ? amount(h.totals[period]) : 'Unavailable'
  el('people').replaceChildren()
  for (const person of h?.rows ?? []) {
    const row = document.createElement('tr'), label = document.createElement('td'), value = document.createElement('td')
    label.textContent = person.key === '?' ? 'Unassigned character' : person.name
    if (person.server) { const server = document.createElement('small'); server.textContent = nyerk.serverName(person.server); label.append(server) }
    value.textContent = amount(person[period]); row.append(label, value); el('people').append(row)
  }
  el('empty').hidden = Boolean(h?.rows.length)
  el('started').textContent = h ? `Tracking since ${new Date(h.startedAt).toLocaleString('en-US')}.` : 'History is currently unavailable.'
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
  catch (error) { el('status').textContent = `Could not save setting: ${error.message}`; el('icons').checked = current?.config.bubbleIcons ?? true }
  finally { el('icons').disabled = false }
})
el('preview').addEventListener('click', async () => {
  try { await nyerk.send('preview'); el('preview-status').textContent = 'Preview: Kaira → Shugo, every 3 seconds. Normal alerts resume after 12 seconds.' }
  catch (error) { el('preview-status').textContent = `Could not start preview: ${error.message}` }
})
nyerk.on('stats', data => { current = data; render() })
nyerk.ready.then(() => nyerk.send('refresh')).catch(error => { el('status').textContent = error.message })
