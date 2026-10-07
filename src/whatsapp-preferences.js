const MUTED_KEY = 'fixio.whatsapp.muted.v1'
const CLEARED_KEY = 'fixio.whatsapp.cleared.v1'

export function loadMutedWhatsappConversations() {
  try {
    const value = JSON.parse(localStorage.getItem(MUTED_KEY) || '[]')
    return new Set(Array.isArray(value) ? value.map(item => String(item)) : [])
  } catch {
    return new Set()
  }
}

export function saveMutedWhatsappConversations(ids) {
  try { localStorage.setItem(MUTED_KEY, JSON.stringify([...ids].map(String))) } catch {}
}

export function loadClearedWhatsappConversations() {
  try {
    const value = JSON.parse(localStorage.getItem(CLEARED_KEY) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).map(([id, timestamp]) => [String(id), String(timestamp)]).filter(([, timestamp]) => timestamp))
  } catch {
    return {}
  }
}

export function markWhatsappConversationCleared(conversationId, timestamp = new Date().toISOString()) {
  const current = loadClearedWhatsappConversations()
  current[String(conversationId)] = timestamp
  try { localStorage.setItem(CLEARED_KEY, JSON.stringify(current)) } catch {}
  return current
}

export function whatsappNotificationConversationId(value) {
  return String(value?.conversation_id ?? value?.conversationId ?? value?.conversation?.id ?? value?.id ?? '').trim()
}

export function isWhatsappConversationMuted(value, ids) {
  const id = typeof value === 'object' ? whatsappNotificationConversationId(value) : String(value || '').trim()
  return Boolean(id && ids?.has?.(id))
}
