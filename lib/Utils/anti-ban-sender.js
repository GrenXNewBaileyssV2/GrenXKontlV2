// Keep this utility independent from the aggregate Types barrel: importing that
// barrel also loads State.js and its @hapi/boom runtime dependency.
const LOGGED_OUT_STATUS_CODE = 401
const WARNING_STATUS_CODES = new Set([LOGGED_OUT_STATUS_CODE, 403, 429])

const LEVEL_LABELS = {
  safe: 'AMAN',
  warning: 'WASPADA',
  danger: 'BAHAYA',
  critical: 'KRITIS'
}

const VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000
const WARNING_REASON = 'risiko_keband'

const WARNING_MESSAGE = (senderId) =>
  `Nomor ${senderId ?? '-'} dilepas otomatis karena terdeteksi bakalan keband ` +
  `kalau diteruskan. Segera ganti dengan nomor baru.`

const createInitialState = () => ({
  violations: 0,
  warnings: 0,
  lastViolationAt: null,
  lastWarningAt: null,
  lastReason: null,
  lastMessage: null,
  level: 'safe',
  released: false
})

export function computeSafetyLevel(warnings, lastWarningAt) {
  if (warnings <= 0 || lastWarningAt === null) return 'safe'
  if (Date.now() - lastWarningAt >= VIOLATION_WINDOW_MS) return 'safe'
  if (warnings >= 3) return 'critical'
  if (warnings === 2) return 'danger'
  return 'warning'
}

export function isWarningStatusCode(code) {
  if (code === undefined || code === null) return false
  return WARNING_STATUS_CODES.has(code)
}

export function buildWarningPayload(senderId, level) {
  return {
    senderWarning: true,
    senderReleased: true,
    reason: WARNING_REASON,
    message: `[Anti-Ban][${level.toUpperCase()}] ${WARNING_MESSAGE(senderId)}`,
    level,
    timestamp: new Date()
  }
}

export function renderSafetyPanel(state, senderId) {
  const label = LEVEL_LABELS[state.level] ?? state.level
  const status = state.released ? `${label} (DILEPAS)` : label
  const lastWarning = state.lastWarningAt
    ? new Date(state.lastWarningAt).toISOString().slice(0, 19).replace('T', ' ')
    : '-'
  const notif = state.lastMessage ?? WARNING_MESSAGE(senderId)

  const wrapped = []
  const maxLen = 44
  let line = ''
  for (const word of notif.split(' ')) {
    if ((line + ' ' + word).trim().length > maxLen) {
      wrapped.push(line.trim())
      line = word
    } else {
      line = (line + ' ' + word).trim()
    }
  }
  if (line) wrapped.push(line.trim())

  const lines = [
    '╔══════════════════════════════════════════════╗',
    '║        PANEL ANTI-BAN SENDER                 ║',
    '╠══════════════════════════════════════════════╣',
    `║ Sender        : ${(senderId ?? '-').padEnd(29)}║`,
    `║ Status        : ${String(status).padEnd(29)}║`,
    `║ Peringatan    : ${String(state.warnings).padEnd(29)}║`,
    `║ Alasan        : ${String(state.lastReason ?? '-').slice(0, 29).padEnd(29)}║`,
    `║ Warn terakhir : ${lastWarning}`.padEnd(48) + '║',
    '╠══════════════════════════════════════════════╣',
    '║ NOTIFIKASI:                                  ║',
    ...wrapped.map((w) => `║ ${w.padEnd(44)} ║`),
    '╚══════════════════════════════════════════════╝'
  ]
  return lines.join('\n')
}

export class AntiBanSender {
  state = createInitialState()
  ended = false
  warningCooldown = new Map()

  constructor(senderId, endSocket, opts = {}) {
    this.senderId = senderId
    this.endSocket = endSocket
    this.onWarning = opts.onWarning
    this.onLevelChange = opts.onLevelChange
    this.onPanel = opts.onPanel
    this.disconnectDelayMs = opts.disconnectDelayMs ?? 0
    this.warningCooldownMs = opts.warningCooldownMs ?? 60_000
  }

