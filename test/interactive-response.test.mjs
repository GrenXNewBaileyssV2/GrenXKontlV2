import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachInteractiveResponseHandler, extractInteractiveResponse } from '../lib/Utils/interactive-response.js'

test('extract native-flow response and parse params JSON', () => {
  const result = extractInteractiveResponse({ message: { viewOnceMessage: { message: { interactiveResponseMessage: { nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: JSON.stringify({ id: 'help', display_text: 'Help' }) } } } } } })
  assert.equal(result.type, 'native_flow')
  assert.equal(result.id, 'help')
  assert.equal(result.params.display_text, 'Help')
})

test('extract legacy button and list response', () => {
  assert.equal(extractInteractiveResponse({ message: { buttonsResponseMessage: { selectedButtonId: 'yes' } } }).id, 'yes')
  assert.equal(extractInteractiveResponse({ message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'settings' } } } }).id, 'settings')
})

test('listener processes identified responses and detaches idempotently', () => {
  const ev = new EventEmitter()
  const sock = { ev }
  const seen = []
  const detach = attachInteractiveResponseHandler(sock, response => seen.push(response.id))
  ev.emit('messages.upsert', { messages: [{ message: { interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"menu"}' } } } }] })
  detach(); detach()
  ev.emit('messages.upsert', { messages: [{ message: { buttonsResponseMessage: { selectedButtonId: 'ignored' } } }] })
  assert.deepEqual(seen, ['menu'])
})
