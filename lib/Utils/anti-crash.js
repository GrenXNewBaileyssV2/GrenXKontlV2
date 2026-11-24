// src/Utils/anti-crash.js

const createInitialState = () => ({
  errors: 0,
  lastErrorAt: null,
  lastErrorMessage: null,
  lastType: null,
  level: 'safe',
  shuttingDown: false
})

export function computeCrashLevel(errors, lastErrorAt, windowMs = 60000, shuttingDown = false) {
  if (shuttingDown) return 'critical'
  if (errors <= 0) return 'safe'
  const withinWindow = lastErrorAt !== null && Date.now() - lastErrorAt < windowMs
  if (!withinWindow) return 'safe'
  if (errors >= 5) return 'critical'
  if (errors >= 3) return 'danger'
  return 'warning'
}

export function buildCrashPayload(type, error, level, fatal, customMessage) {
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

export function renderCrashPanel(state, botName) {
  const label = {
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
  state = createInitialState()
  opts
  installed = false

  constructor(botName, opts) {
    this.botName = botName
    this.opts = {
      exitOnCritical: true,
      maxErrorsBeforeExit: 5,
      windowMs: 60000,
      ...opts
    }
  }

  getState() {
    return { ...this.state }
  }

  getLevel() {
    return this.state.level
  }

  log(level, msg, ...args) {
    const fn = this.opts.logger?.[level]
    if (fn) fn(msg, ...args)
    else if (level === 'error') console.error(msg, ...args)
    else if (level === 'warn') console.warn(msg, ...args)
    else console.log(msg, ...args)
  }

  handle(type, error, fatal = false) {
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

  install() {
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

  uninstall() {
    this.installed = false
  }
}

export function createAntiCrash(botName, opts) {
  const guard = new AntiCrash(botName, opts)
  guard.install()
  return guard
}

export function wrapHandler(guard, name, fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      guard.handle(`handler:${name}`, err)
      return undefined
    }
  }
}

export function safeAsync(guard, name, fn) {
  return wrapHandler(guard, name, fn)()
}
