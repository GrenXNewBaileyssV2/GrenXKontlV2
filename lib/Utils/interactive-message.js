const requireText = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} wajib berupa string non-empty`)
  return value.trim()
}

const requireArray = (value, label, { min = 1, max = 3 } = {}) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new RangeError(`${label} harus berupa array dengan ${min}-${max} item`)
  }
  return value
}

const jsonButton = (name, params) => ({ name, buttonParamsJson: JSON.stringify(params) })

export const generateInteractiveButtonMessage = async (content, options) => {
  const { proto } = await import('../../WAProto/index.js')
  const buttons = content.buttons.map((btn, idx) => ({
    buttonId: btn.buttonId || `btn-${idx}`,
    buttonText: { displayText: btn.displayText },
    type: proto.Message.ButtonsMessage.Button.Type.RESPONSE
  }))

  const buttonsMessage = {
    contentText: content.body,
    footerText: content.footer,
    buttons,
    headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY
  }

  if (content.headerImage && options) {
    const { prepareWAMessageMedia } = await import('./messages.js')
    const media = await prepareWAMessageMedia({ image: content.headerImage }, options)
    buttonsMessage.imageMessage = media.imageMessage
    buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.IMAGE
  } else if (content.headerVideo && options) {
    const { prepareWAMessageMedia } = await import('./messages.js')
    const media = await prepareWAMessageMedia({ video: content.headerVideo }, options)
    buttonsMessage.videoMessage = media.videoMessage
    buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.VIDEO
  } else if (content.headerDocument && options) {
    const { prepareWAMessageMedia } = await import('./messages.js')
    const media = await prepareWAMessageMedia({
      document: content.headerDocument,
      mimetype: 'application/pdf',
      fileName: content.headerDocument.filename
    }, options)
    buttonsMessage.documentMessage = media.documentMessage
    buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.DOCUMENT
  } else if (content.title) {
    buttonsMessage.text = content.title
    buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.TEXT
  }

  return { buttonsMessage }
}

export const generateInteractiveListMessage = (content) => {
  if (!content || typeof content !== 'object') throw new TypeError('content wajib berupa object')
  requireText(content.title, 'title')
  requireText(content.buttonText, 'buttonText')
  requireArray(content.sections, 'sections', { min: 1, max: 10 })
  const sections = content.sections.map((section, sectionIndex) => ({
    title: section.title,
    rows: requireArray(section.rows, `sections[${sectionIndex}].rows`, { min: 1, max: 10 }).map((row, rowIndex) => ({
      rowId: requireText(row.rowId, `sections[${sectionIndex}].rows[${rowIndex}].rowId`),
      title: requireText(row.title, `sections[${sectionIndex}].rows[${rowIndex}].title`),
      description: row.description || ''
    }))
  }))

  return {
    listMessage: {
      title: content.title,
      description: content.description || '',
      buttonText: content.buttonText,
      footerText: content.footer || '',
      listType: 1,
      sections
    }
  }
}

export const generateTemplateMessage = async (content, options) => {
  const hydratedButtons = content.buttons.map((btn) => {
    const hydratedBtn = { index: btn.index }

    if (btn.quickReplyButton) {
      hydratedBtn.quickReplyButton = {
        displayText: btn.quickReplyButton.displayText,
        id: btn.quickReplyButton.id
      }
    } else if (btn.urlButton) {
      hydratedBtn.urlButton = {
        displayText: btn.urlButton.displayText,
        url: btn.urlButton.url
      }
    } else if (btn.callButton) {
      hydratedBtn.callButton = {
        displayText: btn.callButton.displayText,
        phoneNumber: btn.callButton.phoneNumber
      }
    }

    return hydratedBtn
  })

  const hydratedTemplate = {
    hydratedContentText: content.body,
    hydratedFooterText: content.footer,
    hydratedButtons
  }

  if (content.title) {
    hydratedTemplate.hydratedTitleText = content.title
  }

  if (content.headerImage && options) {
    const { prepareWAMessageMedia } = await import('./messages.js')
    const media = await prepareWAMessageMedia({ image: content.headerImage }, options)
    hydratedTemplate.imageMessage = media.imageMessage
  } else if (content.headerVideo && options) {
    const { prepareWAMessageMedia } = await import('./messages.js')
    const media = await prepareWAMessageMedia({ video: content.headerVideo }, options)
    hydratedTemplate.videoMessage = media.videoMessage
  } else if (content.headerLocation) {
    hydratedTemplate.locationMessage = {
      degreesLatitude: content.headerLocation.latitude,
      degreesLongitude: content.headerLocation.longitude,
      name: content.headerLocation.name,
      address: content.headerLocation.address
    }
  }

  return {
    templateMessage: {
      hydratedTemplate
    }
  }
}

export const generateNativeFlowMessage = (body, buttons, options = {}) => {
  requireText(body, 'body')
  requireArray(buttons, 'buttons', { min: 1, max: 3 })
  const normalizedButtons = buttons.map((button, index) => {
    if (!button || typeof button.name !== 'string' || !button.name.trim()) {
      throw new TypeError(`buttons[${index}].name wajib diisi`)
    }
    let params = button.buttonParamsJson
    if (typeof params === 'string') {
      try { params = JSON.parse(params) } catch { throw new TypeError(`buttons[${index}].buttonParamsJson bukan JSON valid`) }
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new TypeError(`buttons[${index}].buttonParamsJson harus berupa object/JSON object`)
    }
    return jsonButton(button.name.trim(), params)
  })
  return {
    interactiveMessage: {
      body: { text: body },
      ...(options.footer ? { footer: { text: requireText(options.footer, 'footer') } } : {}),
      ...(options.header ? { header: { title: options.header.title || '', subtitle: options.header.subtitle || '', hasMediaAttachment: !!options.header.hasMediaAttachment } } : {}),
      nativeFlowMessage: { buttons: normalizedButtons, messageParamsJson: '' }
    }
  }
}

export const generateCopyCodeButton = (body, copyCode, displayText = 'Copy Code', options = {}) => {
  return generateNativeFlowMessage(body, [jsonButton('cta_copy', {
    display_text: requireText(displayText, 'displayText'),
    copy_code: requireText(copyCode, 'copyCode')
  })], options)
}

export const generateCallButton = (body, phoneNumber, displayText = 'Call', options = {}) => {
  const phone = requireText(phoneNumber, 'phoneNumber')
  if (!/^\+?[0-9][0-9 ()-]{5,19}$/.test(phone)) throw new TypeError('phoneNumber harus berupa nomor telepon yang valid')
  return generateNativeFlowMessage(body, [jsonButton('cta_call', {
    display_text: requireText(displayText, 'displayText'),
    phone_number: phone
  })], options)
}

export const generateUrlButtonMessage = (body, buttons, options = {}) => {
  const nativeButtons = requireArray(buttons, 'buttons').map((btn, index) => {
    if (!btn || typeof btn !== 'object') throw new TypeError(`buttons[${index}] tidak valid`)
    const url = requireText(btn.url, `buttons[${index}].url`)
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error() } catch { throw new TypeError(`buttons[${index}].url harus URL http/https valid`) }
    return jsonButton('cta_url', { display_text: requireText(btn.displayText, `buttons[${index}].displayText`), url, merchant_url: btn.merchantUrl || url })
  })
  return generateNativeFlowMessage(body, nativeButtons, { footer: options.footer, header: options.title ? { title: options.title } : options.header })
}

export const generateQuickReplyButtons = (body, buttons, options = {}) => {
  const nativeButtons = requireArray(buttons, 'buttons').map((btn, index) => jsonButton('quick_reply', {
    display_text: requireText(btn?.displayText, `buttons[${index}].displayText`),
    id: requireText(btn?.id, `buttons[${index}].id`)
  }))
  return generateNativeFlowMessage(body, nativeButtons, { footer: options.footer, header: options.title ? { title: options.title } : options.header })
}

export const generateCombinedButtons = (body, buttons, options = {}) => {
  const nativeButtons = requireArray(buttons, 'buttons').map((btn, index) => {
    if (!btn || typeof btn !== 'object') throw new TypeError(`buttons[${index}] tidak valid`)
    const display_text = requireText(btn.displayText, `buttons[${index}].displayText`)
    switch (btn.type) {
      case 'url': {
        const url = requireText(btn.url, `buttons[${index}].url`)
        try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error() } catch { throw new TypeError(`buttons[${index}].url harus URL http/https valid`) }
        return jsonButton('cta_url', { display_text, url, merchant_url: btn.merchantUrl || url })
      }
      case 'reply': return jsonButton('quick_reply', { display_text, id: requireText(btn.id, `buttons[${index}].id`) })
      case 'copy': return jsonButton('cta_copy', { display_text, copy_code: requireText(btn.copyCode, `buttons[${index}].copyCode`) })
      case 'call': return jsonButton('cta_call', { display_text, phone_number: requireText(btn.phoneNumber, `buttons[${index}].phoneNumber`) })
      default: throw new TypeError(`buttons[${index}].type harus url, reply, copy, atau call`)
    }
  })
  return generateNativeFlowMessage(body, nativeButtons, { footer: options.footer, header: options.title ? { title: options.title } : options.header })
}

export default {
  generateInteractiveButtonMessage,
  generateInteractiveListMessage,
  generateTemplateMessage,
  generateNativeFlowMessage,
  generateCopyCodeButton,
  generateCallButton,
  generateUrlButtonMessage,
  generateQuickReplyButtons,
  generateCombinedButtons
}
