export declare function computeCrashLevel(errors: number, lastErrorAt: number | null, windowMs?: number, shuttingDown?: boolean): string
export declare function buildCrashPayload(type: string, error: unknown, level: string, fatal: boolean, customMessage?: string): any
export declare function renderCrashPanel(state: any, botName?: string): string
export declare class AntiCrash { constructor(botName?: string, opts?: any); handle(type: string, error: unknown, options?: any): any; reset(): void }
export declare function createAntiCrash(botName: string, opts?: any): AntiCrash
export declare function wrapHandler(guard: AntiCrash, name: string, fn: (...args: any[]) => any): (...args: any[]) => any
export declare function safeAsync(guard: AntiCrash, name: string, fn: (...args: any[]) => any): (...args: any[]) => any
