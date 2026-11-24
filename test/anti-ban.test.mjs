// test/anti-ban.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isBanSignal,
  isBanStatusCode,
  computeSafetyLevel,
  buildSenderBannedPayload,
  AntiBanSender,
  renderSafetyPanel
} from '../lib/Utils/anti-ban-sender.js'

test('isBanSignal mendeteksi keyword ban', () => {
  assert.equal(isBanSignal('your account is banned').hit, true)
  assert.equal(isBanSignal('restricted by server').hit, true)
  assert.equal(isBanSignal('spam detected').hit, true)
  assert.equal(isBanSignal('hello world').hit, false)
})

test('isBanStatusCode mendeteksi 401/403/429', () => {
  assert.equal(isBanStatusCode(401), true)
  assert.equal(isBanStatusCode(403), true)
  assert.equal(isBanStatusCode(429), true)
  assert.equal(isBanStatusCode(500), false)
  assert.equal(isBanStatusCode(undefined), false)
})

test('computeSafetyLevel naik sesuai pelanggaran', () => {
  const now = Date.now()
  assert.equal(computeSafetyLevel(0, null), 'safe')
  assert.equal(computeSafetyLevel(1, now), 'warning')
  assert.equal(computeSafetyLevel(2, now), 'danger')
  assert.equal(computeSafetyLevel(3, now), 'critical')
  assert.equal(computeSafetyLevel(5, now, true), 'critical')
})

test('buildSenderBannedPayload menghasilkan payload valid', () => {
  const p = buildSenderBannedPayload('banned', { x: 1 }, 'critical')
  assert.equal(p.senderBanned, true)
  assert.equal(p.level, 'critical')
  assert.ok(p.message.includes('Anti-Ban'))
  assert.ok(p.timestamp instanceof Date)
})

test('AntiBanSender memanggil endSocket & onBan saat terdeteksi', () => {
  let ended = false
  let fired = null
  const mgr = new AntiBanSender(
    '628xxx',
    () => { ended = true },
    { onBan: (p) => { fired = p } }
  )
  const payload = mgr.inspect('stream_error', { reason: 'account banned' })
  assert.ok(payload)
  assert.equal(ended, true)
  assert.equal(fired.senderBanned, true)
  assert.equal(mgr.getLevel(), 'critical')
})

test('renderSafetyPanel menampilkan level', () => {
  const panel = renderSafetyPanel(
    { violations: 2, lastViolationAt: Date.now(), lastReason: 'spam', level: 'danger', banned: false },
    '628xxx'
  )
  assert.ok(panel.includes('PANEL ANTI-BAN'))
  assert.ok(panel.includes('BAHAYA'))
})
