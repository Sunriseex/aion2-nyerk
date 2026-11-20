'use strict'
const { mkdirSync, readFileSync, writeFileSync, renameSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { randomUUID } = require('node:crypto')
const { Ledger } = require('./ledger.cjs')
const gameIcons = require('./game-icons.json').icons

const blank = () => ({ balance: null, earned: 0, activeMs: 0, lastAt: null, gains: [] })
function update(s, balance, now) {
  if (s.balance === null) return { ...s, balance, lastAt: s.earned ? s.lastAt : now }
  const gain = balance - s.balance
  if (gain <= 0) return { ...s, balance }
  return { balance, earned: s.earned + gain, activeMs: s.activeMs + (s.lastAt === null ? 0 : Math.min(Math.max(now - s.lastAt, 0), 300_000)),
    lastAt: now, gains: [...s.gains.filter(([at]) => at > now - 35 * 60_000), [now, gain]] }
}
function rate(s, now) {
  if (!s?.earned || s.lastAt === null) return null
  const ms = s.activeMs + Math.min(Math.max(now - s.lastAt, 0), 300_000)
  return ms < 60_000 ? null : s.earned / ms * 3_600_000
}
function createPersonal(api) {
  let ledger, directory, error = null, persistence = true, lastSeen = null, readerActive = false, readerError = null
  let state = { ...blank(), bound: blank() }, identity = null, epoch = randomUUID(), seq = 0
  const pending = []
  let config = { bubbleIcons: true }
  let preview = null
  let timer, lastPrune = 0
  function flush() {
    if (!persistence) return
    try {
      mkdirSync(directory, { recursive: true })
      ledger ??= new Ledger(join(directory, 'history.sqlite'))
      while (pending.length) { ledger.apply(pending[0]); pending.shift() }
      if (Date.now() - lastPrune > 3_600_000) { ledger.prune(Date.now()); lastPrune = Date.now() }
      error = null
    } catch (err) { error = `История не сохранена: ${err.message}` }
  }
  function icons() {
    return api.timers().map(t => ({ id: t.id, name: t.name,
      src: gameIcons[t.id]?.file ?? (t.schedule.kind === 'boss' ? `bosses/${t.schedule.boss}.webp` : `personal-icons/${t.id}.svg`) }))
  }
  function snapshot() {
    if (preview && Date.now() >= preview.expiresAt) preview = null
    flush()
    let history = null
    try { if (ledger) history = ledger.snapshot(Date.now()) }
    catch (err) { error = `История недоступна: ${err.message}` }
    return { version: '1.1.1', base: '0.2.64', history, error, pending: pending.length, replay: !persistence, preview,
      config, icons: icons(), identity, lastSeen, readerActive, readerError,
      rates: { unbound: rate(state, Date.now()), bound: readerActive ? rate(state.bound, Date.now()) : null },
      earned: { unbound: state.earned, bound: state.bound.earned } }
  }
  function publish() {
    const data = snapshot()
    api.publish(data)
    api.broadcast('personal:state', { config: data.config, icons: data.icons, preview: data.preview })
  }
  function rebase() {
    state = { ...state, balance: null, bound: { ...state.bound, balance: null } }
    sendState()
  }
  function sendState() { api.setKina({ ...state, boundActive: readerActive }) }
  function begin() {
    epoch = randomUUID(); seq = 0; identity = null; lastSeen = null
    rebase()
  }
  function identify(who) {
    if (!who || typeof who.name !== 'string' || !who.name.trim() || who.name.length > 100 ||
        !Number.isInteger(who.server) || who.server < 1000 || who.server > 9999) return
    if (identity && (identity.name !== who.name || identity.server !== who.server)) begin()
    if (!identity) {
      identity = { name: who.name, server: who.server }
      if (persistence) pending.push({ kind: 'assign', epoch, identity })
      flush()
    }
  }
  function balance(data) {
    if (!data || !['bound', 'unbound'].includes(data.currency) || !Number.isSafeInteger(data.balance) || data.balance < 0) return
    const now = Date.now(), old = data.currency === 'bound' ? state.bound : state
    const next = update(old, data.balance, now)
    lastSeen = now
    if (data.currency === 'bound') {
      state = { ...state, bound: next }
      const gain = next.earned - old.earned
      if (gain > 0 && persistence) {
        pending.push({ kind: 'gain', id: `${epoch}:${++seq}`, epoch, identity, at: now, amount: gain })
        flush()
      }
    } else state = { ...next, bound: state.bound }
    sendState()
  }
  return {
    start() {
      directory = join(api.app.getPath('userData'), 'personal-kina')
      persistence = !process.env.A2T_REPLAY
      try {
        const saved = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
        if (typeof saved.bubbleIcons === 'boolean') config = { bubbleIcons: saved.bubbleIcons }
      } catch (err) { if (err.code !== 'ENOENT') error = `Настройки дополнения не прочитаны: ${err.message}` }
      const expected = pathToFileURL(api.rendererFile).pathname
      api.ipcMain.handle('personal:get', event => {
        const frame = event.senderFrame
        const url = new URL(frame?.url ?? 'about:blank')
        if (frame !== event.sender.mainFrame || url.protocol !== 'file:' || url.pathname !== expected) throw new Error('Unauthorized personal view')
        return { config, icons: icons(), version: '1.1.1', preview }
      })
      timer = setInterval(publish, 5000); timer.unref()
      api.app.on('before-quit', () => { clearInterval(timer); flush(); ledger?.close() })
      publish()
    },
    begin, rebase,
    helperStarting() { readerActive = false; readerError = null; begin() },
    restore(saved) {
      state = { ...saved, bound: saved.bound ?? blank() }
      rebase()
      return state
    },
    resetSession() {
      state = { ...blank(), balance: state.balance, bound: { ...blank(), balance: state.bound.balance } }
      sendState(); publish()
    },
    request(name, data) {
      if (name === 'preview') {
        if (data !== undefined && data !== null) throw new Error('Preview does not accept parameters')
        const now = Date.now()
        preview = { expiresAt: now + 12_000, alerts: [{ id: 'kaira', at: now + 300_000 }, { id: 'shugo', at: now + 300_000 }] }
      } else if (name === 'config') {
        if (!data || typeof data.bubbleIcons !== 'boolean') throw new Error('Invalid icon setting')
        const next = { bubbleIcons: data.bubbleIcons }
        writeFileSync(join(directory, 'config.json.part'), JSON.stringify(next))
        renameSync(join(directory, 'config.json.part'), join(directory, 'config.json'))
        config = next
      } else if (name !== 'refresh') throw new Error('Unknown personal request')
      publish()
      return null
    },
    accept(ev) {
      // The standard ordinary stream remains useful if the personal reader is disabled or fails.
      if (ev.type === 'kina') {
        if (!readerActive) balance({ currency: 'unbound', balance: ev.balance })
        return true
      }
      if (ev.type === 'sync') begin()
      if (ev.type === 'character') identify({ name: ev.name, server: ev.server })
      if (ev.type === 'addonLoaded' && ev.addon === 'personal-kina') { readerActive = true; readerError = null; begin() }
      if (ev.type === 'addonError' && ev.addon === 'personal-kina' && ev.fatal) {
        readerActive = false; readerError = String(ev.detail ?? 'Ошибка считывателя'); begin()
      }
      if (ev.type === 'status' && ['listening', 'idle'].includes(ev.state)) begin()
      if (ev.type !== 'addon' || ev.addon !== 'personal-kina') return false
      if (ev.name === 'balance') { if (readerActive) balance(ev.data) }
      else if (ev.name === 'identity') identify(ev.data)
      else if (ev.name === 'boundary') begin()
      else if (ev.name === 'refresh') publish()
      else return false
      return true
    },
    snapshot,
  }
}
module.exports = { createPersonal, update, rate, blank }
