// src/Utils/anti-ban-sender.ts
import { DisconnectReason } from '../Types/index.js'

export const BAN_KEYWORDS = [
  'banned',
  'ban',
  'restricted',
  'blocked',
  'account_locked',
  'sender_banned',
  'spam',
  'limit',
  'rate-overlimit',
  'too many',
  'temporarily blocked',
  'not authorized',
  'forbidden'
] as const

export type SenderSafetyLevel = 'safe' | 'warning' | 'danger' | 'critical'

export interface SenderBannedPayload {
  senderBanned: true
  reason: string
  detail: any
  message: string
  level: SenderSafetyLevel
  timestamp: Date
}

export interface AntiBanState {
  violations: number
  lastViolationAt: number | null
  lastReason: string | null
  level: SenderSafetyLevel
  banned: boolean
}

const createInitialState = (): AntiBanState => ({
  violations: 0,
  lastViolationAt: null,
  lastReason: null,
  level: 'safe',
  banned: false
})

export function computeSafetyLevel(
  violations: number,
  lastViolationAt: number | null,
  banned = false
): SenderSafetyLevel {
  if (banned) return 'critical'
  if (violations <= 0) return 'safe'
  const within24h =
    lastViolationAt !== null && Date.now() - lastViolationAt < 24 * 60 * 60 * 1000
  if (!within24h) return 'safe'
  if (violations >= 3) return 'critical'
  if (violations === 2) return 'danger'
  return 'warning'
}

function collectText(...sources: any[]): string {
  const parts: string[] = []
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

export function isBanSignal(...sources: any[]): { hit: boolean; keyword?: string } {
  const text = collectText(...sources)
  for (const kw of BAN_KEYWORDS) {
    if (text.includes(kw)) return { hit: true, keyword: kw }
  }
  return { hit: false }
}

export function isBanStatusCode(code?: number): boolean {
  if (code === undefined) return false
  return code === DisconnectReason.loggedOut || code === 403 || code === 429
}

export function buildSenderBannedPayload(
  reason: string,
  detail: any,
  level: SenderSafetyLevel,
  customMessage?: string
): SenderBannedPayload {
  const base =
    customMessage ||
    `Sender terdeteksi ${reason.toUpperCase()}. Koneksi diputus otomatis. ` +
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

export function renderSafetyPanel(state: AntiBanState, senderId?: string): string {
  const label: Record<SenderSafetyLevel, string> = {
    safe: 'AMAN',
    warning: 'WASPADA',
    danger: 'BAHAYA',
    critical: 'KRITIS'
  }
  const lines = [
    '╔══════════════════════════════════════════════╗',
    '║        PANEL ANTI-BAN SENDER                 ║',
    '╠══════════════════════════════════════════════╣',
    `║ Sender     : ${(senderId ?? '-').padEnd(31)}║`,
    `║ Status     : ${label[state.level].padEnd(31)}║`,
    `║ Pelanggaran: ${String(state.violations).padEnd(31)}║`,
    `║ Alasan     : ${(state.lastReason ?? '-').slice(0, 31).padEnd(31)}║`,
    `║ Terakhir   : ${
      state.lastViolationAt
        ? new Date(state.lastViolationAt).toISOString().slice(0, 19).replace('T', ' ')
        : '-'
    }`.padEnd(46) + '║',
    '╚══════════════════════════════════════════════╝'
  ]
  return lines.join('\n')
}

export class AntiBanSender {
  private state: AntiBanState = createInitialState()
  private onBan?: (payload: SenderBannedPayload) => void
  private onLevelChange?: (level: SenderSafetyLevel, state: AntiBanState) => void
  private ended = false

  constructor(
    private readonly senderId: string,
    private readonly endSocket: (reason: string) => void,
    opts?: {
      onBan?: (payload: SenderBannedPayload) => void
      onLevelChange?: (level: SenderSafetyLevel, state: AntiBanState) => void
    }
  ) {
    this.onBan = opts?.onBan
    this.onLevelChange = opts?.onLevelChange
  }

  getState(): AntiBanState {
    return { ...this.state }
  }

  getLevel(): SenderSafetyLevel {
    return this.state.level
  }

  inspect(source: string, detail: any, statusCode?: number): SenderBannedPayload | null {
    if (this.ended) return null

    const { hit, keyword } = isBanSignal(source, detail)
    const codeHit = isBanStatusCode(statusCode)

    if (!hit && !codeHit) return null

    const reason = keyword ?? source ?? `status_${statusCode}`
    this.state.violations += 1
    this.state.lastViolationAt = Date.now()
    this.state.lastReason = reason
    this.state.banned = true
    this.state.level = computeSafetyLevel(
      this.state.violations,
      this.state.lastViolationAt,
      this.state.banned
    )

    const payload = buildSenderBannedPayload(reason, detail, this.state.level)

    console.error('\n' + renderSafetyPanel(this.state, this.senderId) + '\n')
    console.error(payload.message)

    this.onBan?.(payload)
    this.onLevelChange?.(this.state.level, this.getState())

    this.ended = true
    try {
      this.endSocket(reason)
    } catch {}

    return payload
  }

  reset() {
    this.state = createInitialState()
    this.ended = false
  }
}

export function attachAntiBan(
  sock: any,
  senderId: string,
  opts?: {
    onBan?: (payload: SenderBannedPayload) => void
    onLevelChange?: (level: SenderSafetyLevel, state: AntiBanState) => void
    logger?: { info?: Function; warn?: Function; error?: Function }
  }
): AntiBanSender {
  const manager = new AntiBanSender(
    senderId,
    (reason) => {
      try {
        sock.end(new Error(`anti-ban:${reason}`) as any)
      } catch {
        try {
          sock.end(undefined)
        } catch {}
      }
    },
    opts
  )

  const handler = (update: any) => {
    if (!update) return

    const statusCode = update?.lastDisconnect?.error?.output?.statusCode
    if (update?.connection === 'close' && statusCode) {
      const payload = manager.inspect('connection_close', update.lastDisconnect, statusCode)
      if (payload) {
        try {
          sock.ev.emit('connection.update', { ...update, senderBanned: payload })
        } catch {}
      }
    }

    if (update?.streamError) {
      const payload = manager.inspect('stream_error', update.streamError)
      if (payload) {
        try {
          sock.ev.emit('connection.update', { senderBanned: payload })
        } catch {}
      }
    }
  }

  try {
    sock.ev.on('connection.update', handler)
    ;(sock.ev as any).on?.('CB:stream:error', (d: any) => {
      const payload = manager.inspect('stream_error', d)
      if (payload) {
        try {
          sock.ev.emit('connection.update', { senderBanned: payload })
        } catch {}
      }
    })
    ;(sock.ev as any).on?.('CB:failure', (d: any) => {
      const payload = manager.inspect('failure', d)
      if (payload) {
        try {
          sock.ev.emit('connection.update', { senderBanned: payload })
        } catch {}
      }
    })
  } catch {}

  return manager
}
