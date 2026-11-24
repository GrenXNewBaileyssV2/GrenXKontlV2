// src/Utils/anti-crash.ts

export type CrashLevel = 'safe' | 'warning' | 'danger' | 'critical'

export interface CrashEventPayload {
  crash: true
  type: string
  error: Error | unknown
  message: string
  level: CrashLevel
  fatal: boolean
  timestamp: Date
}

export interface AntiCrashState {
  errors: number
  lastErrorAt: number | null
  lastErrorMessage: string | null
  lastType: string | null
  level: CrashLevel
  shuttingDown: boolean
}

export interface AntiCrashOptions {
  onCrash?: (payload: CrashEventPayload) => void
  onLevelChange?: (level: CrashLevel, state: AntiCrashState) => void
  logger?: {
    info?: (msg: string, ...args: any[]) => void
    warn?: (msg: string, ...args: any[]) => void
    error?: (msg: string, ...args: any[]) => void
  }
  exitOnCritical?: boolean
  maxErrorsBeforeExit?: number
  windowMs?: number
}

const createInitialState = (): AntiCrashState => ({
  errors: 0,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastType: null,
  level: 'safe',
  shuttingDown: false
})

export function computeCrashLevel(
  errors: number,
  lastErrorAt: number | null,
  windowMs = 60_000,
  shuttingDown = false
): CrashLevel {
  if (shuttingDown) return 'critical'
  if (errors <= 0) return 'safe'
  const withinWindow = lastErrorAt !== null && Date.now() - lastErrorAt < windowMs
  if (!withinWindow) return 'safe'
  if (errors >= 5) return 'critical'
  if (errors >= 3) return 'danger'
  return 'warning'
}

export function buildCrashPayload(
  type: string,
  error: unknown,
  level: CrashLevel,
  fatal: boolean,
  customMessage?: string
): CrashEventPayload {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error ?? {})
  return {
    crash: true,
    type,
    error,
    message:
      customMessage ??
      `[Anti-Crash][${level.toUpperCase()}] ${type}: ${msg}`,
    level,
    fatal,
    timestamp: new Date()
  }
}

export function renderCrashPanel(state: AntiCrashState, botName?: string): string {
  const label: Record<CrashLevel, string> = {
    safe: 'AMAN',
    warning: 'WASPADA',
    danger: 'BAHAYA',
    critical: 'KRITIS'
  }
  const lines = [
    '╔══════════════════════════════════════════════╗',
    '║        PANEL ANTI-CRASH BOT                  ║',
    '╠══════════════════════════════════════════════╣',
    `║ Bot        : ${(botName ?? '-').padEnd(31)}║`,
    `║ Status     : ${label[state.level].padEnd(31)}║`,
    `║ Error      : ${String(state.errors).padEnd(31)}║`,
    `║ Tipe       : ${(state.lastType ?? '-').slice(0, 31).padEnd(31)}║`,
    `║ Pesan      : ${(state.lastErrorMessage ?? '-').slice(0, 31).padEnd(31)}║`,
    `║ Terakhir   : ${
      state.lastErrorAt
        ? new Date(state.lastErrorAt).toISOString().slice(0, 19).replace('T', ' ')
        : '-'
    }`.padEnd(46) + '║',
    '╚══════════════════════════════════════════════╝'
  ]
  return lines.join('\n')
}

export class AntiCrash {
  private state: AntiCrashState = createInitialState()
  private opts: AntiCrashOptions
  private installed = false

  constructor(
    private readonly botName: string,
    opts?: AntiCrashOptions
  ) {
    this.opts = {
      exitOnCritical: true,
      maxErrorsBeforeExit: 5,
      windowMs: 60_000,
      ...opts
    }
  }

  getState(): AntiCrashState {
    return { ...this.state }
  }

  getLevel(): CrashLevel {
    return this.state.level
  }

  private log(
    level: 'info' | 'warn' | 'error',
    msg: string,
    ...args: any[]
  ) {
    const fn = this.opts.logger?.[level]
    if (fn) fn(msg, ...args)
    else if (level === 'error') console.error(msg, ...args)
    else if (level === 'warn') console.warn(msg, ...args)
    else console.log(msg, ...args)
  }

  handle(type: string, error: unknown, fatal = false): CrashEventPayload {
    this.state.errors += 1
    this.state.lastErrorAt = Date.now()
    this.state.lastType = type
    this.state.lastErrorMessage =
      error instanceof Error ? error.message : String(error)

    this.state.level = computeCrashLevel(
      this.state.errors,
      this.state.lastErrorAt,
      this.opts.windowMs,
      this.state.shuttingDown
    )

    const payload = buildCrashPayload(type, error, this.state.level, fatal)

    this.log('error', '\n' + renderCrashPanel(this.state, this.botName) + '\n')
    this.log('error', payload.message)

    this.opts.onCrash?.(payload)
    this.opts.onLevelChange?.(this.state.level, this.getState())

    if (
      this.state.level === 'critical' &&
      this.opts.exitOnCritical &&
      !this.state.shuttingDown
    ) {
      this.state.shuttingDown = true
      this.log(
        'error',
        `[Anti-Crash] Error kritis (${this.state.errors}x). Bot akan dihentikan.`
      )
      const code = this.opts.maxErrorsBeforeExit ?? 1
      setTimeout(() => process.exit(code), 500)
    }

    return payload
  }

  reset() {
    this.state = createInitialState()
  }

  install(): void {
    if (this.installed) return
    this.installed = true

    process.on('uncaughtException', (err) => {
      this.handle('uncaughtException', err, true)
      if (!this.opts.exitOnCritical) return
    })

    process.on('unhandledRejection', (reason) => {
      this.handle('unhandledRejection', reason, false)
    })

    process.on('SIGINT', () => {
      this.state.shuttingDown = true
      this.log('warn', '[Anti-Crash] SIGINT diterima. Bot dihentikan dengan rapi.')
      process.exit(0)
    })

    process.on('SIGTERM', () => {
      this.state.shuttingDown = true
      this.log('warn', '[Anti-Crash] SIGTERM diterima. Bot dihentikan dengan rapi.')
      process.exit(0)
    })

    this.log('info', '[Anti-Crash] Proteksi aktif.')
  }

  uninstall(): void {
    this.installed = false
  }
}

export function createAntiCrash(
  botName: string,
  opts?: AntiCrashOptions
): AntiCrash {
  const guard = new AntiCrash(botName, opts)
  guard.install()
  return guard
}

export function wrapHandler<T extends (...args: any[]) => any>(
  guard: AntiCrash,
  name: string,
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T> | undefined> {
  return async (...args: Parameters<T>) => {
    try {
      return await fn(...args)
    } catch (err) {
      guard.handle(`handler:${name}`, err)
      return undefined
    }
  }
}

export function safeAsync<T>(
  guard: AntiCrash,
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  return wrapHandler(guard, name, fn)()
}
