import assert from 'node:assert/strict'
import test from 'node:test'
import { kinaBalance, kinaPerHour, kinaRebase, kinaReset, NO_KINA } from '../src/shared/kina.ts'

test('interleaved currencies keep their balances, earnings and rates separate', () => {
  let session = kinaBalance(NO_KINA, 1000, 0)
  session = kinaBalance(session, 9000, 0, 'bound')
  session = kinaBalance(session, 1100, 60_000)
  session = kinaBalance(session, 9500, 60_000, 'bound')
  session = kinaBalance(session, 900, 90_000) // spending is not negative farm income
  session = kinaBalance(session, 9400, 90_000, 'bound')
  session = kinaBalance(session, 950, 120_000)
  session = kinaBalance(session, 9600, 120_000, 'bound')
  assert.equal(session.earned, 150)
  assert.equal(session.bound?.earned, 700)
  assert.equal(kinaPerHour(session, 120_000), 4500)
  assert.equal(kinaPerHour(session.bound!, 120_000), 21000)
})

test('old restart data acquires a bound baseline without counting its existing balance', () => {
  const old = { balance: 100, earned: 50, activeMs: 60_000, lastAt: 60_000, gains: [[60_000, 50] as [number, number]] }
  const session = kinaBalance(old, 900_000, 70_000, 'bound')
  assert.equal(session.earned, 50)
  assert.equal(session.bound?.earned, 0)
  assert.equal(kinaPerHour(session.bound!, 70_000), null)
})

test('character switches and reset apply to both currencies', () => {
  let session = kinaBalance(NO_KINA, 100, 0)
  session = kinaBalance(session, 1000, 0, 'bound')
  session = kinaBalance(session, 200, 60_000)
  session = kinaBalance(session, 1200, 60_000, 'bound')
  session = kinaRebase(JSON.parse(JSON.stringify(session)))
  assert.equal(session.balance, null)
  assert.equal(session.bound?.balance, null)
  session = kinaBalance(session, 1_000_000, 70_000)
  session = kinaBalance(session, 2_000_000, 70_000, 'bound')
  assert.equal(session.earned, 100)
  assert.equal(session.bound?.earned, 200)
  session = kinaReset(session)
  assert.equal(session.balance, 1_000_000)
  assert.equal(session.bound?.balance, 2_000_000)
  assert.equal(session.earned, 0)
  assert.equal(session.bound?.earned, 0)
  assert.deepEqual(session.gains, [])
  assert.deepEqual(session.bound?.gains, [])
})

test('invalid network balances do not change a session', () => {
  for (const balance of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(kinaBalance(NO_KINA, balance, 0, 'bound'), NO_KINA)
  }
})
