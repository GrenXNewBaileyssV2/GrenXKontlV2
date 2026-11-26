/**
 * bot-compat.js — satu module lengkap untuk GrenX / Baileys fork
 * Export nama yang biasa di-require bot lama
 *
 * Path: lib/Utils/bot-compat.js
 * Lalu di lib/Utils/index.js:
 *   export * from './bot-compat.js'
 */

// ── Optional: message-composer (rich table/code/latex/html) ───────────────────
let generateTableContent
let generateListContent
let generateCodeBlockContent
let generateLatexContent
let generateLatexImageContent
let generateLatexInlineImageContent
let generateMarkdownContent
let generateRichHtmlContent
let generateRichMessageContent
let captureUnifiedResponse
let generateUnifiedResponseContent
let sendRichHtmlCore

try {
  const mc = await import('./message-composer.js').catch(() => null)
  // NOTE: dynamic import di dalam async init — hindari top-level await
} catch {}

/** Load message-composer sekali (lazy, tanpa top-level await) */
async function loadComposer() {
  if (generateTableContent !== undefined) return
  try {
    const mc = await import('./message-composer.js')
    generateTableContent = mc.generateTableContent
    generateListContent = mc.generateListContent
    generateCodeBlockContent = mc.generateCodeBlockContent
    generateLatexContent = mc.generateLatexContent
    generateLatexImageContent = mc.generateLatexImageContent
    generateLatexInlineImageContent = mc.generateLatexInlineImageContent
    generateMarkdownContent = mc.generateMarkdownContent
    generateRichHtmlContent = mc.generateRichHtmlContent
    generateRichMessageContent = mc.generateRichMessageContent
    captureUnifiedResponse = mc.captureUnifiedResponse
    generateUnifiedResponseContent = mc.generateUnifiedResponseContent
    sendRichHtmlCore = mc.sendRichHtml
  } catch {
    generateTableContent = null
    generateListContent = null
    generateCodeBlockContent = null
    generateLatexContent = null
    generateLatexImageContent = null
    generateLatexInlineImageContent = null
    generateMarkdownContent = null
    generateRichHtmlContent = null
    generateRichMessageContent = null
    captureUnifiedResponse = null
    generateUnifiedResponseContent = null
    sendRichHtmlCore = null
  }
}

// ── Auto Reply ───────────────────────────────────────────────────────────────

export class AutoReplyHandler {
  constructor(sendMessage, sendPresence, options = {}) {
    this.rules = new Map()
    this.cooldowns = new Map()
    this.globalCooldown = new Map()
    this.sendMessage = sendMessage
    this.sendPresence = sendPresence
    this.options = {
      globalCooldown: options.globalCooldown ?? 1000,
      simulateTyping: options.simulateTyping ?? false,
      typingDuration: options.typingDuration ?? 1000,
      multiMatch: options.multiMatch ?? false,
      onReply: options.onReply ?? (() => {}),
      onError: options.onError ?? (() => {})
    }
  }

  generateId() {
    return `ar_\( {Date.now()}_ \){Math.random().toString(36).slice(2, 9)}`
  }

  addRule(rule) {
    const fullRule = {
      ...rule,
      id: rule.id ?? this.generateId(),
      active: rule.active ?? true,
      priority: rule.priority ?? 0
    }
    if (!fullRule.keywords && !fullRule.pattern && !fullRule.exactMatch) {
      throw new Error('Rule must have keywords, pattern, or exactMatch')
    }
    this.rules.set(fullRule.id, fullRule)
    return fullRule
  }

  removeRule(id) {
    return this.rules.delete(id)
  }

  getRules() {
    return Array.from(this.rules.values())
  }

  getRule(id) {
    return this.rules.get(id)
  }

  setRuleActive(id, active) {
    const rule = this.rules.get(id)
    if (!rule) return false
    rule.active = active
    return true
  }

  clearRules() {
    this.rules.clear()
  }

  checkCooldown(ruleId, jid) {
    const last = this.cooldowns.get(`\( {ruleId}: \){jid}`) ?? 0
    return Date.now() > last
  }

  checkGlobalCooldown(jid) {
    const last = this.globalCooldown.get(jid) ?? 0
    return Date.now() - last > this.options.globalCooldown
  }

