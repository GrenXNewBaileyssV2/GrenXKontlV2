// test/anti-crash.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AntiCrash,
  computeCrashLevel,
  buildCrashPayload,
  renderCrashPanel,
  wrapHandler
} from '../lib/Utils/anti-crash.js'

test('computeCrashLevel naik sesuai jumlah error', () => {
  const now = Date.now()
  assert.equal(computeCrashLevel(0, null), 'safe')
  assert.equal(computeCrashLevel(1, now), 'warning')
  assert.equal(computeCrashLevel(3, now), 'danger')
  assert.equal(computeCrashLevel(5, now), 'critical')
})

test('computeCrashLevel reset saat di luar window', () => {
  const old = Date.now() - 120_000
  assert.equal(computeCrashLevel(5, old, 60_000), 'safe')
})

test('buildCrashPayload menghasilkan payload valid', () => {
  const p = buildCrashPayload('uncaughtException', new Error('boom'), 'critical', true)
  assert.equal(p.crash, true)
  assert.equal(p.level, 'critical')
  assert.equal(p.fatal, true)
  assert.ok(p.message.includes('Anti-Crash'))
})

test('AntiCrash.handle memanggil onCrash', () => {
  let fired = null
  const guard = new AntiCrash('test-bot', {
    exitOnCritical: false,
    onCrash: (p) => { fired = p }
  })
  guard.handle('test', new Error('x'))
  assert.ok(fired)
  assert.equal(fired.crash, true)
  assert.equal(guard.getState().errors, 1)
})

test('renderCrashPanel menampilkan level', () => {
  const panel = renderCrashPanel(
    { errors: 3, lastErrorAt: Date.now(), lastType: 'test', lastErrorMessage: 'x', level: 'danger', shuttingDown: false },
    'bot'
  )
  assert.ok(panel.includes('ANTI-CRASH'))
  assert.ok(panel.includes('BAHAYA'))
})

test('wrapHandler menangkap error tanpa throw', async () => {
  const guard = new AntiCrash('test-bot', { exitOnCritical: false })
  const wrapped = wrapHandler(guard, 'boom', () => { throw new Error('boom') })
  const result = await wrapped()
  assert.equal(result, undefined)
  assert.equal(guard.getState().errors, 1)
})
