// test/rich.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateMarkdownContent,
  extractIE
} from '../lib/Utils/rich-message-utils.js'

test('generateMarkdownContent menghasilkan payload GenAI', () => {
  const payload = generateMarkdownContent({ markdown: '# Halo' })
  assert.equal(payload.__typename, 'GenAIMarkdownTextUXPrimitive')
  assert.equal(payload.markdown, '# Halo')
})

test('generateMarkdownContent menolak input kosong', () => {
  assert.throws(() => generateMarkdownContent({ markdown: '' }))
})

test('extractIE mengembalikan null untuk message kosong', () => {
  assert.equal(extractIE(null), null)
})