  setCooldown(ruleId, jid, cooldown) {
    this.cooldowns.set(`\( {ruleId}: \){jid}`, Date.now() + cooldown)
    this.globalCooldown.set(jid, Date.now())
  }

  matchRule(text, rule) {
    if (!rule.active) return null
    if (rule.exactMatch && text.toLowerCase() === rule.exactMatch.toLowerCase()) {
      return [text]
    }
    if (rule.keywords?.length) {
      const lower = text.toLowerCase()
      for (const kw of rule.keywords) {
        if (lower.includes(kw.toLowerCase())) return [kw]
      }
    }
    if (rule.pattern) return text.match(rule.pattern)
    return null
  }

  isJidAllowed(jid, rule) {
    const isGroup = jid.endsWith('@g.us')
    if (jid.endsWith('@newsletter')) return false
    if (rule.groupsOnly && !isGroup) return false
    if (rule.privateOnly && isGroup) return false
    if (rule.allowedJids?.length && !rule.allowedJids.includes(jid)) return false
    if (rule.blockedJids?.includes(jid)) return false
    return true
  }

  async processMessage(message) {
    const content = message.message
    if (!content) return false
    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      ''
    if (!text) return false
    const jid = message.key?.remoteJid
    if (!jid || !this.checkGlobalCooldown(jid)) return false

    const sorted = Array.from(this.rules.values())
      .filter(r => r.active)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    let matched = false
    for (const rule of sorted) {
      if (!this.isJidAllowed(jid, rule)) continue
      if (rule.cooldown && !this.checkCooldown(rule.id, jid)) continue
      const match = this.matchRule(text, rule)
      if (!match) continue
      try {
        const response =
          typeof rule.response === 'function'
            ? await rule.response(message, match)
            : rule.response
        if (this.options.simulateTyping && this.sendPresence) {
          await this.sendPresence(jid, 'composing')
          await new Promise(r => setTimeout(r, this.options.typingDuration))
          await this.sendPresence(jid, 'paused')
        }
        await this.sendMessage(jid, response, rule.quoted ? { quoted: message } : undefined)
        if (rule.cooldown) this.setCooldown(rule.id, jid, rule.cooldown)
        this.options.onReply(rule, message, response)
        matched = true
        if (!this.options.multiMatch) break
      } catch (err) {
        this.options.onError(err, rule, message)
      }
    }
    return matched
  }
}

export const createAutoReply = (sendMessage, sendPresence, options) =>
  new AutoReplyHandler(sendMessage, sendPresence, options)

// ── Message helpers (semua tipe pesan umum) ──────────────────────────────────

export function createMessageHelpers(sock) {
  const send = (jid, content, opts = {}) => sock.sendMessage(jid, content, opts)

  return {
    sendText: (jid, text, opts) => send(jid, { text }, opts),
    sendImage: (jid, image, caption = '', opts) => send(jid, { image, caption }, opts),
    sendVideo: (jid, video, caption = '', opts) => send(jid, { video, caption }, opts),
    sendAudio: (jid, audio, opts = {}) =>
      send(jid, { audio, mimetype: opts.mimetype || 'audio/mp4', ptt: !!opts.ptt }, opts),
    sendDocument: (jid, document, fileName, mimetype, opts) =>
      send(jid, { document, fileName, mimetype }, opts),
    sendSticker: (jid, sticker, opts) => send(jid, { sticker }, opts),
    sendLocation: (jid, degreesLatitude, degreesLongitude, opts) =>
      send(jid, { location: { degreesLatitude, degreesLongitude } }, opts),
    sendContact: (jid, contacts, opts) =>
      send(jid, {
        contacts: {
          displayName: contacts[0]?.fullName || contacts[0]?.displayName || 'Contact',
          contacts
        }
      }, opts),
    sendReaction: (jid, key, text) => send(jid, { react: { text, key } }),
    deleteMessage: (jid, key) => send(jid, { delete: key }),
    sendViewOnceImage: (jid, image, caption = '', opts) =>
      send(jid, { image, caption, viewOnce: true }, opts),
    sendViewOnceVideo: (jid, video, caption = '', opts) =>
      send(jid, { video, caption, viewOnce: true }, opts),
    sendPoll: (jid, name, values, selectableCount = 1, opts) =>
      send(jid, { poll: { name, values, selectableCount } }, opts),

    sendQuickReplyButtons: (jid, text, buttons, opts = {}) =>
      sendQuickReplyButtons(sock, jid, text, buttons, opts),
    sendUrlButton: (jid, text, buttons, opts = {}) =>
      sendUrlButton(sock, jid, text, buttons, opts),
    sendCopyButton: (jid, text, copyCode, displayText, opts = {}) =>
      sendCopyButton(sock, jid, text, copyCode, displayText, opts),
    sendCallButton: (jid, text, phoneNumber, displayText, opts = {}) =>
      sendCallButton(sock, jid, text, phoneNumber, displayText, opts),
    sendMixedButtons: (jid, text, buttons, opts = {}) =>
      sendMixedButtons(sock, jid, text, buttons, opts),
    sendListButton: (jid, content, opts) => sendListButton(sock, jid, content, opts),

    sendTable: (jid, title, headers, rows, opts) =>
      sendTable(sock, jid, title, headers, rows, opts),
    sendCodeBlock: (jid, code, opts) => sendCodeBlock(sock, jid, code, opts),
    sendRichHtml: (jid, html, opts = {}) =>
      sendRichHtml(sock, jid, { html, ...opts }, opts.quoted)
  }
}

