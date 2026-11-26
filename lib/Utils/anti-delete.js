/**
 * Anti-Delete / Message Store untuk GrenXKontlV2
 * Fitur untuk menyimpan dan recover deleted messages
 */

import { proto } from '../../WAProto/index.js'

// =====================================================
// MESSAGE STORE CLASS
// =====================================================
export class MessageStore {
  constructor(options = {}) {
    this.store = new Map()
    this.deletedMessages = new Map()
    this.options = {
      maxMessagesPerChat: options.maxMessagesPerChat || 1000,
      ttl: options.ttl || 24 * 60 * 60 * 1000, // 24 hours
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000 // 1 hour
    }

    this.startCleanup()
  }

  startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.options.cleanupInterval)
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
  }

  cleanup() {
    const now = Date.now()
    const cutoff = now - this.options.ttl

    for (const [chatId, messages] of this.store) {
      for (const [msgId, stored] of messages) {
        if (stored.storedAt < cutoff) {
          messages.delete(msgId)
        }
      }
      if (messages.size === 0) {
        this.store.delete(chatId)
      }
    }

    for (const [key, info] of this.deletedMessages) {
      if (info.deletedAt < cutoff) {
        this.deletedMessages.delete(key)
      }
    }
  }

  getKey(key) {
    return `\( {key.remoteJid}: \){key.id}`
  }

  storeMessage(message) {
    const chatId = message.key?.remoteJid
    if (!chatId || !message.key?.id) return

    let chatMessages = this.store.get(chatId)
    if (!chatMessages) {
      chatMessages = new Map()
      this.store.set(chatId, chatMessages)
    }

    // Enforce max messages per chat
    if (chatMessages.size >= this.options.maxMessagesPerChat) {
      const oldestKey = chatMessages.keys().next().value
      if (oldestKey) {
        chatMessages.delete(oldestKey)
      }
    }

    chatMessages.set(message.key.id, {
      message,
      storedAt: Date.now(),
      isDeleted: false
    })
  }

  storeMessages(messages) {
    for (const msg of messages) {
      this.storeMessage(msg)
    }
  }

  getMessage(key) {
    const chatMessages = this.store.get(key.remoteJid)
    if (!chatMessages) return undefined
    return chatMessages.get(key.id)
  }

  getOriginalMessage(key) {
    return this.getMessage(key)?.message
  }

  markAsDeleted(key, deletedBy) {
    const stored = this.getMessage(key)
    if (!stored) return null

    const now = Date.now()
    stored.isDeleted = true
    stored.deletedAt = now
    stored.deletedBy = deletedBy

    const info = {
      originalMessage: stored.message,
      key,
      deletedAt: now,
      deletedBy,
      isRevokedBySender: !deletedBy || deletedBy === stored.message.key?.participant
    }

    this.deletedMessages.set(this.getKey(key), info)
    return info
  }

  getDeletedMessage(key) {
    return this.deletedMessages.get(this.getKey(key))
  }

  getAllDeletedMessages() {
    return Array.from(this.deletedMessages.values())
  }

  getDeletedMessagesByChat(chatId) {
    return Array.from(this.deletedMessages.values())
      .filter(info => info.key.remoteJid === chatId)
  }

  getChatMessages(chatId) {
    const chatMessages = this.store.get(chatId)
    if (!chatMessages) return []
    return Array.from(chatMessages.values()).map(s => s.message)
  }

  getChatIds() {
    return Array.from(this.store.keys())
  }

  getStats() {
    let totalMessages = 0
    for (const messages of this.store.values()) {
      totalMessages += messages.size
    }
    return {
      totalChats: this.store.size,
      totalMessages,
      totalDeleted: this.deletedMessages.size
    }
  }

  clear() {
    this.store.clear()
    this.deletedMessages.clear()
  }

  clearChat(chatId) {
    this.store.delete(chatId)
  }

  getAllMessages() {
    const all = {}
    for (const [chatId, messages] of this.store) {
      all[chatId] = Array.from(messages.values()).map(s => s.message)
    }
    return all
  }
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

export const isDeleteMessage = (message) => {
  const content = message.message
  if (!content) return false
  return content.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE
}

export const getDeletedMessageKey = (message) => {
  const content = message.message
  if (!content) return null

  const protoMsg = content.protocolMessage
  if (protoMsg?.type !== proto.Message.ProtocolMessage.Type.REVOKE) return null
  return protoMsg.key || null
}

/**
 * Create anti-delete handler
 * Pasang ke: sock.ev.on('messages.update', ...)
 */
export const createAntiDeleteHandler = (store) => {
  return (updates) => {
    const deletedMessages = []

    for (const { key, update } of updates) {
      if (update.messageStubType === proto.WebMessageInfo.StubType.REVOKE) {
        const deletedInfo = store.markAsDeleted(key, update.messageStubParameters?.[0])
        if (deletedInfo) {
          deletedMessages.push(deletedInfo)
        }
      }
    }

    return deletedMessages
  }
}

/**
 * Create message store handler
 * Pasang ke: sock.ev.on('messages.upsert', ...)
 */
export const createMessageStoreHandler = (store) => {
  return ({ messages }) => {
    const regularMessages = messages.filter(msg => {
      const content = msg.message
      if (!content) return false
      if (content.protocolMessage) return false
      if (content.senderKeyDistributionMessage) return false
      return true
    })

    store.storeMessages(regularMessages)
  }
}

export default {
  MessageStore,
  isDeleteMessage,
  getDeletedMessageKey,
  createAntiDeleteHandler,
  createMessageStoreHandler
}
