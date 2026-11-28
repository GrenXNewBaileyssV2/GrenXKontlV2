export type SafetyLevel = 'safe' | 'warning' | 'danger' | 'critical'
export interface AntiBanState { violations: number; warnings: number; lastViolationAt: number | null; lastWarningAt: number | null; lastReason: string | null; lastMessage: string | null; level: SafetyLevel; released: boolean }
export declare function computeSafetyLevel(warnings: number, lastWarningAt: number | null): SafetyLevel
export declare function isWarningStatusCode(code: number | null | undefined): boolean
export declare function buildWarningPayload(senderId: string, level: SafetyLevel): any
export declare function renderSafetyPanel(state: AntiBanState, senderId?: string): string
export declare class AntiBanSender { constructor(senderId: string, endSocket: (reason?: string) => void, opts?: any); getState(): AntiBanState; getLevel(): SafetyLevel; isReleased(): boolean; getWarningCount(): number; inspect(source: string, detail?: any, statusCode?: number): any; reset(): void; detach(): void }
export declare function attachAntiBan(sock: any, senderId: string, opts?: any): AntiBanSender
