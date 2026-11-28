export interface InteractiveMessageOptions {
  footer?: string
  title?: string
  header?: { title?: string; subtitle?: string; hasMediaAttachment?: boolean }
}
export interface InteractiveButton { name: string; buttonParamsJson: string | Record<string, unknown> }
export interface QuickReplyButton { id: string; displayText: string }
export interface UrlButton { displayText: string; url: string; merchantUrl?: string }
export type CombinedButton =
  | ({ type: 'url'; url: string; merchantUrl?: string } & { displayText: string })
  | ({ type: 'reply'; id: string } & { displayText: string })
  | ({ type: 'copy'; copyCode: string } & { displayText: string })
  | ({ type: 'call'; phoneNumber: string } & { displayText: string })
export function generateInteractiveButtonMessage(content: any, options?: any): Promise<any>
export function generateInteractiveListMessage(content: { title: string; description?: string; buttonText: string; footer?: string; sections: Array<{ title: string; rows: Array<{ rowId: string; title: string; description?: string }> }> }): any
export function generateTemplateMessage(content: any, options?: any): Promise<any>
export function generateNativeFlowMessage(body: string, buttons: InteractiveButton[], options?: InteractiveMessageOptions): any
export function generateCallButton(body: string, phoneNumber: string, displayText?: string, options?: InteractiveMessageOptions): any
export function generateCopyCodeButton(body: string, copyCode: string, displayText?: string, options?: InteractiveMessageOptions): any
export function generateUrlButtonMessage(body: string, buttons: UrlButton[], options?: InteractiveMessageOptions): any
export function generateQuickReplyButtons(body: string, buttons: QuickReplyButton[], options?: InteractiveMessageOptions): any
export function generateCombinedButtons(body: string, buttons: CombinedButton[], options?: InteractiveMessageOptions): any
