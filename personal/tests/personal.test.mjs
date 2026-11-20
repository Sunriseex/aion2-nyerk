import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { AlertQueue, ratesText, personalBubble } from '../renderer.mjs'
import { patchMain, patchRenderer, replaceOnce } from '../build.mjs'
const require = createRequire(import.meta.url)
const { Ledger, DAY } = require('../ledger.cjs')
const { createPersonal } = require('../runtime.cjs')

const gain = (id, amount, at, identity = null, epoch = 'session') => ({ kind: 'gain', id, amount, at, identity, epoch })
function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nyerk-personal-test-'))
  try { return fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
test('rolling periods exclude exact lower boundary and future records; all-time survives pruning and reopening', () => temporary(dir => {
  const now = 50 * DAY, file = join(dir, 'history.sqlite')
  let db = new Ledger(file, 0)
  const who = { name: 'Templar', server: 1104 }
  db.apply(gain('ancient', 100, now - 40 * DAY, who))
  db.apply(gain('30-boundary', 200, now - 30 * DAY, who))
  db.apply(gain('30-inside', 300, now - 30 * DAY + 1, who))
  db.apply(gain('7-boundary', 400, now - 7 * DAY, who))
  db.apply(gain('7-inside', 500, now - 7 * DAY + 1, who))
  db.apply(gain('present', 600, now, who))
  db.apply(gain('future', 700, now + 1, who))
  assert.deepEqual(db.snapshot(now).totals, { total: 2800, days7: 1100, days30: 1800 })
  db.prune(now); db.close(); db = new Ledger(file, now)
  assert.equal(db.snapshot(now).startedAt, 0)
  assert.equal(db.snapshot(now).totals.total, 2800)
  db.close()
}))
test('duplicate events are idempotent and unidentified income moves only within its confirmed epoch', () => temporary(dir => {
  const db = new Ledger(join(dir, 'history.sqlite'), 0)
  db.apply(gain('a', 100, 1))
  db.apply(gain('a', 100, 1))
  db.apply(gain('b', 200, 1, null, 'other-session'))
  db.apply({ kind: 'assign', epoch: 'session', identity: { name: 'SameName', server: 1104 } })
  db.apply({ kind: 'assign', epoch: 'session', identity: { name: 'SameName', server: 1104 } })
  db.apply(gain('c', 50, 2, { name: 'SameName', server: 2104 }))
  const s = db.snapshot(10)
  assert.equal(s.totals.total, 350)
  assert.deepEqual(s.rows.map(r => [r.key, r.total]), [['?', 200], ['1104:SameName', 100], ['2104:SameName', 50]])
  assert.throws(() => db.apply(gain('invalid', -1, 2)), /Invalid income/)
  assert.equal(db.snapshot(10).totals.total, 350)
  db.close()
}))
test('failed transaction rolls back both the event and lifetime amount', () => temporary(dir => {
  const db = new Ledger(join(dir, 'history.sqlite'), 0)
  const original = db.increment
  db.increment = () => { throw new Error('write failed') }
  assert.throws(() => db.apply(gain('retry', 100, 1)), /write failed/)
  assert.equal(db.snapshot(2).totals.total, 0)
  db.increment = original; db.apply(gain('retry', 100, 1))
  assert.equal(db.snapshot(2).totals.total, 100)
  db.close()
}))
test('corrupt database is rejected without replacing its contents', () => temporary(dir => {
  const file = join(dir, 'history.sqlite'), bytes = Buffer.from('This is not SQLite')
  writeFileSync(file, bytes)
  assert.throws(() => new Ledger(file))
  assert.deepEqual(readFileSync(file), bytes)
}))

function runtimeFixture(dir) {
  const ipc = new Map(), hooks = new Map(), state = { latest: null }
  const app = { getPath: () => dir, on: (name, fn) => hooks.set(name, fn) }
  const runtime = createPersonal({ app, ipcMain: { handle: (name, fn) => ipc.set(name, fn) },
    rendererFile: resolve(dir, 'out/renderer/index.html'), timers: () => [], setKina: s => state.latest = s,
    publish: () => {}, broadcast: () => {} })
  runtime.start()
  return { runtime, state, close: () => hooks.get('before-quit')(), ipc }
}
test('runtime separates currencies; spending, reconnects, character switches and session reset never inflate history', () => temporary(dir => {
  const { runtime: r, state, close } = runtimeFixture(dir)
  const balance = (currency, value) => r.accept({ type: 'addon', addon: 'personal-kina', name: 'balance', data: { currency, balance: value } })
  try {
    balance('bound', 1000); balance('unbound', 100)
    balance('bound', 1100); balance('unbound', 150); balance('bound', 900); balance('bound', 950)
    assert.equal(state.latest.earned, 50); assert.equal(state.latest.bound.earned, 150)
    r.accept({ type: 'character', name: 'Alpha', server: 1104 })
    assert.equal(r.snapshot().history.rows[0].key, '1104:Alpha')
    r.accept({ type: 'kina', balance: 99999999 })
    assert.equal(state.latest.earned, 50)
    r.begin(); balance('bound', 500000); balance('bound', 500010)
    r.accept({ type: 'character', name: 'Beta', server: 1104 })
    r.resetSession()
    assert.equal(state.latest.bound.earned, 0)
    assert.equal(r.snapshot().history.totals.total, 160)
    balance('bound', 500015)
    assert.equal(r.snapshot().history.totals.total, 165)
    balance('bound', Number.MAX_SAFE_INTEGER + 1)
    assert.equal(r.snapshot().history.totals.total, 165)
  } finally { close() }
}))
test('replay never persists gains and new IPC rejects foreign frames', () => temporary(dir => {
  const previous = process.env.A2T_REPLAY
  process.env.A2T_REPLAY = 'test-only.pcap'
  const f = runtimeFixture(dir)
  try {
    for (const balance of [100, 200]) f.runtime.accept({ type: 'addon', addon: 'personal-kina', name: 'balance', data: { currency: 'bound', balance } })
    assert.equal(f.runtime.snapshot().history, null)
    const frame = { url: 'https://example.com/out/renderer/index.html' }
    assert.throws(() => f.ipc.get('personal:get')({ senderFrame: frame, sender: { mainFrame: frame } }), /Unauthorized/)
    assert.throws(() => f.runtime.request('config', { bubbleIcons: 'yes' }), /Invalid/)
    assert.throws(() => f.runtime.request('eval', {}), /Unknown/)
  } finally { f.close(); if (previous === undefined) delete process.env.A2T_REPLAY; else process.env.A2T_REPLAY = previous }
}))
test('runtime retains failed writes and retries them without counting the same income twice', () => temporary(dir => {
  const f = runtimeFixture(dir), original = Ledger.prototype.apply
  let failing = true
  Ledger.prototype.apply = function (event) { if (failing) throw new Error('disk full'); return original.call(this, event) }
  try {
    for (const balance of [100, 200]) f.runtime.accept({ type: 'addon', addon: 'personal-kina', name: 'balance', data: { currency: 'bound', balance } })
    assert.equal(f.runtime.snapshot().pending, 1)
    assert.match(f.runtime.snapshot().error, /disk full/)
    failing = false
    assert.equal(f.runtime.snapshot().history.totals.total, 100)
    assert.equal(f.runtime.snapshot().pending, 0)
    assert.equal(f.runtime.snapshot().history.totals.total, 100)
  } finally { Ledger.prototype.apply = original; f.close() }
}))
test('alert queue rotates every three seconds, keeps position on additions, and drops dismissed events', () => {
  const q = new AlertQueue(), a = { id: 'a', at: 20 }, b = { id: 'b', at: 30 }, c = { id: 'c', at: 10 }
  assert.equal(q.select([b, a], 0), a)
  assert.equal(q.select([a, b], 2999), a)
  assert.equal(q.select([a, b, c], 3000), b)
  assert.equal(q.select([b, c], 3500), b)
  assert.equal(q.select([b, c], 6000), c)
  assert.equal(q.select([], 6500), null)
  assert.equal(q.select([a], 7000), a)
})
test('independent rates render while ordinary currency is idle', () => {
  assert.equal(ratesText({ earned: 0, bound: { earned: 1000, activeMs: 60000, lastAt: 60000 } }, 60000), 'Kina/h 0 · Bound/h 60.0k')
})
test('patcher refuses ambiguous inputs and preserves the original DPS, custom sound and addon HUD implementations', () => {
  assert.throws(() => replaceOnce('x x', 'x', 'y'), /ambiguous/)
  const base = process.env.NYERK_REVIEW_BASE
  assert.ok(base, 'Set NYERK_REVIEW_BASE to the extracted original 0.2.64/out folder')
  const original = readFileSync(join(base, 'main/index.js'), 'utf8')
  const patched = patchMain(original)
  for (const text of ['async function pickSound(', 'function setAddonHudHover(', 'function moveKillFeedToHud(', 'customSounds']) assert.ok(patched.includes(text), text)
  const renderer = patchRenderer(readFileSync(join(base, 'renderer/assets/index-D0Azwfnj.js'), 'utf8'))
  for (const text of ['customSounds[v.id]', 'personalIcon.value.src', 'boundCard(c,t.kina,personalNow.value)', '__name:"SessionTab"']) assert.ok(renderer.includes(text), text)
})
