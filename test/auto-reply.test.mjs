import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoReply, createSocketAutoReply, attachSocketAutoReply } from '../lib/Utils/auto-reply.js'

const msg = (text, jid = '628123@s.whatsapp.net') => ({
  key: { remoteJid: jid },
  message: { conversation: text }
})

test('auto reply generates interpolated unique IDs and matches keywords', async () => {
  const sent = []
  const handler = createAutoReply(async (...args) => sent.push(args))
  const rule = handler.addRule({ keywords: ['halo'], response: { text: 'Hai' } })
  assert.match(rule.id, /^ar_\d+_[a-z0-9]+$/)
  assert.equal(await handler.processMessage(msg('Halo semua')), true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0][1].text, 'Hai')
})

test('global cooldown is applied even when rule has no individual cooldown', async () => {
  let count = 0
  const handler = createAutoReply(async () => { count++ }, undefined, { globalCooldown: 60000 })
  handler.addRule({ exactMatch: 'ping', response: 'pong' })
  assert.equal(await handler.processMessage(msg('ping')), true)
  assert.equal(await handler.processMessage(msg('ping')), false)
  assert.equal(count, 1)
})

test('socket adapter delegates sendMessage and presence updates', async () => {
  const sent = []
  const presence = []
  const sock = {
    sendMessage: async (...args) => sent.push(args),
    sendPresenceUpdate: async (...args) => presence.push(args)
  }
  const handler = createSocketAutoReply(sock, { simulateTyping: true, typingDuration: 0 })
  handler.addRule({ exactMatch: 'hi', response: 'hello' })
  assert.equal(await handler.processMessage(msg('hi')), true)
  assert.equal(sent.length, 1)
  assert.deepEqual(presence, [['composing', '628123@s.whatsapp.net'], ['paused', '628123@s.whatsapp.net']])
})

test('attachSocketAutoReply binds and detaches messages.upsert listener', async () => {
  const listeners = new Map()
  const sent = []
  const sock = {
    sendMessage: async (...args) => sent.push(args),
    ev: {
      on: (event, fn) => listeners.set(event, fn),
      off: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event) }
    }
  }
  const { handler, detach } = attachSocketAutoReply(sock)
  handler.addRule({ exactMatch: 'hello', response: { text: 'world' } })
  listeners.get('messages.upsert')({ messages: [msg('hello')] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1)
  detach()
  assert.equal(listeners.has('messages.upsert'), false)
})
