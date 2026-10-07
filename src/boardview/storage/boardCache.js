const DB_NAME = 'fixio-boardview-cache'
const DB_VERSION = 1
const STORE_NAME = 'files'
const CACHE_ID = 'active'

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponível'))
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Não foi possível abrir o cache local da bancada.'))
})

export async function saveBoardviewCache(value) {
  try {
    const database = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar o boardview localmente.'))
      transaction.objectStore(STORE_NAME).put({ ...value, id: CACHE_ID, savedAt: new Date().toISOString() })
    })
    database.close()
  } catch {
    // O arquivo original continua no computador; se o WebView não oferecer IndexedDB,
    // a bancada apenas não poderá restaurar a última importação automaticamente.
  }
}

export async function loadBoardviewCache() {
  try {
    const database = await openDatabase()
    const value = await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(CACHE_ID)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
    database.close()
    return value
  } catch {
    return null
  }
}

export async function clearBoardviewCache() {
  try {
    const database = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível limpar o cache local da bancada.'))
      transaction.objectStore(STORE_NAME).delete(CACHE_ID)
    })
    database.close()
  } catch {
    // Fechar a placa continua funcionando mesmo quando o WebView não oferece IndexedDB.
  }
}
