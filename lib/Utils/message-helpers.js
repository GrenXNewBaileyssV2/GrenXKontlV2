/**
 * Helpers kirim semua tipe pesan umum
 * sock = hasil makeWASocket(...)
 */

export function createMessageHelpers(sock) {
  const send = (jid, content, opts = {}) => sock.sendMessage(jid, content, opts)

  return {
    // Text
    sendText: (jid, text, opts) => send(jid, { text }, opts),

    // Media
    sendImage: (jid, image, caption = '', opts) =>
      send(jid, { image, caption }, opts),
    sendVideo: (jid, video, caption = '', opts) =>
      send(jid, { video, caption }, opts),
    sendAudio: (jid, audio, opts = {}) =>
      send(jid, { audio, mimetype: opts.mimetype || 'audio/mp4', ptt: !!opts.ptt }, opts),
    sendDocument: (jid, document, fileName, mimetype, opts) =>
      send(jid, { document, fileName, mimetype }, opts),
    sendSticker: (jid, sticker, opts) => send(jid, { sticker }, opts),

    // Lokasi / kontak
    sendLocation: (jid, degreesLatitude, degreesLongitude, opts) =>
      send(jid, { location: { degreesLatitude, degreesLongitude } }, opts),
    sendContact: (jid, contacts, opts) =>
      send(jid, { contacts: { displayName: contacts[0]?.fullName || 'Contact', contacts } }, opts),

    // Reaction / delete
    sendReaction: (jid, key, text) => send(jid, { react: { text, key } }),
    deleteMessage: (jid, key) => send(jid, { delete: key }),

    // View once
    sendViewOnceImage: (jid, image, caption = '', opts) =>
      send(jid, { image, caption, viewOnce: true }, opts),
    sendViewOnceVideo: (jid, video, caption = '', opts) =>
      send(jid, { video, caption, viewOnce: true }, opts),

    // Poll
    sendPoll: (jid, name, values, selectableCount = 1, opts) =>
      send(jid, { poll: { name, values, selectableCount } }, opts),

    // Button modern (native flow) — GrenX / WA terbaru
    sendQuickReplyButtons: (jid, text, buttons, opts = {}) =>
      send(jid, {
        text,
        footer: opts.footer,
        interactiveButtons: buttons.map(b => ({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({ display_text: b.displayText, id: b.id })
        }))
      }, opts),

    sendUrlButton: (jid, text, buttons, opts = {}) =>
      send(jid, {
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
      }, opts),

    sendCopyButton: (jid, text, copyCode, displayText = 'Salin', opts = {}) =>
      send(jid, {
        text,
        footer: opts.footer,
        interactiveButtons: [{
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: copyCode })
        }]
      }, opts),

    sendCallButton: (jid, text, phoneNumber, displayText = 'Telepon', opts = {}) =>
      send(jid, {
        text,
        footer: opts.footer,
        interactiveButtons: [{
          name: 'cta_call',
          buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: phoneNumber })
        }]
      }, opts),

    sendMixedButtons: (jid, text, buttons, opts = {}) => {
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
          buttonParamsJson: JSON.stringify({ display_text: b.displayText, copy_code: b.copyCode })
        }),
        call: b => ({
          name: 'cta_call',
          buttonParamsJson: JSON.stringify({ display_text: b.displayText, phone_number: b.phoneNumber })
        })
      }
      return send(jid, {
        text,
        footer: opts.footer,
        interactiveButtons: buttons.map(b => map[b.type]?.(b)).filter(Boolean)
      }, opts)
    },

    sendListButton: (jid, content, opts) =>
      send(jid, {
        text: content.text || content.description || '',
        footer: content.footer,
        title: content.title,
        buttonText: content.buttonText || 'Pilih',
        sections: content.sections
      }, opts),

    // Rich (butuh message-composer sudah di-export dari package)
    sendTable: async (jid, title, headers, rows, opts = {}) => {
      const { generateTableContent } = await import('@whiskeysockets/baileys')
      if (!generateTableContent) throw new Error('generateTableContent tidak ada di package')
      const { message, messageId } = generateTableContent(title, headers, rows, opts.quoted, opts)
      return sock.relayMessage(jid, message, { messageId })
    },

    sendCodeBlock: async (jid, code, opts = {}) => {
      const { generateCodeBlockContent } = await import('@whiskeysockets/baileys')
      if (!generateCodeBlockContent) throw new Error('generateCodeBlockContent tidak ada')
      const { message, messageId } = generateCodeBlockContent(code, opts.quoted, opts)
      return sock.relayMessage(jid, message, { messageId })
    },

    sendRichHtml: async (jid, html, opts = {}) => {
      const mod = await import('@whiskeysockets/baileys')
      if (typeof mod.sendRichHtml === 'function') {
        return mod.sendRichHtml(sock, jid, { html, ...opts }, opts.quoted)
      }
      throw new Error('sendRichHtml tidak ada di package')
    }
  }
}
