const DB_NAME = 'hometube-local'
const DB_VERSION = 2

let dbPromise = null

function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = (event) => {
        const db = event.target.result
        const stores = ['users', 'channels', 'subscriptions', 'videos', 'music', 'playlists', 'settings']
        stores.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id', autoIncrement: true })
          }
        })
        if (!db.objectStoreNames.contains('files')) {
          const fileStore = db.createObjectStore('files', { keyPath: 'id' })
          fileStore.createIndex('type', 'type', { unique: false })
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

export const LocalDB = {
  async getAll(storeName) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  },

  async get(storeName, id) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  },

  async store(storeName, records) {
    if (!Array.isArray(records)) records = [records]
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      records.forEach(r => store.put(r))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },

  async delete(storeName, id) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },

  async storeFile(id, type, blob, metadata = {}) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')
      store.put({ id, type, blob, ...metadata })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },

  async getFile(id) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const store = tx.objectStore('files')
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  },

  async getFileByTitle(title) {
    const db = await getDb()
    const allFiles = await this.getFilesByType('music')
    const lower = title.toLowerCase()
    for (const f of allFiles) {
      if (f.filename && f.filename.toLowerCase().includes(lower)) return f
    }
    return null
  },

  async getFilesByType(type) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const store = tx.objectStore('files')
      const index = store.index('type')
      const request = index.getAll(type)
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  },

  async setMeta(key, value) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite')
      const store = tx.objectStore('meta')
      store.put({ key, value })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  },

  async getMeta(key) {
    const db = await getDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly')
      const store = tx.objectStore('meta')
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result?.value)
      request.onerror = () => reject(request.error)
    })
  },

  async clearAll() {
    const db = await getDb()
    const storeNames = [...db.objectStoreNames]
    return Promise.all(storeNames.map(name => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite')
        const store = tx.objectStore(name)
        store.clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    }))
  },

  async hasLocalData() {
    try {
      const videos = await this.getAll('videos')
      const music = await this.getAll('music')
      return videos.length > 0 || music.length > 0
    } catch {
      return false
    }
  }
}
