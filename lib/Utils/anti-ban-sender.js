import { DisconnectReason } from '../Types/index.js'

export const BAN_KEYWORDS = new Set([
  'banned',
  'account_locked',
  'sender_banned',
  'restricted',
  'blocked'
])

export const WARNING_KEYWORDS = new Set([
  'spam',
  'limit',
  'rate-overlimit',
  'too many',
  'temporarily blocked',
  'not authorized',
  'forbidden'
])

const BAN_STATUS_CODES = new Set([DisconnectReason.loggedOut, 403, 429])

const LEVEL_LABELS = {
  safe: 'AMAN',
  warning: 'WASPADA',
  danger: 'BAHAYA',
  critical: 'KRITIS'
}

const VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000

const createInitialState = () => ({
  violations: 0,
  warnings: 0,
  lastViolationAt: null,
  lastWarningAt: null,
  lastReason: null,
  level: 'safe',
  banned: false
})

export function computeSafetyLevel(violations, lastViolationAt, banned = false) {
  if (banned) return 'critical'
  if (violations <= 0 || lastViolationAt === null) return 'safe'
  if (Date.now() - lastViolationAt >= VIOLATION_WINDOW_MS) return 'safe'
  if (violations >= 3) return 'critical'
  if (violations === 2) return 'danger'
  return 'warning'
}

function collectText(...sources) {
  const parts = []
  for (const src of sources) {
    if (!src) continue
    if (typeof src === 'string') parts.push(src)
    else if (typeof src === 'object') {
      try {
        parts.push(JSON.stringify(src))
      } catch {}
    }
  }
  return parts.join(' ').toLowerCase()
}

export function isBanSignal(...sources) {
  const text = collectText(...sources)
  if (!text) return { hit: false }
  for (const kw of BAN_KEYWORDS) if (text.includes(kw)) return { hit: true, keyword: kw }
  return { hit: false }
}

export function isWarningSignal(...sources) {
  const text = collectText(...sources)
  if (!text) return { hit: false }
  for (const kw of WARNING_KEYWORDS) if (text.includes(kw)) return { hit: true, keyword: kw }
  return { hit: false }
}

export function isBanStatusCode(code) {
  if (code === undefined || code === null) return false
  return BAN_STATUS_CODES.has(code)
}

export function buildSenderBannedPayload(reason, detail, level, customMessage) {
  const base =
    customMessage ||
    `Sender terdeteksi ${String(reason).toUpperCase()}. Koneksi diputus otomatis. ` +
      `Segera lepas sender ini dan ganti dengan nomor baru.`
  return {
    senderBanned: true,
    reason,
    detail,
    message: `[Anti-Ban][${level.toUpperCase()}] ${base}`,
    level,
    timestamp: new Date()
  }
}

export function buildWarningPayload(reason, detail, level, customMessage) {
  const base =
    customMessage ||
    `Sender terdeteksi berisiko ${String(reason).toUpperCase()}. ` +
      `Hentikan pengiriman massal atau ganti nomor sebelum benar-benar diblokir.`
  return {
    senderWarning: true,
    reason,
    detail,
    message: `[Anti-Ban-Peringatan][${level.toUpperCase()}] ${base}`,
    level,
    timestamp: new Date()
  }
}