// ── Button / list (export langsung, argumen pertama = sock) ──────────────────

export const sendQuickReplyButtons = (sock, jid, text, buttons, opts = {}) =>
  sock.sendMessage(
    jid,
    {
      text,
      footer: opts.footer,
      interactiveButtons: buttons.map(b => ({
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: b.displayText,
          id: b.id
        })
      }))
    },
    opts
  )

export const sendUrlButton = (sock, jid, text, buttons, opts = {}) =>
  sock.sendMessage(
    jid,
    {
      text,
      footer: opts.footer,
      interactiveButtons: buttons.map(b => ({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: b.displayText,
          url: b.url,
          merchant_url: b.merchantUrl || b.url
        })
      }))
    },
    opts
  )

export const sendCopyButton = (
  sock,
  jid,
  text,
  copyCode,
  displayText = 'Salin',
  opts = {}
) =>
  sock.sendMessage(
    jid,
    {
      text,
      footer: opts.footer,
      interactiveButtons: [
        {
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({
            display_text: displayText,
            copy_code: copyCode
          })
        }
      ]
    },
    opts
  )

export const sendCallButton = (
  sock,
  jid,
  text,
  phoneNumber,
  displayText = 'Telepon',
  opts = {}
) =>
  sock.sendMessage(
    jid,
    {
      text,
      footer: opts.footer,
      interactiveButtons: [
        {
          name: 'cta_call',
          buttonParamsJson: JSON.stringify({
            display_text: displayText,
            phone_number: phoneNumber
          })
        }
      ]
    },
    opts
  )

export const sendMixedButtons = (sock, jid, text, buttons, opts = {}) => {
  const map = {
    reply: b => ({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: b.displayText, id: b.id })
    }),
    url: b => ({
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: b.displayText, url: b.url })
    }),
    copy: b => ({
      name: 'cta_copy',
      buttonParamsJson: JSON.stringify({
        display_text: b.displayText,
        copy_code: b.copyCode
      })
    }),
    call: b => ({
      name: 'cta_call',
      buttonParamsJson: JSON.stringify({
        display_text: b.displayText,
        phone_number: b.phoneNumber
      })
    })
  }
  return sock.sendMessage(
    jid,
    {
      text,
      footer: opts.footer,
      interactiveButtons: buttons.map(b => map[b.type]?.(b)).filter(Boolean)
    },
    opts
  )
}

export const sendListButton = (sock, jid, content, opts = {}) =>
  sock.sendMessage(
    jid,
    {
      text: content.text || content.description || '',
      footer: content.footer,
      title: content.title,
      buttonText: content.buttonText || 'Pilih',
      sections: content.sections
    },
    opts
  )

export const sendInteractiveMessage = (sock, jid, content, opts = {}) =>
  sock.sendMessage(jid, content, opts)

export const sendReminderButton = (sock, jid, text, buttons, opts = {}) =>
  sendQuickReplyButtons(sock, jid, text, buttons, opts)

export const sendLinkPreview = (sock, jid, text, opts = {}) =>
  sock.sendMessage(jid, { text, linkPreview: opts.linkPreview ?? null }, opts)

export const sendAlbumMessage = (sock, jid, albums, opts = {}) =>
  sock.sendMessage(jid, { album: albums }, opts)

