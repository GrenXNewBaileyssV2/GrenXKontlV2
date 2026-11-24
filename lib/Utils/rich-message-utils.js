// src/Utils/rich-message-utils.ts

export function generateMarkdownContent(opts) {
  const { markdown, title, footer } = opts
  if (!markdown || typeof markdown !== 'string') {
    throw new Error('markdown wajib berupa string non-empty')
  }
  return {
    __typename: 'GenAIMarkdownTextUXPrimitive',
    markdown,
    ...(title ? { title } : {}),
    ...(footer ? { footer } : {})
  }
}

export function extractIE(message) {
  if (!message) return null
  return (
    message.interactiveMessage ||
    message.templateMessage ||
    message.buttonsMessage ||
    null
  )
}
