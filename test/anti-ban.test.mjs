import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  isWarningStatusCode,
  computeSafetyLevel,
  buildWarningPayload,
  AntiBanSender,
  attachAntiBan,
  renderSafetyPanel
} from '../lib/Utils/anti-ban-sender.js'

test('isWarningStatusCode mengenali status logout dan pembatasan', () => {
  assert.equal(isWarningStatusCode(401), true)
  assert.equal(isWarningStatusCode(403), true)
  assert.equal(isWarningStatusCode(429), true)
  assert.equal(isWarningStatusCode(500), false)
  assert.equal(isWarningStatusCode(undefined), false)
})

test('computeSafetyLevel menghitung level dan kedaluwarsa window', () => {
  const now = Date.now()
  assert.equal(computeSafetyLevel(0, null), 'safe')
  assert.equal(computeSafetyLevel(1, now), 'warning')
  assert.equal(computeSafetyLevel(2, now), 'danger')
  assert.equal(computeSafetyLevel(3, now), 'critical')
  assert.equal(computeSafetyLevel(3, now - 25 * 60 * 60 * 1000), 'safe')
})

test('buildWarningPayload membentuk payload warning yang valid', () => {
  const payload = buildWarningPayload('628123', 'warning')
  assert.equal(payload.senderWarning, true)
  assert.equal(payload.senderReleased, true)
  assert.equal(payload.level, 'warning')
  assert.ok(payload.message.includes('Anti-Ban'))
  assert.ok(payload.timestamp instanceof Date)
})

test('AntiBanSender melepas socket saat status warning terdeteksi', () => {
  let endedWith = null
  let warning = null
  const manager = new AntiBanSender('628123', reason => { endedWith = reason }, {
    onWarning: payload => { warning = payload }
  })
  const payload = manager.inspect('connection_close', {}, 401)
  assert.ok(payload)
  assert.equal(endedWith, 'warning_release')
  assert.equal(warning.senderWarning, true)
  assert.equal(manager.isReleased(), true)
  assert.equal(manager.getLevel(), 'warning')
  assert.equal(manager.inspect('connection_close', {}, 403), null)
})

test('renderSafetyPanel menampilkan status dan sender', () => {
  const panel = renderSafetyPanel({
    warnings: 2,
    lastWarningAt: Date.now(),
    lastReason: 'risiko_keband',
    lastMessage: 'warning test',
    level: 'danger',
    released: false
  }, '628123')
  assert.ok(panel.includes('PANEL ANTI-BAN'))
  assert.ok(panel.includes('BAHAYA'))
  assert.ok(panel.includes('628123'))
})


test('attachAntiBan membaca CB:failure dan menyediakan detach idempoten', () => {
  const ev = new EventEmitter()
  let ended = false
  const sock = { ev, end: () => { ended = true } }
  const manager = attachAntiBan(sock, '628123')
  ev.emit('CB:failure', { attrs: { code: '429' } })
  assert.equal(ended, true)
  assert.equal(manager.isReleased(), true)
  manager.detach()
  manager.detach()
  assert.equal(ev.listenerCount('connection.update'), 0)
  assert.equal(ev.listenerCount('CB:failure'), 0)
})
