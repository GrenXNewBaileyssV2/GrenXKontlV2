/**
 * Extracts user selections from WhatsApp interactive response message shapes.
 * The helper intentionally returns parsed params as data; it never executes
 * arbitrary code from a message payload.
 */
const unwrapMessage = (message) => {
  let current = message
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage']
  for (let i = 0; i < 8 && current && typeof current === 'object'; i++) {
    const wrapper = wrappers.find((key) => current[key]?.message)
    if (!wrapper) break
    current = current[wrapper].message
  }
  return current && typeof current === 'object' ? current : {}
}

const parseParams = (paramsJson) => {
  if (typeof paramsJson !== 'string' || !paramsJson.trim()) return null
  try {
    const value = JSON.parse(paramsJson)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export function extractInteractiveResponse(message) {
  const content = unwrapMessage(message?.message ?? message)
  const response = content.interactiveResponseMessage?.nativeFlowResponseMessage
  if (response) {
    const params = parseParams(response.paramsJson)
    return {
      type: 'native_flow',
      id: params?.id ?? params?.selected_id ?? params?.row_id ?? null,
      name: response.name ?? null,
      params,
      raw: response
    }
  }

  const button = content.buttonsResponseMessage
  if (button) return { type: 'button', id: button.selectedButtonId ?? null, displayText: button.selectedDisplayText ?? null, raw: button }

  const list = content.listResponseMessage?.singleSelectReply
  if (list) return { type: 'list', id: list.selectedRowId ?? null, raw: list }

  const template = content.templateButtonReplyMessage
  if (template) return { type: 'template', id: template.selectedId ?? null, displayText: template.selectedDisplayText ?? null, raw: template }

  return null
}

/** Attach a safe response listener. Returns an idempotent detach function. */
export function attachInteractiveResponseHandler(sock, handler, options = {}) {
  if (!sock?.ev || typeof sock.ev.on !== 'function') throw new TypeError('sock.ev.on wajib tersedia')
  if (typeof handler !== 'function') throw new TypeError('handler wajib berupa function')

  let attached = true
  const onUpsert = (update) => {
    if (!attached || !update || !Array.isArray(update.messages)) return
    for (const message of update.messages) {
      const response = extractInteractiveResponse(message)
      if (!response?.id && !options.includeUnidentified) continue
      try {
        const result = handler(response, message, update)
        if (result && typeof result.then === 'function') result.catch((error) => options.onError?.(error, message))
      } catch (error) {
        options.onError?.(error, message)
      }
    }
  }

  sock.ev.on('messages.upsert', onUpsert)
  return () => {
    if (!attached) return
    attached = false
    if (typeof sock.ev.off === 'function') sock.ev.off('messages.upsert', onUpsert)
    else if (typeof sock.ev.removeListener === 'function') sock.ev.removeListener('messages.upsert', onUpsert)
  }
}
