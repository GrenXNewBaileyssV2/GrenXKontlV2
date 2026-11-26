/**
 * presence-tracker.js — GrenX / Baileys fork
 * Path: lib/Utils/presence-tracker.js
 * Tanpa top-level await
 */

import { EventEmitter } from 'events'
import { jidNormalizedUser } from '../WABinary/jid-utils.js'

let defaultTimeZone = '+07:00'
let trackerCounter = 0

export function getDefaultTimezone() {
  return defaultTimeZone
}

export function setDefaultTimezone(zone) {
  defaultTimeZone = zone
}

export const setTimezone = setDefaultTimezone
export const getTimezone = getDefaultTimezone

export function parseTimezone(zone) {
  const tz = zone !== undefined && zone !== null && zone !== '' ? zone : defaultTimeZone
  if (typeof tz === 'number') {
    const sign = tz >= 0 ? '+' : '-'
    const abs = Math.abs(tz)
    const hours = Math.floor(abs)
    const mins = Math.round((abs - hours) * 60)
    return {
      isOffset: true,
      offsetMs: tz * 60 * 60 * 1000,
      label: `UTC\( {sign} \){String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    }
  }
  const str = String(tz).trim()
  const offsetMatch = str.match(/^([+-])?(\d{1,2})(?::?(\d{2}))?$/)
  if (offsetMatch) {
    const sign = offsetMatch[1] === '-' ? -1 : 1
    const hours = parseInt(offsetMatch[2], 10)
    const mins = parseInt(offsetMatch[3] || '0', 10)
    const totalMinutes = sign * (hours * 60 + mins)
    return {
      isOffset: true,
      offsetMs: totalMinutes * 60 * 1000,
      label: `UTC\( {sign >= 0 ? '+' : '-'} \){String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
    }
  }
  return { isOffset: false, offsetMs: 0, ianaZone: str, label: str }
}

export function formatDuration(ms) {
  if (!ms || ms < 0 || isNaN(ms)) return '00:00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `\( {String(hours).padStart(2, '0')}: \){String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatTime(date, zone) {
  if (!date) return 'N/A'
  const d = date instanceof Date ? date : new Date(date > 1e11 ? date : date * 1000)
  const tzInfo = parseTimezone(zone)
  if (tzInfo.isOffset) {
    const target = new Date(d.getTime() + tzInfo.offsetMs)
    return [
      String(target.getUTCHours()).padStart(2, '0'),
      String(target.getUTCMinutes()).padStart(2, '0'),
      String(target.getUTCSeconds()).padStart(2, '0')
    ].join(':')
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tzInfo.ianaZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d)
  } catch {
    return [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0')
    ].join(':')
  }
}

export function formatDateTime(date, zone) {
  if (!date) return 'N/A'
  const d = date instanceof Date ? date : new Date(date > 1e11 ? date : date * 1000)
  const tzInfo = parseTimezone(zone)
  if (tzInfo.isOffset) {
    const t = new Date(d.getTime() + tzInfo.offsetMs)
    return `\( {t.getUTCFullYear()}- \){String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} \( {String(t.getUTCHours()).padStart(2, '0')}: \){String(t.getUTCMinutes()).padStart(2, '0')}:${String(t.getUTCSeconds()).padStart(2, '0')}`
  }
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tzInfo.ianaZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d).replace(/,/, '')
  } catch {
    return d.toLocaleString()
  }
}

