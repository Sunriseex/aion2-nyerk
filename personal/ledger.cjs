'use strict'
const { DatabaseSync } = require('node:sqlite')

const DAY = 86_400_000
class Ledger {
  constructor(file, now = Date.now()) {
    this.db = new DatabaseSync(file)
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS people (key TEXT PRIMARY KEY, name TEXT NOT NULL, server INTEGER);
      CREATE TABLE IF NOT EXISTS totals (person TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount >= 0));
      CREATE TABLE IF NOT EXISTS gains (
        id TEXT PRIMARY KEY, epoch TEXT NOT NULL, person TEXT NOT NULL,
        at INTEGER NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0));
      CREATE INDEX IF NOT EXISTS gains_time ON gains(at);
      CREATE INDEX IF NOT EXISTS gains_epoch ON gains(epoch, person);`)
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?, ?)').run('startedAt', String(now))
      this.db.prepare('INSERT OR IGNORE INTO people VALUES (?, ?, NULL)').run('?', 'Unassigned character')
    } catch (error) { this.db.close(); throw error }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  person(identity) {
    if (!identity) return '?'
    if (typeof identity.name !== 'string' || !identity.name.trim() || identity.name.length > 100 ||
        !Number.isInteger(identity.server) || identity.server < 1000 || identity.server > 9999) throw new Error('Invalid character')
    const key = `${identity.server}:${identity.name}`
    this.db.prepare('INSERT OR IGNORE INTO people VALUES (?, ?, ?)').run(key, identity.name, identity.server)
    return key
  }
  increment(person, amount) {
    this.db.prepare(`INSERT INTO totals VALUES (?, ?)
      ON CONFLICT(person) DO UPDATE SET amount = amount + excluded.amount`).run(person, amount)
  }
  apply(event) {
    return this.transaction(() => {
      if (event.kind === 'gain') {
        if (!Number.isSafeInteger(event.amount) || event.amount <= 0 || !Number.isSafeInteger(event.at)) throw new Error('Invalid income')
        const person = this.person(event.identity)
        const result = this.db.prepare('INSERT OR IGNORE INTO gains VALUES (?, ?, ?, ?, ?)')
          .run(event.id, event.epoch, person, event.at, event.amount)
        if (result.changes) this.increment(person, event.amount)
      } else if (event.kind === 'assign') {
        const person = this.person(event.identity)
        const { amount } = this.db.prepare("SELECT coalesce(sum(amount),0) amount FROM gains WHERE epoch=? AND person='?'").get(event.epoch)
        if (amount) {
          this.db.prepare("UPDATE gains SET person=? WHERE epoch=? AND person='?'").run(person, event.epoch)
          this.db.prepare("UPDATE totals SET amount=amount-? WHERE person='?'").run(amount)
          this.increment(person, amount)
        }
      } else throw new Error('Unknown ledger operation')
    })
  }
  snapshot(now) {
    const rows = this.db.prepare(`SELECT p.key, p.name, p.server, coalesce(t.amount,0) total,
      coalesce((SELECT sum(g.amount) FROM gains g WHERE g.person=p.key AND g.at>? AND g.at<=?),0) days7,
      coalesce((SELECT sum(g.amount) FROM gains g WHERE g.person=p.key AND g.at>? AND g.at<=?),0) days30
      FROM people p LEFT JOIN totals t ON t.person=p.key WHERE coalesce(t.amount,0)>0 ORDER BY total DESC, p.key`)
      .all(now - 7 * DAY, now, now - 30 * DAY, now)
    return { startedAt: Number(this.db.prepare('SELECT value FROM meta WHERE key=?').get('startedAt').value), rows,
      totals: rows.reduce((all, r) => ({ total: all.total + r.total, days7: all.days7 + r.days7, days30: all.days30 + r.days30 }), { total: 0, days7: 0, days30: 0 }) }
  }
  prune(now) { this.db.prepare('DELETE FROM gains WHERE at < ?').run(now - 31 * DAY) }
  close() { this.db.close() }
}
module.exports = { Ledger, DAY }
