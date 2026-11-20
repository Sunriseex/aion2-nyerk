import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { AlertQueue, ratesText, boundCard, iconAlerts } from '../renderer.mjs'
import { createHash } from 'node:crypto'
import { createRenderer, openBlock, createElementBlock, createElementVNode } from '../../app/node_modules/vue/dist/vue.runtime.esm-bundler.js'
import { patchMain, patchRenderer, replaceOnce } from '../build.mjs'
import { TIMERS } from '../../app/src/shared/timers.ts'
const require = createRequire(import.meta.url)
const { Ledger, DAY } = require('../ledger.cjs')
const { createPersonal } = require('../runtime.cjs')

const gain = (id, amount, at, identity = null, epoch = 'session') => ({ kind: 'gain', id, amount, at, identity, epoch })
function temporary(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nyerk-personal-test-'))
  try { return fn(dir) } finally {
    assert.ok(resolve(dir).startsWith(resolve(join(tmpdir(), 'nyerk-personal-test-'))))
    rmSync(dir, { recursive: true, force: true })
  }
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

function runtimeFixture(dir, timers = [{ id: 'gartua', name: 'Gartua', schedule: { kind: 'boss', boss: 101021 } }]) {
  const ipc = new Map(), hooks = new Map(), state = { latest: null, broadcasts: [] }
  const app = { getPath: () => dir, on: (name, fn) => hooks.set(name, fn) }
  const runtime = createPersonal({ app, ipcMain: { handle: (name, fn) => ipc.set(name, fn) },
    rendererFile: resolve(dir, 'out/renderer/index.html'), timers: () => timers, setKina: s => state.latest = s,
    publish: () => {}, broadcast: (channel, payload) => state.broadcasts.push({ channel, payload }) })
  runtime.start()
  runtime.accept({ type: 'addonLoaded', addon: 'personal-kina' })
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
test('unwritable history path does not abort app startup and reports the problem', () => temporary(dir => {
  writeFileSync(join(dir, 'personal-kina'), 'existing file, not a directory')
  const f = runtimeFixture(dir)
  try {
    assert.match(f.runtime.snapshot().error, /History not saved/)
    assert.equal(f.runtime.snapshot().history, null)
    assert.equal(readFileSync(join(dir, 'personal-kina'), 'utf8'), 'existing file, not a directory')
  } finally { f.close() }
}))
test('disabled or failed personal reader leaves ordinary rates available without writing bound history', () => temporary(dir => {
  const f = runtimeFixture(dir)
  try {
    for (const balance of [100, 200]) f.runtime.accept({ type: 'addon', addon: 'personal-kina', name: 'balance', data: { currency: 'bound', balance } })
    f.runtime.helperStarting()
    for (const balance of [1000, 1050]) f.runtime.accept({ type: 'kina', balance })
    assert.equal(f.state.latest.earned, 50)
    assert.equal(f.state.latest.boundActive, false)
    assert.equal(f.runtime.snapshot().history.totals.total, 100)
    f.runtime.accept({ type: 'addonLoaded', addon: 'personal-kina' })
    f.runtime.accept({ type: 'kina', balance: 99999 })
    assert.equal(f.state.latest.balance, null)
    f.runtime.accept({ type: 'addonError', addon: 'personal-kina', fatal: true, detail: 'test error' })
    assert.equal(f.runtime.snapshot().readerActive, false)
    assert.equal(f.runtime.snapshot().readerError, 'test error')
  } finally { f.close() }
}))
test('packaged icon URLs resolve beside renderer assets, not at the drive root', () => temporary(dir => {
  const f = runtimeFixture(dir)
  try {
    const icon = f.runtime.snapshot().icons[0].src
    assert.equal(new URL(icon, 'file:///C:/app/out/renderer/index.html').pathname, '/C:/app/out/renderer/bosses/101021.webp')
    assert.equal(new URL('personal-icons/event.svg', 'file:///C:/app/out/renderer/index.html').pathname, '/C:/app/out/renderer/personal-icons/event.svg')
  } finally { f.close() }
}))
test('bound Session card updates inside an optimized Vue compiled block', () => {
  const host = createRenderer({
    createElement: tag => ({ tag, children: [], text: '' }), createText: text => ({ text }), createComment: text => ({ text }),
    setText: (node, text) => node.text = text, setElementText: (node, text) => { node.text = text; node.children = [] },
    insert: (node, parent) => { node.parent = parent; parent.children.push(node) },
    remove: node => node.parent.children.splice(node.parent.children.indexOf(node), 1),
    parentNode: node => node.parent, nextSibling: () => null, patchProp: (node, key, _old, value) => { (node.props ??= {})[key] = value },
  })
  const root = { children: [] }
  const view = earned => {
    openBlock()
    return createElementBlock('section', null, [boundCard(createElementVNode, { bound: { earned, activeMs: 60000, lastAt: 60000 } }, 60000)])
  }
  host.render(view(0), root)
  assert.equal(root.children[0].children[0].children[0].text, 'Calculating…')
  assert.match(root.children[0].children[0].children[0].props.class, /text-lg/)
  host.render(view(100), root)
  const card = root.children[0].children[0]
  assert.equal(card.children[0].text, '6.00k')
  assert.match(card.children[0].props.class, /text-3xl/)
  assert.equal(card.children[1].text, 'Bound Kina per hour · 100 earned')
})
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
test('simultaneous Kaira and Shugo preview rotates twice, expires, and restores real alerts', () => {
  const real = [{ id: 'invasion', at: 50000 }]
  const state = { config: { bubbleIcons: true }, preview: { expiresAt: 12000, alerts: [{ id: 'kaira', at: 20000 }, { id: 'shugo', at: 20000 }] } }
  const queue = new AlertQueue()
  for (const [now, expected] of [[0, 'kaira'], [2999, 'kaira'], [3000, 'shugo'], [5999, 'shugo'], [6000, 'kaira'], [9000, 'shugo'], [12000, 'invasion']]) {
    assert.equal(queue.select(iconAlerts(real, state, now), now).id, expected)
  }
  assert.deepEqual(real, [{ id: 'invasion', at: 50000 }])
  state.config.bubbleIcons = false
  assert.deepEqual(iconAlerts(real, state, 13000), [])
  assert.equal(iconAlerts(real, state, 1).length, 2, 'explicit preview does not change the stored toggle')
})
test('preview request does not change history, rates, configuration, or publish a real timer alert', () => temporary(dir => {
  const f = runtimeFixture(dir), before = f.runtime.snapshot(), originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  try {
    f.runtime.request('preview')
    const during = f.runtime.snapshot()
    assert.deepEqual(during.preview.alerts.map(a => a.id), ['kaira', 'shugo'])
    assert.deepEqual(during.history, before.history)
    assert.deepEqual(during.config, before.config)
    assert.deepEqual(during.earned, before.earned)
    assert.ok(f.state.broadcasts.every(event => event.channel === 'personal:state'))
    assert.equal(during.preview.expiresAt, now + 12000)
    assert.throws(() => f.runtime.request('preview', { id: 'arbitrary-event' }), /does not accept/)
    now += 12000
    assert.equal(f.runtime.snapshot().preview, null)
  } finally { Date.now = originalNow; f.close() }
}))
test('client icons have pinned hashes, WebP images, game resource identifiers and matching local URLs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../game-icons.json', import.meta.url)))
  assert.equal(Object.keys(manifest.icons).length, 10)
  for (const [id, asset] of Object.entries(manifest.icons)) {
    const bytes = readFileSync(new URL(`../assets/icons/${id}.webp`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
    assert.equal(asset.file, `personal-icons/${id}.webp`)
    assert.ok(asset.source.startsWith('https://'))
    assert.ok(asset.registryKey)
  }
  assert.equal(manifest.icons.shugo.registryKey, 'menu.FieldEvent')
  assert.equal(manifest.icons.invasion.registryKey, 'fieldevent.DimensionInvasion')
  assert.equal(manifest.icons.merchant.registryKey, 'menu.Trade')
  assert.equal(manifest.icons.dailyReset.registryKey, 'menu.Attendance')
  assert.equal(manifest.icons.dailyReset.sha256, manifest.icons.weeklyReset.sha256)
})
test('every defined notification resolves to an existing game image, including merchant and both resets', () => temporary(dir => {
  const f = runtimeFixture(dir, TIMERS)
  try {
    const base = process.env.NYERK_REVIEW_BASE
    assert.ok(base)
    for (const icon of f.runtime.snapshot().icons) {
      assert.ok(!icon.src.endsWith('.svg'), `${icon.id} still uses a drawn fallback`)
      const file = icon.src.startsWith('bosses/') ? join(base, 'renderer', icon.src) : new URL(`../assets/icons/${icon.id}.webp`, import.meta.url)
      const bytes = readFileSync(file)
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', icon.id)
    }
    const sources = new Map(f.runtime.snapshot().icons.map(icon => [icon.id, icon.src]))
    assert.equal(sources.get('merchant'), 'personal-icons/merchant.webp')
    assert.equal(sources.get('dailyReset'), 'personal-icons/dailyReset.webp')
    assert.equal(sources.get('weeklyReset'), 'personal-icons/weeklyReset.webp')
  } finally { f.close() }
}))
test('independent rates render while ordinary currency is idle', () => {
  assert.equal(ratesText({ earned: 0, bound: { earned: 1000, activeMs: 60000, lastAt: 60000 } }, 60000), 'Kina/h Calculating… · Bound/h 60.0k')
})
test('unmeasured rates say Calculating until the one-minute threshold and keep Paused distinct', () => {
  const early = { earned: 100, activeMs: 30000, lastAt: 30000 }
  assert.equal(ratesText({ earned: 0 }, 0), 'Kina/h Calculating… · Bound/h Calculating…')
  assert.equal(ratesText({ ...early, bound: early }, 30000), 'Kina/h Calculating… · Bound/h Calculating…')
  assert.equal(ratesText({ ...early, bound: early }, 60000), 'Kina/h 6.00k · Bound/h 6.00k')
  assert.equal(ratesText({ ...early, bound: early, boundActive: false }, 60000), 'Kina/h 6.00k · Bound/h Paused')
})
test('extension UI is English while character names remain dynamic data', () => {
  for (const file of ['renderer.mjs', 'runtime.cjs', 'addon/manifest.json', 'addon/tab.html', 'addon/tab.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /[\u0400-\u04ff]/, file)
  }
  const manifest = JSON.parse(readFileSync(new URL('../addon/manifest.json', import.meta.url)))
  assert.equal(manifest.tab.label, 'Kina')
  assert.match(readFileSync(new URL('../addon/tab.html', import.meta.url), 'utf8'), /<html lang="en">/)
})
test('patcher refuses ambiguous inputs and preserves the original DPS, custom sound and addon HUD implementations', () => {
  assert.throws(() => replaceOnce('x x', 'x', 'y'), /ambiguous/)
  const base = process.env.NYERK_REVIEW_BASE
  assert.ok(base, 'Set NYERK_REVIEW_BASE to the extracted original 0.2.64/out folder')
  const original = readFileSync(join(base, 'main/index.js'), 'utf8')
  const patched = patchMain(original)
  for (const text of ['async function pickSound(', 'function setAddonHudHover(', 'function moveKillFeedToHud(', 'customSounds']) assert.ok(patched.includes(text), text)
  const renderer = patchRenderer(readFileSync(join(base, 'renderer/assets/index-D0Azwfnj.js'), 'utf8'))
  for (const text of ['customSounds[v.id]', 'personalIcon.value.src', 'key:personalIcon.value.active?"personal-alert":o.value', 'boundCard(c,t.kina,personalNow.value)', '__name:"SessionTab"']) assert.ok(renderer.includes(text), text)
  assert.ok(renderer.includes('"overflow-wrap":"anywhere"'))
  assert.ok(renderer.includes('h("div",O0,"Calculating…")'))
  assert.ok(renderer.includes('h("div",N0,"Calculating…")'))
})