export function formatTimeAgo(date) {
  if (!date) return 'N/A'
  const time = date instanceof Date ? date.getTime() : date > 1e11 ? date : date * 1000
  const diffMs = Date.now() - time
  if (diffMs < 0) return 'just now'
  const s = Math.floor(diffMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function normalizeContactJid(jid) {
  if (!jid || typeof jid !== 'string') return ''
  let clean = jid.trim()
  if (clean.endsWith('@whatsapp.net')) clean = clean.replace('@whatsapp.net', '@s.whatsapp.net')
  else if (clean.endsWith('@c.us')) clean = clean.replace('@c.us', '@s.whatsapp.net')
  else if (!clean.includes('@')) clean = `${clean}@s.whatsapp.net`
  if (clean.endsWith('@s.whatsapp.net')) clean = clean.replace(/^\+/, '')
  return jidNormalizedUser(clean) || clean
}

export function isOnlinePresence(presence) {
  return (
    presence === 'available' ||
    presence === 'composing' ||
    presence === 'recording' ||
    presence === 'paused'
  )
}

export function isOfflinePresence(presence) {
  return presence === 'unavailable'
}

export class PresenceTracker extends EventEmitter {
  constructor(sock, targetsOrOptions, options) {
    super()
    this.sock = sock
    this.trackerId = `pt-\( {Date.now().toString(36)}- \){++trackerCounter}`
    this.monitoredJids = new Set()
    this.activeSubscribedJids = new Set()
    this.inFlightSubscriptions = new Map()
    this.inFlightLidLookups = new Map()
    this.contactStates = new Map()
    this.aliasMap = new Map()
    this.lockedJids = new Set()
    this.isDestroyed = false
    this.isConnected = true
    this.listenersAttached = false
    this.resubscribeInProgress = false
    this.opSeq = 0
    this.diagnosticHistory = []
    this.maxDiagnosticHistory = 200

    let resolvedOptions = {}
    let initialTargets
    if (typeof targetsOrOptions === 'string' || Array.isArray(targetsOrOptions)) {
      initialTargets = targetsOrOptions
      resolvedOptions = options || {}
    } else if (targetsOrOptions) {
      resolvedOptions = targetsOrOptions
    }

    this.hasCustomLogger = !!resolvedOptions.logger
    this.timeZone =
      resolvedOptions.timeZone ?? resolvedOptions.timezone ?? defaultTimeZone

    const envDebug =
      typeof process !== 'undefined' && process?.env?.BAILEYS_PRESENCE_DEBUG === '1'

    this.options = {
      logToConsole: resolvedOptions.logToConsole !== false,
      autoResubscribe: resolvedOptions.autoResubscribe !== false,
      resolveLid: resolvedOptions.resolveLid !== false,
      trackMessagesAsPresence: resolvedOptions.trackMessagesAsPresence !== false,
      resubscribeIntervalMs:
        resolvedOptions.resubscribeIntervalMs !== undefined
          ? resolvedOptions.resubscribeIntervalMs
          : 0,
      announceAvailable: resolvedOptions.announceAvailable === true,
      diagnosticLogging:
        resolvedOptions.diagnosticLogging !== undefined
          ? resolvedOptions.diagnosticLogging
          : this.hasCustomLogger || envDebug,
      onDiagnostic: resolvedOptions.onDiagnostic,
      timeZone: this.timeZone,
      timezone: this.timeZone,
      logger: resolvedOptions.logger || console
    }

    this.isConnected = this.sock?.ws ? this.sock.ws.isOpen !== false : true

    this.boundPresenceUpdate = this.handlePresenceUpdate.bind(this)
    this.boundConnectionUpdate = this.handleConnectionUpdate.bind(this)
    this.boundLidMappingUpdate = this.handleLidMappingUpdate.bind(this)
    this.boundChatsLock = this.handleChatsLock.bind(this)
    this.boundChatsUpdate = this.handleChatsUpdate.bind(this)
    if (this.options.trackMessagesAsPresence) {
      this.boundMessagesUpsert = this.handleMessagesUpsert.bind(this)
    }

    this.attachSocketListeners()
    this.startResubscribeTimer()

    if (initialTargets) {
      this.subscribe(initialTargets).catch(err => {
        this.options.logger?.error?.({ err }, 'Failed initial presence subscription')
      })
    }
  }

  nextOpId(prefix) {
    return `\( {prefix}- \){this.trackerId}-${++this.opSeq}`
  }

  getSocketState() {
    const ws = this.sock?.ws
    return {
      isConnected: this.isConnected,
      hasWs: !!ws,
      ...(ws
        ? {
            wsIsOpen: !!ws.isOpen,
            wsIsConnecting: !!ws.isConnecting,
            wsIsClosing: !!ws.isClosing,
            wsIsClosed: !!ws.isClosed
          }
        : {})
    }
  }

  isSocketOpen() {
    if (this.isDestroyed || !this.isConnected || !this.sock) return false
    if (this.sock.ws) return !!this.sock.ws.isOpen
    return true
  }

  recordDiagnostic(level, event, fields = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      trackerId: this.trackerId,
      operationId: fields.operationId || this.nextOpId('op'),
      level,
      event,
      ...fields
    }
    this.diagnosticHistory.push(entry)
    if (this.diagnosticHistory.length > this.maxDiagnosticHistory) {
      this.diagnosticHistory.shift()
    }
    try {
      this.options.onDiagnostic?.(entry)
    } catch {}
    if (this.listenerCount('diagnostic') > 0) {
      this.safeEmit('diagnostic', entry, entry.operationId)
    }
    if (this.options.diagnosticLogging) {
      const logFn = this.options.logger?.[level] || this.options.logger?.info
      try {
        logFn?.call(this.options.logger, entry, `[PresenceTracker] ${event}`)
      } catch {}
    }
    return entry
  }

  safeEmit(event, payload, operationId) {
    const listeners = this.rawListeners(event)
    if (!listeners.length) return false
    for (const listener of listeners) {
      try {
        listener.call(this, payload)
      } catch (err) {
        if (event !== 'diagnostic') {
          this.recordDiagnostic('error', 'presence_listener_exception', {
            operationId: operationId || this.nextOpId('emit-err'),
            contactJid: payload?.jid,
            errorMessage: err?.message || String(err)
          })
        }
      }
    }
    return true
  }

  isContactLocked(jid) {
    const norm = normalizeContactJid(jid)
    if (!norm) return false
    if (this.lockedJids.has(norm)) return true
    const alias = this.aliasMap.get(norm)
    if (alias && this.lockedJids.has(alias)) return true
    const state = this.contactStates.get(norm)
    if (state?.isLocked) return true
    try {
      if (this.sock?.isChatLocked?.(norm)) return true
      if (alias && this.sock?.isChatLocked?.(alias)) return true
    } catch {}
    return false
  }

  attachSocketListeners() {
    if (this.listenersAttached || !this.sock?.ev) return
    this.listenersAttached = true
    this.sock.ev.on('presence.update', this.boundPresenceUpdate)
    this.sock.ev.on('connection.update', this.boundConnectionUpdate)
    this.sock.ev.on('chats.lock', this.boundChatsLock)
    this.sock.ev.on('chats.update', this.boundChatsUpdate)
    if (this.boundLidMappingUpdate) {
      this.sock.ev.on('lid-mapping.update', this.boundLidMappingUpdate)
    }
    if (this.boundMessagesUpsert) {
      this.sock.ev.on('messages.upsert', this.boundMessagesUpsert)
    }
  }

  detachSocketListeners() {
    if (!this.listenersAttached || !this.sock?.ev) return
    this.listenersAttached = false
    this.sock.ev.off('presence.update', this.boundPresenceUpdate)
    this.sock.ev.off('connection.update', this.boundConnectionUpdate)
    this.sock.ev.off('chats.lock', this.boundChatsLock)
    this.sock.ev.off('chats.update', this.boundChatsUpdate)
    if (this.boundLidMappingUpdate) {
      this.sock.ev.off('lid-mapping.update', this.boundLidMappingUpdate)
    }
    if (this.boundMessagesUpsert) {
      this.sock.ev.off('messages.upsert', this.boundMessagesUpsert)
    }
  }

  startResubscribeTimer() {
    this.stopResubscribeTimer()
    if (
      this.isDestroyed ||
      !this.options.autoResubscribe ||
      !(this.options.resubscribeIntervalMs > 0)
    ) {
      return
    }
    if (!this.isSocketOpen()) return
    this.resubscribeTimer = setInterval(() => {
      if (this.isDestroyed || !this.isSocketOpen()) return
      this.resubscribeAll('periodic_heartbeat').catch(() => {})
    }, this.options.resubscribeIntervalMs)
    this.resubscribeTimer?.unref?.()
  }

  stopResubscribeTimer() {
    if (this.resubscribeTimer) {
      clearInterval(this.resubscribeTimer)
      this.resubscribeTimer = undefined
    }
  }

  getDiagnostics() {
    return this.diagnosticHistory.slice()
  }

  getTrackerId() {
    return this.trackerId
  }

  reattach(newSock) {
    if (this.isDestroyed || !newSock?.ev) return
    this.stopResubscribeTimer()
    this.detachSocketListeners()
    this.activeSubscribedJids.clear()
    this.inFlightSubscriptions.clear()
    this.inFlightLidLookups.clear()
    this.sock = newSock
    this.isConnected = this.sock.ws ? this.sock.ws.isOpen !== false : true
    this.attachSocketListeners()
    if (this.isSocketOpen() && this.options.autoResubscribe) {
      this.startResubscribeTimer()
      if (this.monitoredJids.size > 0) {
        this.resubscribeAll('socket_reattached').catch(() => {})
      }
    }
  }

  linkAliases(jidA, jidB) {
    const normA = normalizeContactJid(jidA)
    const normB = normalizeContactJid(jidB)
    if (!normA || !normB || normA === normB) return
    const isA_Lid = normA.endsWith('@lid')
    const isB_Lid = normB.endsWith('@lid')
    const isA_Pn = normA.endsWith('@s.whatsapp.net')
    const isB_Pn = normB.endsWith('@s.whatsapp.net')
    if (!((isA_Lid && isB_Pn) || (isB_Lid && isA_Pn))) return

    const pn = isA_Pn ? normA : normB
    const lid = isA_Lid ? normA : normB
    this.aliasMap.set(lid, pn)
    this.aliasMap.set(pn, lid)

    let state = this.contactStates.get(pn)
    if (!state) {
      state = {
        jid: pn,
        lid,
        currentStatus: 'unknown',
        sessions: []
      }
      this.contactStates.set(pn, state)
    } else {
      state.lid = lid
    }
    this.contactStates.set(lid, state)
    if (this.monitoredJids.has(pn)) this.monitoredJids.add(lid)
    else if (this.monitoredJids.has(lid)) this.monitoredJids.add(pn)
  }

  resolveCanonicalJid(jid) {
    const norm = normalizeContactJid(jid)
    if (!norm) return undefined
    if (norm.endsWith('@lid')) {
      const mappedPn = this.aliasMap.get(norm)
      if (mappedPn && this.contactStates.has(mappedPn)) return mappedPn
    }
    if (this.contactStates.has(norm)) return norm
    const alias = this.aliasMap.get(norm)
    if (alias && this.contactStates.has(alias)) return alias
    return this.monitoredJids.has(norm) ? norm : undefined
  }

  async subscribeTarget(targetJid, operationId, force = false) {
    const normalized = normalizeContactJid(targetJid)
    if (!normalized || this.isDestroyed) return
    if (!this.isSocketOpen()) return
    if (!force && this.activeSubscribedJids.has(normalized)) return

    const existing = this.inFlightSubscriptions.get(normalized)
    if (existing) {
      await existing
      return
    }

    const subPromise = (async () => {
      try {
        await this.sock.presenceSubscribe(normalized)
        if (!this.isDestroyed && this.isConnected) {
          this.activeSubscribedJids.add(normalized)
        }
      } catch (err) {
        this.options.logger?.debug?.(
          { err, jid: normalized },
          'Failed presence subscribe'
        )
      }
    })()

    this.inFlightSubscriptions.set(normalized, subPromise)
    try {
      await subPromise
    } finally {
      if (this.inFlightSubscriptions.get(normalized) === subPromise) {
        this.inFlightSubscriptions.delete(normalized)
      }
    }
  }

  collectUniqueTargets(jids) {
    const unique = new Set()
    for (const raw of jids) {
      const normalized = normalizeContactJid(raw)
      if (!normalized) continue
      unique.add(normalized)
      const alias = this.aliasMap.get(normalized)
      if (alias) unique.add(alias)
      const state = this.contactStates.get(normalized)
      if (state?.lid) unique.add(state.lid)
    }
    return Array.from(unique)
  }

  async subscribe(jid) {
    if (this.isDestroyed) return
    if (
      this.options.announceAvailable &&
      this.isSocketOpen() &&
      typeof this.sock.sendPresenceUpdate === 'function'
    ) {
      try {
        await this.sock.sendPresenceUpdate('available')
      } catch {}
    }

    const jids = Array.isArray(jid) ? jid : [jid]
    const seen = new Set()
    for (const rawJid of jids) {
      if (this.isDestroyed) return
      const normalized = normalizeContactJid(rawJid)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      this.monitoredJids.add(normalized)

      if (!this.contactStates.get(normalized)) {
        this.contactStates.set(normalized, {
          jid: normalized,
          currentStatus: 'unknown',
          sessions: []
        })
      }

      await this.subscribeTarget(normalized, this.nextOpId('sub'), false)
      const state = this.contactStates.get(normalized)
      if (state?.lid && state.lid !== normalized) {
        await this.subscribeTarget(state.lid, this.nextOpId('sub'), false)
      }
    }
  }

  async resubscribe(jid) {
    if (this.isDestroyed) return
    const normalized = normalizeContactJid(jid)
    if (!normalized) return
    const targets = this.collectUniqueTargets([normalized])
    for (const target of targets) {
      if (this.isDestroyed || !this.isSocketOpen()) break
      await this.subscribeTarget(target, this.nextOpId('resub'), true)
    }
  }

  async resubscribeAll() {
    if (this.isDestroyed || !this.isSocketOpen() || this.resubscribeInProgress) return
    this.resubscribeInProgress = true
    try {
      const targets = this.collectUniqueTargets(this.monitoredJids)
      for (const target of targets) {
        if (this.isDestroyed || !this.isSocketOpen()) break
        await this.subscribeTarget(target, this.nextOpId('resub-all'), true)
      }
    } finally {
      this.resubscribeInProgress = false
    }
  }

  unsubscribe(jid) {
    const jids = Array.isArray(jid) ? jid : [jid]
    for (const rawJid of jids) {
      const normalized = normalizeContactJid(rawJid)
      if (!normalized) continue
      const alias = this.aliasMap.get(normalized)
      this.monitoredJids.delete(normalized)
      this.activeSubscribedJids.delete(normalized)
      if (alias) {
        this.monitoredJids.delete(alias)
        this.activeSubscribedJids.delete(alias)
      }
    }
  }

  getStatus(jid) {
    const canonical = this.resolveCanonicalJid(jid)
    return canonical ? this.contactStates.get(canonical) : undefined
  }

  getAllStatuses() {
    const unique = new Map()
    for (const [, state] of this.contactStates) {
      if (!unique.has(state.jid)) unique.set(state.jid, state)
    }
    return unique
  }

  getMonitoredJids() {
    return Array.from(this.monitoredJids)
  }

  setTimezone(zone) {
    this.timeZone = zone
    this.options.timeZone = zone
    this.options.timezone = zone
  }

  getTimezone() {
    return this.timeZone
  }

  formatTime(date) {
    return formatTime(date, this.timeZone)
  }

  formatDateTime(date) {
    return formatDateTime(date, this.timeZone)
  }

  formatTimeAgo(date) {
    return formatTimeAgo(date)
  }

  destroy() {
    if (this.isDestroyed) return
    this.isDestroyed = true
    this.isConnected = false
    this.detachSocketListeners()
    this.stopResubscribeTimer()
    this.monitoredJids.clear()
    this.activeSubscribedJids.clear()
    this.inFlightSubscriptions.clear()
    this.inFlightLidLookups.clear()
    this.lockedJids.clear()
    this.removeAllListeners()
  }

  stop() {
    this.destroy()
  }

  async start() {}

  getState(jid) {
    if (jid) return this.getStatus(jid)
    const obj = {}
    for (const [k, v] of this.getAllStatuses()) obj[k] = v
    return obj
  }

  getSession(jid) {
    const state = this.getStatus(jid)
    if (!state?.sessions?.length) return null
    return state.sessions[state.sessions.length - 1]
  }

  getSessions(jid) {
    if (jid) return this.getStatus(jid)?.sessions || []
    const all = []
    const seen = new Set()
    for (const state of this.contactStates.values()) {
      if (seen.has(state)) continue
      seen.add(state)
      all.push(...state.sessions)
    }
    return all
  }

  isMonitoring(jid) {
    const norm = normalizeContactJid(jid)
    if (!norm) return false
    if (this.monitoredJids.has(norm)) return true
    const alias = this.aliasMap.get(norm)
    return !!alias && this.monitoredJids.has(alias)
  }

  handleLidMappingUpdate(mapping) {
    if (this.isDestroyed || !mapping?.lid || !mapping?.pn) return
    const pn = normalizeContactJid(mapping.pn)
    const lid = normalizeContactJid(mapping.lid)
    this.linkAliases(pn, lid)
    if (
      this.isMonitoring(pn) &&
      !this.activeSubscribedJids.has(lid) &&
      this.isSocketOpen()
    ) {
      this.subscribeTarget(lid, this.nextOpId('lid-map'), false).catch(() => {})
    }
  }

  handleConnectionUpdate(update) {
    if (this.isDestroyed || !update?.connection) return
    const { connection } = update
    if (connection === 'close') {
      this.isConnected = false
      this.activeSubscribedJids.clear()
      this.stopResubscribeTimer()
      return
    }
    if (connection === 'connecting') {
      this.isConnected = false
      this.stopResubscribeTimer()
      return
    }
    if (connection === 'open') {
      this.isConnected = true
      if (this.options.autoResubscribe) {
        this.startResubscribeTimer()
        if (this.monitoredJids.size > 0) {
          this.resubscribeAll('connection_open').catch(() => {})
        }
      }
    }
  }

  handleMessagesUpsert({ messages }) {
    if (!messages || this.isDestroyed) return
    for (const msg of messages) {
      if (!msg || msg.key?.fromMe) continue
      const remoteJid = normalizeContactJid(msg.key?.remoteJid || '')
      const altJid = normalizeContactJid(msg.key?.remoteJidAlt || '')
      const participant = normalizeContactJid(msg.key?.participant || '')
      const participantAlt = normalizeContactJid(msg.key?.participantAlt || '')
      if (remoteJid && altJid) this.linkAliases(remoteJid, altJid)
      if (participant && participantAlt) this.linkAliases(participant, participantAlt)
      for (const c of [remoteJid, altJid, participant, participantAlt].filter(Boolean)) {
        const canonical = this.resolveCanonicalJid(c)
        if (canonical && this.isMonitoring(canonical)) {
          this.processContactPresence(canonical, { lastKnownPresence: 'available' })
          break
        }
      }
    }
  }

  updateContactLockState(rawJid, locked) {
    const norm = normalizeContactJid(rawJid)
    if (!norm) return
    if (locked) this.lockedJids.add(norm)
    else this.lockedJids.delete(norm)
    const alias = this.aliasMap.get(norm)
    if (alias) {
      if (locked) this.lockedJids.add(alias)
      else this.lockedJids.delete(alias)
    }
    const canonical = this.resolveCanonicalJid(norm)
    if (canonical && this.isMonitoring(canonical)) {
      const state = this.contactStates.get(canonical)
      if (state) state.isLocked = locked
    }
  }

  handleChatsLock(update) {
    if (this.isDestroyed || !update?.id || typeof update.locked !== 'boolean') return
    this.updateContactLockState(update.id, update.locked)
  }

  handleChatsUpdate(updates) {
    if (this.isDestroyed || !Array.isArray(updates)) return
    for (const u of updates) {
      if (u?.id && typeof u.locked === 'boolean') {
        this.updateContactLockState(u.id, u.locked)
      }
    }
  }

  handlePresenceUpdate(update) {
    if (this.isDestroyed || !update?.presences) return
    const { id, presences } = update
    for (const [participant, data] of Object.entries(presences)) {
      if (!data) continue
      const normParticipant = normalizeContactJid(participant)
      const normId = normalizeContactJid(id)
      const matchedJid =
        this.resolveCanonicalJid(normParticipant) || this.resolveCanonicalJid(normId)
      if (!matchedJid || !this.isMonitoring(matchedJid)) continue
      this.processContactPresence(matchedJid, data)
    }
  }

  processContactPresence(jid, data) {
    let state = this.contactStates.get(jid)
    if (!state) {
      state = { jid, currentStatus: 'unknown', sessions: [] }
      this.contactStates.set(jid, state)
    }

    const previousStatus = state.currentStatus
    const previousPresence = state.lastKnownPresence
    const rawPresence = data.lastKnownPresence
    const rawLastSeen = data.lastSeen
    const hasExplicitLastSeen =
      typeof rawLastSeen === 'number' && !isNaN(rawLastSeen) && rawLastSeen > 0

    if (hasExplicitLastSeen) {
      const ms = rawLastSeen > 1e11 ? rawLastSeen : rawLastSeen * 1000
      state.serverLastSeen = new Date(ms)
      state.serverLastSeenTimestamp = ms
      state.lastSeenTimestamp = ms
      state.lastSeen = state.serverLastSeen
    }

    if (isOnlinePresence(rawPresence)) {
      if (state.currentStatus === 'online') {
        state.lastKnownPresence = rawPresence
        if (previousPresence !== rawPresence && rawPresence) {
          this.safeEmit('chatstate', {
            jid: state.jid,
            lid: state.lid,
            status: 'online',
            previousPresence,
            rawPresence,
            timestamp: new Date()
          })
        }
        return
      }

      const now = new Date()
      state.currentStatus = 'online'
      state.currentSessionStart = now
      state.lastOnlineAt = now
      state.lastOnlineAtFormatted = this.formatDateTime(now)
      state.lastKnownPresence = rawPresence
      state.lastSeenTimestamp = now.getTime()
      state.lastSeen = now
      state.lastSeenFormatted = this.formatDateTime(now)

      if (this.options.logToConsole) {
        console.log(`[Presence] ${state.jid} ONLINE at ${this.formatTime(now)}`)
      }

      const eventData = {
        jid: state.jid,
        lid: state.lid,
        status: 'online',
        onlineAt: now,
        rawPresence,
        ...(state.lastSeen
          ? { lastSeen: state.lastSeen, lastSeenTimestamp: state.lastSeenTimestamp }
          : {})
      }
      this.safeEmit('online', eventData)
      this.safeEmit('presence', eventData)
    } else if (isOfflinePresence(rawPresence)) {
      if (state.currentStatus === 'offline') {
        state.lastKnownPresence = rawPresence
        return
      }

      if (state.currentStatus === 'online' && state.currentSessionStart) {
        const now = new Date()
        const onlineAt = state.currentSessionStart
        const offlineAt = now
        const durationMs = Math.max(0, offlineAt.getTime() - onlineAt.getTime())
        const duration = formatDuration(durationMs)
        const session = { onlineAt, offlineAt, durationMs, duration }

        state.sessions.push(session)
        state.currentStatus = 'offline'
        state.currentSessionStart = undefined
        state.lastOfflineAt = offlineAt
        state.lastOfflineAtFormatted = this.formatDateTime(offlineAt)
        state.lastDurationMs = durationMs
        state.lastDuration = duration
        state.lastKnownPresence = rawPresence
        if (!hasExplicitLastSeen) {
          state.lastSeenTimestamp = offlineAt.getTime()
          state.lastSeen = offlineAt
        }
        state.lastSeenFormatted = state.lastSeen
          ? this.formatDateTime(state.lastSeen)
          : undefined

        if (this.options.logToConsole) {
          console.log(`[Presence] ${state.jid} OFFLINE duration ${duration}`)
        }

        const eventData = {
          jid: state.jid,
          lid: state.lid,
          status: 'offline',
          onlineAt,
          offlineAt,
          duration,
          rawPresence,
          ...(state.lastSeen
            ? { lastSeen: state.lastSeen, lastSeenTimestamp: state.lastSeenTimestamp }
            : {})
        }
        this.safeEmit('offline', eventData)
        this.safeEmit('session', { ...session, jid: state.jid })
        this.safeEmit('presence', eventData)
      } else {
        state.currentStatus = 'offline'
        state.lastKnownPresence = rawPresence
        if (!hasExplicitLastSeen && !state.lastOfflineAt) {
          state.lastOfflineAt = state.lastSeen || new Date()
        } else if (state.lastSeen) {
          state.lastOfflineAt = state.lastSeen
        }
        const eventData = {
          jid: state.jid,
          lid: state.lid,
          status: 'offline',
          rawPresence,
          ...(state.lastOfflineAt ? { offlineAt: state.lastOfflineAt } : {}),
          ...(state.lastSeen
            ? { lastSeen: state.lastSeen, lastSeenTimestamp: state.lastSeenTimestamp }
            : {})
        }
        this.safeEmit('offline', eventData)
        this.safeEmit('presence', eventData)
      }
    }
  }
}

export function monitorPresence(sock, jid, options) {
  const tracker = new PresenceTracker(sock, options)
  if (jid) {
    tracker.subscribe(jid).catch(err => {
      options?.logger?.error?.({ err }, 'Failed initial presence subscription')
    })
  }
  return tracker
}

export const createPresenceTracker = monitorPresence
export const PresenceMonitor = PresenceTracker

export default {
  getDefaultTimezone,
  setDefaultTimezone,
  setTimezone,
  getTimezone,
  parseTimezone,
  formatDuration,
  formatTime,
  formatDateTime,
  formatTimeAgo,
  normalizeContactJid,
  isOnlinePresence,
  isOfflinePresence,
  PresenceTracker,
  PresenceMonitor,
  monitorPresence,
  createPresenceTracker
}
