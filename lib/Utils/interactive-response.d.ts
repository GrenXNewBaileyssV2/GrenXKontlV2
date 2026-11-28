export interface InteractiveResponse { type: 'native_flow' | 'button' | 'list' | 'template'; id: string | null; name?: string | null; displayText?: string | null; params?: Record<string, unknown> | null; raw: any }
export declare function extractInteractiveResponse(message: any): InteractiveResponse | null
export declare function attachInteractiveResponseHandler(sock: any, handler: (response: InteractiveResponse, message: any, update: any) => unknown, options?: { includeUnidentified?: boolean; onError?: (error: unknown, message: any) => void }): () => void
