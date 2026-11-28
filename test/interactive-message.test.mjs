import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateNativeFlowMessage,
  generateQuickReplyButtons,
  generateUrlButtonMessage,
  generateCopyCodeButton,
  generateCallButton,
  generateCombinedButtons,
  generateInteractiveListMessage
} from '../lib/Utils/interactive-message.js'

const params = payload => JSON.parse(payload.interactiveMessage.nativeFlowMessage.buttons[0].buttonParamsJson)

test('quick reply membuat native-flow payload valid', () => {
  const payload = generateQuickReplyButtons('Pilih menu', [{ id: 'menu_help', displayText: 'Bantuan' }], { footer: 'GrenX' })
  assert.equal(payload.interactiveMessage.body.text, 'Pilih menu')
  assert.deepEqual(params(payload), { display_text: 'Bantuan', id: 'menu_help' })
})

test('URL button hanya menerima URL http/https', () => {
  const payload = generateUrlButtonMessage('Kunjungi', [{ displayText: 'Website', url: 'https://example.com' }])
  assert.equal(params(payload).url, 'https://example.com')
  assert.throws(() => generateUrlButtonMessage('Kunjungi', [{ displayText: 'Bad', url: 'javascript:alert(1)' }]), /URL http\/https/)
})

test('copy dan combined buttons membangun tipe yang tepat', () => {
  assert.equal(params(generateCopyCodeButton('Salin kode', 'ABC123')).copy_code, 'ABC123')
  assert.equal(params(generateCallButton('Telepon admin', '+6281234567890')).phone_number, '+6281234567890')
  assert.throws(() => generateCallButton('Telepon', 'invalid'), /nomor telepon/)
  const combined = generateCombinedButtons('Aksi', [{ type: 'reply', displayText: 'Ya', id: 'yes' }])
  assert.equal(combined.interactiveMessage.nativeFlowMessage.buttons[0].name, 'quick_reply')
})

test('native flow menolak tombol invalid dan jumlah di atas tiga', () => {
  assert.throws(() => generateNativeFlowMessage('Halo', []), /buttons/)
  assert.throws(() => generateNativeFlowMessage('Halo', Array.from({ length: 4 }, () => ({ name: 'quick_reply', buttonParamsJson: '{}' }))), /buttons/)
})

test('list helper menormalisasi row dan menolak list kosong', () => {
  const payload = generateInteractiveListMessage({ title: 'Menu', buttonText: 'Buka', sections: [{ title: 'Utama', rows: [{ rowId: 'home', title: 'Beranda' }] }] })
  assert.equal(payload.listMessage.sections[0].rows[0].rowId, 'home')
  assert.throws(() => generateInteractiveListMessage({ title: 'Menu', buttonText: 'Buka', sections: [] }), /sections/)
})
