/** Public entry point for the GrenXKontlV2 Baileys fork. */
export interface GrenXSocket {
  ev: { on(event: string, listener: (...args: any[]) => void): unknown; off?(event: string, listener: (...args: any[]) => void): unknown }
  user?: { id?: string }
  sendMessage(jid: string, content: any, options?: any): Promise<any>
  relayMessage(jid: string, message: any, options?: any): Promise<any>
  end(error?: Error): void
  onInteractiveResponse(handler: (response: import('./Utils/interactive-response.js').InteractiveResponse, message: any, update: any) => unknown, options?: any): () => void
  sendJsonMessage(jid: string, content?: any, options?: any): Promise<any>
  sendActionPoll(jid: string, name: string, options: Array<{ vote: string; action: any }>, sendOptions?: any): Promise<any>
  resolvePollAction(messageId: string, selectedVoteLabel: string): any
  sendRichResponse(jid: string, content?: any): Promise<any>
  sendButtonsMessage(jid: string, content?: any, options?: any): Promise<any>
  sendListMessage(jid: string, content?: any, options?: any): Promise<any>
  sendNativeFlowMessage(jid: string, body: string, buttons: any[], options?: any): Promise<any>
  sendQuickReplyMessage(jid: string, body: string, buttons: any[], options?: any): Promise<any>
  sendUrlButtonsMessage(jid: string, body: string, buttons: any[], options?: any): Promise<any>
  sendCopyCodeMessage(jid: string, body: string, code: string, displayText?: string, options?: any): Promise<any>
  sendCallButtonMessage(jid: string, body: string, phone: string, displayText?: string, options?: any): Promise<any>
  sendCombinedButtonsMessage(jid: string, body: string, buttons: any[], options?: any): Promise<any>
  sendCarouselMessage(jid: string, content?: any, options?: any): Promise<any>
  forwardMessage(jid: string, message: any, options?: any): Promise<any>
  sendVCard(jid: string, contacts: any | any[], options?: any): Promise<any>
  broadcastMessage(jids: string[], content: any, options?: any): Promise<Array<{ jid: string; ok: boolean; result?: any; error?: unknown }>>
}
export interface GrenXConfig { [key: string]: any }
declare function makeWASocket(config: GrenXConfig): GrenXSocket
export { makeWASocket }
export default makeWASocket
export * from './Utils/index.js'
export * from './Types/index.js'
export * from './Defaults/index.js'
export * from './WABinary/index.js'
export * from './WAM/index.js'
export * from './WAUSync/index.js'
export * from './Store/index.js'
export * from '../WAProto/index.js'
