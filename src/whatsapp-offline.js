const DB_NAME = 'fixio-whatsapp-cache'
const DB_VERSION = 1
const FALLBACK_KEY = 'fixio.whatsapp.offline.v1'

const readFallback = () => {
  try {
    const value = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}')
    return {
      conversations: Array.isArray(value.conversations) ? value.conversations : [],
      messages: Array.isArray(value.messages) ? value.messages : [],
      outbox: Array.isArray(value.outbox) ? value.outbox : [],
    }
  } catch {
    return { conversations: [], messages: [], outbox: [] }
  }
}

const writeFallback = value => {
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(value)) } catch {}
}

const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Não foi possível acessar o cache local do WhatsApp.'))
})

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponível'))
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains('conversations')) database.createObjectStore('conversations', { keyPath: 'id' })
    if (!database.objectStoreNames.contains('messages')) {
      const messages = database.createObjectStore('messages', { keyPath: 'key' })
      messages.createIndex('conversation_id', 'conversation_id', { unique: false })
    }
    if (!database.objectStoreNames.contains('outbox')) database.createObjectStore('outbox', { keyPath: 'id' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Não foi possível abrir o cache local do WhatsApp.'))
})

const getAll = (database, name) => requestResult(database.transaction(name, 'readonly').objectStore(name).getAll())

const runWrite = (name, action) => openDatabase().then(database => new Promise((resolve, reject) => {
  const transaction = database.transaction(name, 'readwrite')
  transaction.oncomplete = () => { database.close(); resolve() }
  transaction.onerror = () => { database.close(); reject(transaction.error || new Error('Não foi possível salvar o cache local do WhatsApp.')) }
  action(transaction.objectStore(name))
}))

const snapshotFromRows = (conversations, messages, outbox) => {
  const grouped = {}
  for (const message of messages) {
    const conversationId = String(message.conversation_id)
    if (!grouped[conversationId]) grouped[conversationId] = []
    grouped[conversationId].push(message)
  }
  return {
    conversations,
    messages: grouped,
    outbox,
  }
}

export async function loadWhatsappOfflineSnapshot() {
  try {
    const database = await openDatabase()
    const [conversations, messages, outbox] = await Promise.all([getAll(database, 'conversations'), getAll(database, 'messages'), getAll(database, 'outbox')])
    database.close()
    return snapshotFromRows(conversations, messages, outbox)
  } catch {
    const fallback = readFallback()
    return snapshotFromRows(fallback.conversations, fallback.messages, fallback.outbox)
  }
}

export async function saveWhatsappConversations(rows) {
  const conversations = Array.isArray(rows) ? rows : []
  try {
    await runWrite('conversations', store => conversations.forEach(row => store.put(row)))
  } catch {
    const fallback = readFallback()
    const byId = new Map(fallback.conversations.map(row => [String(row.id), row]))
    conversations.forEach(row => byId.set(String(row.id), row))
    writeFallback({ ...fallback, conversations: [...byId.values()] })
  }
}

export async function saveWhatsappMessages(conversationId, rows) {
  const id = String(conversationId)
  const messages = (Array.isArray(rows) ? rows : []).map(message => ({ ...message, conversation_id: message.conversation_id ?? conversationId, key: `${id}:${message.id}` }))
  try {
    await runWrite('messages', store => {
      const cursorRequest = store.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          if (String(cursor.value.conversation_id) === id) cursor.delete()
          cursor.continue()
          return
        }
        messages.forEach(message => store.put(message))
      }
    })
  } catch {
    const fallback = readFallback()
    const retained = fallback.messages.filter(message => String(message.conversation_id) !== id)
    writeFallback({ ...fallback, messages: [...retained, ...messages] })
  }
}

export async function saveWhatsappOutbox(record) {
  try {
    await runWrite('outbox', store => store.put(record))
  } catch {
    const fallback = readFallback()
    writeFallback({ ...fallback, outbox: [...fallback.outbox.filter(item => item.id !== record.id), record] })
  }
}

export async function removeWhatsappOutbox(id) {
  try {
    await runWrite('outbox', store => store.delete(id))
  } catch {
    const fallback = readFallback()
    writeFallback({ ...fallback, outbox: fallback.outbox.filter(item => item.id !== id) })
  }
}
