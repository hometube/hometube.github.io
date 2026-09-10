import { DataProvider } from './DataProvider.js'
import JSZip from 'jszip'

const BASE = import.meta.env.VITE_API_BASE || '/api'
const BASE_HEADERS = { 'ngrok-skip-browser-warning': 'true' }

let swReadyResolve = null
let swReadyFlag = false
const swReady = new Promise(resolve => {
  swReadyResolve = resolve
  if (!('serviceWorker' in navigator)) {
    resolve()
    return
  }
  if (navigator.serviceWorker.controller) {
    swReadyFlag = true
    setTimeout(resolve, 100)
  } else {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      swReadyFlag = true
      setTimeout(resolve, 100)
    })
  }
})

const ServiceWorkerInternal = {
  ready: false,
  async sendJWT(token) {
    if (!ServiceWorkerInternal.ready) await swReady
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_JWT', token })
    }
  },
  async sendBackendUrl(url) {
    if (!ServiceWorkerInternal.ready) await swReady
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_BACKEND_URL', url })
    }
  },
  async sendCacheRule(path, options) {
    if (!ServiceWorkerInternal.ready) await swReady
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_CACHE_RULE', path, options })
    }
  },
  async checkCache(paths) {
    if (!ServiceWorkerInternal.ready) await swReady
    return new Promise(resolve => {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const channel = new MessageChannel()
        channel.port1.onmessage = event => {
          if (event.data?.type === 'CACHE_STATUS') resolve(event.data.status)
        }
        navigator.serviceWorker.controller.postMessage({ type: 'CHECK_CACHE', paths }, [channel.port2])
      } else {
        resolve({})
      }
    })
  }
}

export const ServerSW = ServiceWorkerInternal

export class ServerProvider extends DataProvider {
  get type() { return 'server' }
  get name() { return 'Backend Server' }
  get sw() { return ServiceWorkerInternal }

  constructor() {
    super()
    this._initSw()
  }

  async _initSw() {
    const jwt = this._getJWT()
    const url = this._getBackendUrl()
    ServiceWorkerInternal.sendJWT(jwt)
    ServiceWorkerInternal.sendBackendUrl(url)

    ServiceWorkerInternal.sendCacheRule('/api/music', { ttl: Infinity, refetch: true })
    ServiceWorkerInternal.sendCacheRule('/api/playlists', { ttl: Infinity, refetch: true })
    ServiceWorkerInternal.sendCacheRule('/api/podcasts', { ttl: Infinity, refetch: true })
  }

  _getJWT() {
    return localStorage.getItem('jwt_token') || ''
  }

  _getQueryToken() {
    const url = localStorage.getItem('backendUrl') || ''
    const params = new URLSearchParams(url.split('?')[1] || '')
    return params.get('token') || ''
  }

  _getBackendUrl() {
    return localStorage.getItem('backendUrl') || ''
  }

  _buildUrl(path, query = {}) {
    const swActive = 'serviceWorker' in navigator && navigator.serviceWorker.controller
    const storedUrl = this._getBackendUrl()
    const hasJwt = !!this._getJWT()

    if (storedUrl && (!swActive || !hasJwt)) {
      const baseUrl = storedUrl.split('?')[0]
      const params = new URLSearchParams()
      Object.entries(query).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') params.append(key, val)
      })
      const qs = params.toString()
      return qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`
    }

    const url = `${BASE}${path}`
    const params = new URLSearchParams()
    Object.entries(query).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') params.append(key, val)
    })
    const qs = params.toString()
    return qs ? `${url}?${qs}` : url
  }

  _getHeaders() {
    const headers = { ...BASE_HEADERS }
    const jwt = this._getJWT()
    const queryToken = this._getQueryToken()
    if (jwt) headers['Authorization'] = `Bearer ${jwt}`
    else if (queryToken) headers['Authorization'] = `Bearer ${queryToken}`
    return headers
  }

  async get(path, query = {}, json = true) {
    await swReady
    const headers = this._getHeaders()
    const res = await fetch(this._buildUrl(path, query), { headers })
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
    return json ? res.json() : res
  }

  async post(path, body = {}) {
    await swReady
    const headers = { ...this._getHeaders(), 'Content-Type': 'application/json' }
    const res = await fetch(this._buildUrl(path), {
      method: 'POST', headers, body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`)
    return res.json()
  }

  async put(path, body = {}) {
    await swReady
    const headers = { ...this._getHeaders(), 'Content-Type': 'application/json' }
    const res = await fetch(this._buildUrl(path), {
      method: 'PUT', headers, body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`)
    return res.json()
  }

  async delete(path) {
    await swReady
    const headers = this._getHeaders()
    const res = await fetch(this._buildUrl(path), { method: 'DELETE', headers })
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`)
    return res.json()
  }

  async exchangeToken(tempToken) {
    const res = await fetch(this._buildUrl('/auth/exchange'), {
      method: 'POST',
      headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tempToken })
    })
    if (!res.ok) throw new Error('Token exchange failed')
    const data = await res.json()
    localStorage.setItem('jwt_token', data.token)
    ServiceWorkerInternal.sendJWT(data.token)
    return data.token
  }

  async ping() {
    try {
      await swReady
      await this.get('/status')
      return true
    } catch {
      return false
    }
  }

  async getVideoUrl(video) {
    const filename = `${video.video_id}.mp4`
    return `/api/files/videos/${filename}`
  }

  async getMusicUrl(song) {
    return `/api/music/${song.id}/file`
  }

  cache(path, options, json = true) {
    ServiceWorkerInternal.sendCacheRule('/api' + path, options)
    return new Promise(resolve => setTimeout(resolve, 100)).then(() => this.get(path, {}, json))
  }

  checkCache(paths) {
    return ServiceWorkerInternal.checkCache(paths)
  }

  downloadFile(url, filename) {
    fetch(url, { headers: this._getHeaders() })
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename
        a.click()
        URL.revokeObjectURL(blobUrl)
      })
      .catch(err => console.error('[ServerProvider] Download failed:', err))
  }

  async getMetadata() {
    await swReady
    const headers = { ...this._getHeaders(), 'Content-Type': 'application/json' }
    const res = await fetch(this._buildUrl('/export'), {
      method: 'POST', headers, body: JSON.stringify({ type: 'all' })
    })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    const blob = await res.blob()
    const zip = await JSZip.loadAsync(blob)
    const metaFile = zip.file('metadata.json')
    const text = await metaFile.async('string')
    return JSON.parse(text)
  }

  async exportData(body = {}) {
    await swReady
    const headers = { ...this._getHeaders(), 'Content-Type': 'application/json' }
    const res = await fetch(this._buildUrl('/export'), {
      method: 'POST', headers, body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`Export failed: ${res.status}`)
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="?(.+?)"?$/)
    const filename = match ? match[1] : `hometube-export.ht`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return filename
  }

  async importData(file) {
    await swReady
    const headers = this._getHeaders()
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(this._buildUrl('/import'), {
      method: 'POST', headers, body: formData
    })
    if (!res.ok) {
      const text = await res.text()
      let detail = `Import failed: ${res.status}`
      try { detail = JSON.parse(text).detail || detail } catch {}
      throw new Error(detail)
    }
    return res.json()
  }
}