export function renderSafetyPanel(state, senderId) {
  const label = LEVEL_LABELS[state.level] ?? state.level
  const lastViolation = state.lastViolationAt
    ? new Date(state.lastViolationAt).toISOString().slice(0, 19).replace('T', ' ')
    : '-'
  const lastWarning = state.lastWarningAt
    ? new Date(state.lastWarningAt).toISOString().slice(0, 19).replace('T', ' ')
    : '-'

  const lines = [
    '╔══════════════════════════════════════════════╗',
    '║        PANEL ANTI-BAN SENDER                 ║',
    '╠══════════════════════════════════════════════╣',
    `║ Sender        : ${(senderId ?? '-').padEnd(29)}║`,
    `║ Status        : ${String(label).padEnd(29)}║`,
    `║ Pelanggaran   : ${String(state.violations).padEnd(29)}║`,
    `║ Peringatan    : ${String(state.warnings).padEnd(29)}║`,
    `║ Alasan        : ${String(state.lastReason ?? '-').slice(0, 29).padEnd(29)}║`,
    `║ Warn terakhir : ${lastWarning}`.padEnd(48) + '║',
    `║ Ban terakhir  : ${lastViolation}`.padEnd(48) + '║',
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
    this.onBan = opts.onBan
    this.onWarning = opts.onWarning
    this.onLevelChange = opts.onLevelChange
    this.onPanel = opts.onPanel
    this.disconnectDelayMs = opts.disconnectDelayMs ?? 1500
    this.warningCooldownMs = opts.warningCooldownMs ?? 60_000
    this.warningDisconnectThreshold = opts.warningDisconnectThreshold ?? 3
  }

  getState() {
    return { ...this.state }
  }

  getLevel() {
    return this.state.level
  }

  isBanned() {
    return this.state.banned === true
  }

  getWarningCount() {
    return this.state.warnings
  }

  inspect(source, detail, statusCode) {
    if (this.ended) return null

    const ban = isBanSignal(source, detail)
    const warn = isWarningSignal(source, detail)
    const codeBan = isBanStatusCode(statusCode)

    if (ban.hit || codeBan) {
      return this._handleBan(ban.keyword ?? source ?? `status_${statusCode}`, detail)
    }
    if (warn.hit) {
      return this._handleWarning(warn.keyword, detail)
    }
    return null
  }

  reset() {
    this.state = createInitialState()
    this.ended = false
    this.warningCooldown.clear()
  }

  _handleBan(reason, detail) {
    this.state.violations += 1
    this.state.lastViolationAt = Date.now()
    this.state.lastReason = reason
    this.state.banned = true
    this.state.level = computeSafetyLevel(
      this.state.violations,
      this.state.lastViolationAt,
      true
    )

    const payload = buildSenderBannedPayload(reason, detail, this.state.level)
    this._emitPanel()
    console.error(payload.message)
    this.onBan?.(payload)
    this.onLevelChange?.(this.state.level, this.getState())

    this.ended = true
    this._scheduleDisconnect(reason)
    return payload
  }

  _handleWarning(reason, detail) {
    const now = Date.now()
    const last = this.warningCooldown.get(reason) ?? 0
    if (now - last < this.warningCooldownMs) return null
    this.warningCooldown.set(reason, now)

    this.state.warnings += 1
    this.state.lastWarningAt = now
    this.state.lastReason = reason
    this.state.level = computeSafetyLevel(
      this.state.warnings,
      this.state.lastWarningAt,
      false
    )

    const payload = buildWarningPayload(reason, detail, this.state.level)
    this._emitPanel()
    console.warn(payload.message)
    this.onWarning?.(payload)
    this.onLevelChange?.(this.state.level, this.getState())

    if (this.state.warnings >= this.warningDisconnectThreshold) {
      return this._handleBan(`warning_threshold:${reason}`, detail)
    }
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
      if (payload.senderBanned) {
        sock.ev.emit('connection.update', { ...base, senderBanned: payload })
      } else if (payload.senderWarning) {
        sock.ev.emit('connection.update', { ...base, senderWarning: payload })
      }
    } catch {}
  }

  const handle = (source, detail, statusCode, base) => {
    const payload = manager.inspect(source, detail, statusCode)
    if (payload) emit(payload, base)
  }

  const onConnectionUpdate = (update) => {
    if (!update) return
    const statusCode = update?.lastDisconnect?.error?.output?.statusCode
    if (update?.connection === 'close' && statusCode) {
      handle('connection_close', update.lastDisconnect, statusCode, update)
    }
    if (update?.streamError) {
      handle('stream_error', update.streamError)
    }
  }

  try {
    sock.ev.on('connection.update', onConnectionUpdate)
    sock.ev.on?.('CB:stream:error', (d) => handle('stream_error', d))
    sock.ev.on?.('CB:failure', (d) => handle('failure', d))
  } catch {}

  return manager
}