// ── Rich (lazy load message-composer) ────────────────────────────────────────

export const sendTable = async (sock, jid, title, headers, rows, opts = {}) => {
  await loadComposer()
  if (!generateTableContent) throw new Error('generateTableContent tidak tersedia')
  const { message, messageId } = generateTableContent(
    title,
    headers,
    rows,
    opts.quoted,
    opts
  )
  return sock.relayMessage(jid, message, { messageId })
}

export const sendList = async (sock, jid, title, items, opts = {}) => {
  await loadComposer()
  if (!generateListContent) throw new Error('generateListContent tidak tersedia')
  const { message, messageId } = generateListContent(title, items, opts.quoted, opts)
  return sock.relayMessage(jid, message, { messageId })
}

export const sendCodeBlock = async (sock, jid, code, opts = {}) => {
  await loadComposer()
  if (!generateCodeBlockContent) throw new Error('generateCodeBlockContent tidak tersedia')
  const { message, messageId } = generateCodeBlockContent(code, opts.quoted, opts)
  return sock.relayMessage(jid, message, { messageId })
}

export const sendLatex = async (sock, jid, options = {}, quoted) => {
  await loadComposer()
  if (!generateLatexContent) throw new Error('generateLatexContent tidak tersedia')
  const { message, messageId } = generateLatexContent(quoted, options)
  return sock.relayMessage(jid, message, { messageId })
}

export const sendLatexImage = async (sock, jid, options, uploadFn, renderFn, quoted) => {
  await loadComposer()
  if (!generateLatexImageContent) throw new Error('generateLatexImageContent tidak tersedia')
  const { message, messageId } = await generateLatexImageContent(
    quoted,
    options,
    uploadFn,
    renderFn
  )
  return sock.relayMessage(jid, message, { messageId })
}

export const sendLatexInlineImage = async (
  sock,
  jid,
  options,
  uploadFn,
  renderFn,
  quoted
) => {
  await loadComposer()
  if (!generateLatexInlineImageContent) {
    throw new Error('generateLatexInlineImageContent tidak tersedia')
  }
  const { message, messageId } = await generateLatexInlineImageContent(
    quoted,
    options,
    uploadFn,
    renderFn
  )
  return sock.relayMessage(jid, message, { messageId })
}

export const sendRichMessage = async (sock, jid, submessages, opts = {}) => {
  await loadComposer()
  if (!generateRichMessageContent) throw new Error('generateRichMessageContent tidak tersedia')
  const { message, messageId } = generateRichMessageContent(
    submessages,
    opts.quoted,
    opts
  )
  return sock.relayMessage(jid, message, { messageId })
}

export const sendRichResponse = sendRichMessage

export const sendUnifiedResponse = async (sock, jid, captured, quoted) => {
  await loadComposer()
  if (!generateUnifiedResponseContent) {
    throw new Error('generateUnifiedResponseContent tidak tersedia')
  }
  const { message, messageId } = generateUnifiedResponseContent(quoted, captured)
  return sock.relayMessage(jid, message, { messageId })
}

export const sendRichHtml = async (sock, jid, opts, quoted, relayOptions) => {
  await loadComposer()
  if (!sendRichHtmlCore) throw new Error('sendRichHtml tidak tersedia')
  return sendRichHtmlCore(sock, jid, opts, quoted, relayOptions)
}

export const captureUnifiedResponseFn = async (msg) => {
  await loadComposer()
  return captureUnifiedResponse ? captureUnifiedResponse(msg) : null
}

// alias nama yang sering di-destructure
export { captureUnifiedResponseFn as captureUnifiedResponse }

export default {
  AutoReplyHandler,
  createAutoReply,
  createMessageHelpers,
  sendQuickReplyButtons,
  sendUrlButton,
  sendCopyButton,
  sendCallButton,
  sendMixedButtons,
  sendListButton,
  sendInteractiveMessage,
  sendReminderButton,
  sendLinkPreview,
  sendAlbumMessage,
  sendTable,
  sendList,
  sendCodeBlock,
  sendLatex,
  sendLatexImage,
  sendLatexInlineImage,
  sendRichMessage,
  sendRichResponse,
  sendUnifiedResponse,
  sendRichHtml,
  captureUnifiedResponse: captureUnifiedResponseFn
}
