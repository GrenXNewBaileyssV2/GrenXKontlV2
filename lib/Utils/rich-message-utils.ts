// src/Utils/rich-message-utils.ts

export interface MarkdownPayloadOptions {
  markdown: string
  title?: string
  footer?: string
}

/**
 * Membuat payload rich message GenAI Markdown
 */
export function generateMarkdownContent(opts: MarkdownPayloadOptions) {
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

/**
 * Extract interactive element dari message (contoh helper)
 */
export function extractIE(message: any) {
  if (!message) return null
  return (
    message.interactiveMessage ||
    message.templateMessage ||
    message.buttonsMessage ||
    null
  )
}