  getState() {
    return { ...this.state }
  }

  getLevel() {
    return this.state.level
  }

  isReleased() {
    return this.state.released === true
  }

  getWarningCount() {
    return this.state.warnings
  }

  inspect(source, detail, statusCode) {
    if (this.ended) return null
    if (isWarningStatusCode(statusCode)) {
      return this._handleWarning()
    }
    return null
  }

  reset() {
    this.state = createInitialState()
    this.ended = false
    this.warningCooldown.clear()
  }

  _handleWarning() {
    const now = Date.now()
    const last = this.warningCooldown.get(WARNING_REASON) ?? 0
    if (now - last < this.warningCooldownMs) return null
    this.warningCooldown.set(WARNING_REASON, now)

    const message = WARNING_MESSAGE(this.senderId)

    this.state.warnings += 1
    this.state.lastWarningAt = now
    this.state.lastReason = WARNING_REASON
    this.state.lastMessage = message
    this.state.released = true
    this.state.level = computeSafetyLevel(
      this.state.warnings,
      this.state.lastWarningAt
    )

    const payload = buildWarningPayload(this.senderId, this.state.level)

    this._emitPanel()
    console.warn(payload.message)
    this.onWarning?.(payload)
    this.onLevelChange?.(this.state.level, this.getState())

    this.ended = true
    this._scheduleDisconnect('warning_release')
    return payload
  }

  _emitPanel() {
    const panel = renderSafetyPanel(this.state, this.senderId)
    console.error('\n' + panel + '\n')
    this.onPanel?.(panel, this.getState())
  }

  _scheduleDisconnect(reason) {
    if (this.disconnectDelayMs <= 0) {
      this._safeEnd(reason)
      return
    }
    const timer = setTimeout(() => this._safeEnd(reason), this.disconnectDelayMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  _safeEnd(reason) {
    try {
      this.endSocket(reason)
    } catch {
      try {
        this.endSocket(undefined)
      } catch {}
    }
  }
}

export function attachAntiBan(sock, senderId, opts = {}) {
  const manager = new AntiBanSender(
    senderId,
    (reason) => {
      try {
        sock.end(new Error(`anti-ban:${reason}`))
      } catch {
        try {
          sock.end(undefined)
        } catch {}
      }
    },
    opts
  )

  const emit = (payload, base = {}) => {
    if (!payload) return
    try {
      if (payload.senderWarning) {
        sock.ev.emit('connection.update', { ...base, senderWarning: payload })
      }
    } catch {}
  }

  const handle = (source, detail, statusCode, base) => {
    const payload = manager.inspect(source, detail, statusCode)
    if (payload) emit(payload, base)
  }

  const readStatusCode = (value) => {
    const raw = value?.statusCode
      ?? value?.output?.statusCode
      ?? value?.attrs?.code
      ?? value?.code
    if (raw === undefined || raw === null || raw === '') return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const onConnectionUpdate = (update) => {
    if (!update || update.connection !== 'close') return
    const statusCode = readStatusCode(update?.lastDisconnect?.error)
    if (statusCode !== undefined) {
      handle('connection_close', update.lastDisconnect, statusCode, update)
    }
  }

  const onFailure = (detail) => {
    const statusCode = readStatusCode(detail)
    if (statusCode !== undefined) handle('failure', detail, statusCode)
  }

  let attached = true
  const detach = () => {
    if (!attached) return
    attached = false
    const remove = sock.ev?.off?.bind(sock.ev) ?? sock.ev?.removeListener?.bind(sock.ev)
    remove?.('connection.update', onConnectionUpdate)
    remove?.('CB:failure', onFailure)
  }

  try {
    sock.ev.on('connection.update', onConnectionUpdate)
    sock.ev.on?.('CB:failure', onFailure)
  } catch {
    detach()
  }

  // Keep the historical return type (manager) while exposing lifecycle cleanup.
  manager.detach = detach
  return manager
}
