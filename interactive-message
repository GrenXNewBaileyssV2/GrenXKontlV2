/**
 * Interactive Message Helpers untuk GrenXKontlV2
 */

/**
 * Generate Native Flow Message (tombol modern)
 */
export function generateNativeFlowMessage(body, buttons, options = {}) {
  return {
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: {
          body: { text: body },
          footer: options.footer ? { text: options.footer } : undefined,
          header: options.header || undefined,
          nativeFlowMessage: {
            buttons: buttons.map(btn => ({
              name: btn.name,
              buttonParamsJson: btn.buttonParamsJson
            }))
          }
        }
      }
    }
  }
}

/**
 * Quick Reply Buttons
 */
export function generateQuickReplyButtons(body, buttons, options = {}) {
  const nativeButtons = buttons.map(btn => ({
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: btn.displayText,
      id: btn.id
    })
  }))

  return generateNativeFlowMessage(body, nativeButtons, options)
}

/**
 * URL Buttons
 */
export function generateUrlButtonMessage(body, buttons, options = {}) {
  const nativeButtons = buttons.map(btn => ({
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({
      display_text: btn.displayText,
      url: btn.url,
      merchant_url: btn.merchantUrl || btn.url
    })
  }))

  return generateNativeFlowMessage(body, nativeButtons, options)
}

/**
 * Copy Code Button
 */
export function generateCopyCodeButton(body, copyCode, displayText = 'Salin', options = {}) {
  return generateNativeFlowMessage(body, [{
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      copy_code: copyCode
    })
  }], options)
}

/**
 * Call Button
 */
export function generateCallButton(body, phoneNumber, displayText = 'Telepon', options = {}) {
  return generateNativeFlowMessage(body, [{
    name: 'cta_call',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      phone_number: phoneNumber
    })
  }], options)
}

/**
 * Combined Buttons (campur url + reply + copy + call)
 */
export function generateCombinedButtons(body, buttons, options = {}) {
  const nativeButtons = buttons.map(btn => {
    switch (btn.type) {
      case 'url':
        return {
          name: 'cta_url',
          buttonParamsJson: JSON.stringify({
            display_text: btn.displayText,
            url: btn.url,
            merchant_url: btn.url
          })
        }
      case 'reply':
        return {
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: btn.displayText,
            id: btn.id
          })
        }
      case 'copy':
        return {
          name: 'cta_copy',
          buttonParamsJson: JSON.stringify({
            display_text: btn.displayText,
            copy_code: btn.copyCode
          })
        }
      case 'call':
        return {
          name: 'cta_call',
          buttonParamsJson: JSON.stringify({
            display_text: btn.displayText,
            phone_number: btn.phoneNumber
          })
        }
      default:
        return null
    }
  }).filter(Boolean)

  return generateNativeFlowMessage(body, nativeButtons, options)
}

/**
 * List Message
 */
export function generateInteractiveListMessage(content) {
  return {
    listMessage: {
      title: content.title,
      description: content.description || '',
      buttonText: content.buttonText,
      footerText: content.footer || '',
      listType: 1, // SINGLE_SELECT
      sections: content.sections.map(sec => ({
        title: sec.title,
        rows: sec.rows.map(row => ({
          rowId: row.rowId,
          title: row.title,
          description: row.description || ''
        }))
      }))
    }
  }
}

export default {
  generateNativeFlowMessage,
  generateQuickReplyButtons,
  generateUrlButtonMessage,
  generateCopyCodeButton,
  generateCallButton,
  generateCombinedButtons,
  generateInteractiveListMessage
}
