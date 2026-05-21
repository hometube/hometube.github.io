import { DataProvider } from './DataProvider.js'
import { LocalDB } from '../localDb.js'
import JSZip from 'jszip'

const pathToStore = {
  '/users': 'users',
  '/channels': 'channels',
  '/videos': 'videos',
  '/music': 'music',
  '/playlists': 'playlists',
  '/subscriptions': 'subscriptions',
  '/settings': 'settings',
}

export class LocalProvider extends DataProvider {
  get type() { return 'local' }
  get name() { return 'Local Mode' }

  _getBasePath(path) {
    return path.split('?')[0].replace(/\/+$/, '')
  }

  _matchPath(basePath) {
    // Exact match: /users, /videos, etc.
    if (pathToStore[basePath]) {
      return { store: pathToStore[basePath], id: null, action: null }
    }
    // /channels/{id}/videos
    const chanVideos = basePath.match(/^\/channels\/(\d+)\/videos$/)
    if (chanVideos) {
      return { store: 'videos', id: parseInt(chanVideos[1]), action: 'channel_videos' }
    }
    // /videos/info or /music/info
    if (basePath === '/videos/info' || basePath === '/music/info') {
      return { store: null, id: null, action: 'info' }
    }
    // /playlists/{id}/add
    const plAdd = basePath.match(/^\/playlists\/(\d+)\/add$/)
    if (plAdd) return { store: 'playlists', id: parseInt(plAdd[1]), action: 'add_song' }
    // /playlists/{id}/remove/{songId}
    const plRemove = basePath.match(/^\/playlists\/(\d+)\/remove\/(\d+)$/)
    if (plRemove) return { store: 'playlists', id: parseInt(plRemove[1]), action: 'remove_song', extraId: parseInt(plRemove[2]) }
    // /playlists/{id}
    const plById = basePath.match(/^\/playlists\/(\d+)$/)
    if (plById) return { store: 'playlists', id: parseInt(plById[1]), action: 'by_id' }
    // /videos/{id}/watch
    const vWatch = basePath.match(/^\/videos\/(\d+)\/watch$/)
    if (vWatch) return { store: 'videos', id: parseInt(vWatch[1]), action: 'watch' }
    // /videos/{id}/keep
    const vKeep = basePath.match(/^\/videos\/(\d+)\/keep$/)
    if (vKeep) return { store: 'videos', id: parseInt(vKeep[1]), action: 'keep' }
    // /videos/{id}/download
    const vDl = basePath.match(/^\/videos\/(\d+)\/download$/)
    if (vDl) return { store: 'videos', id: parseInt(vDl[1]), action: 'download' }
    // /music/{id}/download
    const mDl = basePath.match(/^\/music\/(\d+)\/download$/)
    if (mDl) return { store: 'music', id: parseInt(mDl[1]), action: 'download' }
    // /music/{id}
    const mById = basePath.match(/^\/music\/(\d+)$/)
    if (mById) return { store: 'music', id: parseInt(mById[1]), action: 'by_id' }
    // /users
    // fallback: try {store}/{id}
    const generic = basePath.match(/^\/(\w+)\/(\d+)/)
    if (generic) {
      const table = `/${generic[1]}`
      if (pathToStore[table]) {
        return { store: pathToStore[table], id: parseInt(generic[2]), action: 'by_id' }
      }
    }
    return { store: null, id: null, action: null }
  }

  _getAll(store) { return LocalDB.getAll(store) }
  _get(store, id) { return LocalDB.get(store, id) }
  _store(store, records) { return LocalDB.store(store, records) }
  _delete(store, id) { return LocalDB.delete(store, id) }

  async get(path, query = {}, json = true) {
    const basePath = this._getBasePath(path)
    const match = this._matchPath(basePath)

    if (match.store && !match.action) {
      let data = await this._getAll(match.store)
      if (query.user_id) {
        const uid = parseInt(query.user_id)
        data = data.filter(r => r.added_by === uid || r.user_id === uid)
      }
      if (match.store === 'videos' || match.store === 'music') {
        const files = await LocalDB.getFilesByType(match.store)
        const fileIds = new Set(files.map(f => f.id))
        data = data.map(d => {
          let exists = false
          if (match.store === 'music') {
            if (d.filename) exists = fileIds.has(`music_${d.filename}`)
            if (!exists && d.video_id) {
              for (const ext of ['mp3', 'webm', 'm4a', 'ogg', 'flac', 'wav']) {
                if (fileIds.has(`music_${d.video_id}.${ext}`)) { exists = true; break }
              }
            }
          } else {
            const vid = d.video_id ? String(d.video_id) : String(d.id)
            exists = fileIds.has(`video_${vid}.mp4`) || fileIds.has(`video_${vid}.webm`)
          }
          return { ...d, downloaded: exists }
        })
      }
      return data
    }

    if (match.action === 'channel_videos') {
      return []
    }

    if (match.action === 'info') {
      return { formats: [] }
    }

    if (match.action === 'by_id') {
      const record = await this._get(match.store, match.id)
      return record || null
    }

    if (match.action === 'watch' || match.action === 'keep' || match.action === 'download') {
      return { ok: true }
    }

    if (basePath === '/status') {
      return { status: 'ok', version: '1.0', mode: 'local' }
    }

    throw new Error(`Local data not available for: ${path}`)
  }

  async post(path, body = {}) {
    const basePath = this._getBasePath(path)
    const match = this._matchPath(basePath)

    if (basePath === '/playlists' && !match.store) {
      const all = await this._getAll('playlists')
      const maxId = all.reduce((max, p) => Math.max(max, p.id || 0), 0)
      const playlist = { id: maxId + 1, name: body.name, user_id: body.user_id, songs: [] }
      await this._store('playlists', playlist)
      return playlist
    }

    if (match.action === 'add_song') {
      const playlist = await this._get('playlists', match.id)
      if (!playlist) throw new Error('Playlist not found')
      const songs = playlist.songs || []
      songs.push({ music_id: body.music_id, position: body.position || null })
      playlist.songs = songs
      await this._store('playlists', playlist)
      return { ok: true }
    }

    if (basePath === '/users') {
      const all = await this._getAll('users')
      const existing = all.find(u => u.username === body.username)
      if (existing) return existing
      const maxId = all.reduce((max, u) => Math.max(max, u.id || 0), 0)
      const user = { id: maxId + 1, username: body.username }
      await this._store('users', user)
      return user
    }

    const noopPaths = ['/videos/add', '/music/add', '/channels/add', '/channels']
    if (noopPaths.includes(basePath) || basePath.startsWith('/channels/') && basePath.endsWith('/subscribe')) {
      return { ok: true }
    }

    throw new Error(`Local mutation not supported for: POST ${path}`)
  }

  async put(path, body = {}) {
    const basePath = this._getBasePath(path)
    const match = this._matchPath(basePath)

    if (match.store === 'playlists' && match.action === 'by_id') {
      const playlist = await this._get('playlists', match.id)
      if (!playlist) throw new Error('Playlist not found')
      if (body.name !== undefined) playlist.name = body.name
      if (body.user_id !== undefined) playlist.user_id = body.user_id
      await this._store('playlists', playlist)
      return playlist
    }

    if (match.store === 'videos' && match.action === 'by_id') {
      const video = await this._get('videos', match.id)
      if (!video) throw new Error('Video not found')
      if (body.channel_id !== undefined) video.channel_id = body.channel_id
      if (body.added_by !== undefined) video.added_by = body.added_by
      await this._store('videos', video)
      return video
    }

    if (match.store === 'music' && match.action === 'by_id') {
      const music = await this._get('music', match.id)
      if (!music) throw new Error('Music not found')
      if (body.added_by !== undefined) music.added_by = body.added_by
      await this._store('music', music)
      return music
    }

    throw new Error(`Local mutation not supported for: PUT ${path}`)
  }

  async delete(path) {
    const basePath = this._getBasePath(path)
    const match = this._matchPath(basePath)

    if (match.store === 'playlists' && match.action === 'by_id') {
      await this._delete('playlists', match.id)
      return { ok: true }
    }

    if (match.action === 'remove_song') {
      const playlist = await this._get('playlists', match.id)
      if (!playlist) throw new Error('Playlist not found')
      playlist.songs = (playlist.songs || []).filter(s => s.music_id !== match.extraId)
      await this._store('playlists', playlist)
      return { ok: true }
    }

    if (match.store === 'music' && match.action === 'by_id') {
      await this._delete('music', match.id)
      return { ok: true }
    }

    if (match.store === 'subscriptions' && match.action === 'by_id') {
      await this._delete('subscriptions', match.id)
      return { ok: true }
    }

    if (match.store === 'videos' && match.action === 'by_id') {
      await this._delete('videos', match.id)
      return { ok: true }
    }

    throw new Error(`Local mutation not supported for: DELETE ${path}`)
  }

  async exchangeToken(token) {
    throw new Error('Token exchange not available in local mode')
  }

  async ping() {
    try {
      const hasData = await LocalDB.hasLocalData()
      return hasData
    } catch {
      return false
    }
  }

  async getVideoUrl(video) {
    if (!video.id) return null
    return `/api/local/video/${video.id}/file`
  }

  async getMusicUrl(song) {
    if (!song.id) return null
    return `/api/local/music/${song.id}/file`
  }

  async checkCache(paths) {
    const status = {}
    const allMusicFiles = await LocalDB.getFilesByType('music')
    const fileIds = new Set(allMusicFiles.map(f => f.id))
    const allMusicRecords = await this._getAll('music')
    for (const path of paths) {
      const match = path.match(/\/api\/music\/(\d+)\/file/)
      if (match) {
        const musicId = parseInt(match[1])
        const musicRecord = allMusicRecords.find(m => m.id === musicId)
        if (musicRecord) {
          let exists = false
          if (musicRecord.filename) {
            exists = fileIds.has(`music_${musicRecord.filename}`)
          }
          if (!exists && musicRecord.video_id) {
            for (const ext of ['mp3', 'webm', 'm4a', 'ogg', 'flac', 'wav']) {
              if (fileIds.has(`music_${musicRecord.video_id}.${ext}`)) {
                exists = true
                break
              }
            }
          }
          status[path] = exists
        } else {
          status[path] = false
        }
      } else {
        status[path] = true
      }
    }
    return status
  }

  cache(path, options) {
    console.warn('[LocalProvider] cache() is not supported in local mode — no backend to fetch from', { path, options })
  }

  async getMetadata() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      users: await this._getAll('users'),
      channels: await this._getAll('channels'),
      subscriptions: await this._getAll('subscriptions'),
      videos: await this._getAll('videos'),
      music: await this._getAll('music'),
      playlists: await this._getAll('playlists'),
      settings: await this._getAll('settings'),
    }
  }

  async exportData(body = {}) {
    const metadata = {
      version: 1,
      exported_at: new Date().toISOString(),
      users: await this._getAll('users'),
      channels: await this._getAll('channels'),
      subscriptions: await this._getAll('subscriptions'),
      videos: await this._getAll('videos'),
      music: await this._getAll('music'),
      playlists: await this._getAll('playlists'),
      settings: await this._getAll('settings'),
    }

    const zip = new JSZip()
    zip.file('metadata.json', JSON.stringify(metadata, null, 2))

    for (const v of metadata.videos) {
      if (v.video_id) {
        for (const ext of ['mp4', 'webm']) {
          const fileRecord = await LocalDB.getFile(`video_${v.video_id}.${ext}`)
          if (fileRecord?.blob) {
            zip.file(`videos/${v.video_id}.${ext}`, fileRecord.blob)
          }
        }
      }
    }

    for (const m of metadata.music) {
      if (m.filename) {
        const fileRecord = await LocalDB.getFile(`music_${m.filename}`)
        if (fileRecord?.blob) {
          zip.file(`music/${m.filename}`, fileRecord.blob)
        }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const filename = `hometube-export-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.ht`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return filename
  }

  async importData(file, onProgress) {
    const notify = onProgress || (() => {})

    notify({ message: 'Reading file...', current: 0, total: 0 })
    const arrayBuf = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(arrayBuf)
    const metaFile = zip.file('metadata.json')
    if (!metaFile) throw new Error('Invalid .ht file: missing metadata.json')
    const metadataStr = await metaFile.async('string')
    const metadata = JSON.parse(metadataStr)
    const total = (metadata.music?.length || 0) + (metadata.videos?.length || 0)

    notify({ message: 'Importing data...', current: 0, total })
    await LocalDB.clearAll()
    const summary = { users: 0, channels: 0, subscriptions: 0, videos: 0, music: 0, playlists: 0 }
    const idMap = {}

    if (metadata.users && metadata.users.length > 0) {
      const cleaned = metadata.users.map(u => {
        const { id, ...rest } = u
        return rest
      })
      await this._store('users', cleaned)
      idMap.users = {}
      metadata.users.forEach((u, i) => { idMap.users[u.id] = cleaned[i].id })
      summary.users = cleaned.length
    } else {
      const defaultUser = { username: 'default' }
      await this._store('users', defaultUser)
      idMap.users = {}
      summary.users = 1
    }

    if (metadata.channels) {
      const cleaned = metadata.channels.map(c => {
        const { id, ...rest } = c
        return rest
      })
      await this._store('channels', cleaned)
      idMap.channels = {}
      metadata.channels.forEach((c, i) => { idMap.channels[c.id] = cleaned[i].id })
      summary.channels = cleaned.length
    }

    if (metadata.subscriptions) {
      const cleaned = metadata.subscriptions.map(s => {
        const { id, channel_id, user_id, ...rest } = s
        return {
          ...rest,
          channel_id: idMap.channels?.[channel_id] || channel_id,
          user_id: idMap.users?.[user_id] || user_id,
        }
      })
      await this._store('subscriptions', cleaned)
      summary.subscriptions = cleaned.length
    }

    if (metadata.videos) {
      const cleaned = metadata.videos.map(v => {
        const { id, channel_id, added_by, ...rest } = v
        return {
          ...rest,
          channel_id: idMap.channels?.[channel_id] || channel_id,
          added_by: idMap.users?.[added_by] || added_by,
        }
      })
      await this._store('videos', cleaned)
      idMap.videos = {}
      metadata.videos.forEach((v, i) => { idMap.videos[v.id] = cleaned[i].id })
      summary.videos = cleaned.length
    }

    if (metadata.music) {
      const cleaned = metadata.music.map(m => {
        const { id, added_by, ...rest } = m
        return { ...rest, added_by: idMap.users?.[added_by] || added_by }
      })
      await this._store('music', cleaned)
      idMap.music = {}
      metadata.music.forEach((m, i) => { idMap.music[m.id] = cleaned[i].id })
      summary.music = cleaned.length
    }

    if (metadata.playlists) {
      const cleaned = metadata.playlists.map(p => {
        const { id, user_id, songs, ...rest } = p
        const mappedSongs = (songs || []).map(s => ({
          ...s,
          music_id: idMap.music?.[s.music_id] || s.music_id,
        }))
        return { ...rest, songs: mappedSongs, user_id: idMap.users?.[user_id] || user_id }
      })
      await this._store('playlists', cleaned)
      summary.playlists = cleaned.length
    }

    const videoFiles = zip.file(/^videos\//)
    let done = 0
    for (const zf of videoFiles) {
      const name = zf.name.replace('videos/', '')
      const blob = await zf.async('blob')
      const mime = name.endsWith('.mp4') ? 'video/mp4' : 'video/webm'
      const fileBlob = new Blob([await blob.arrayBuffer()], { type: mime })
      await LocalDB.storeFile(`video_${name}`, 'video', fileBlob, { filename: name })
      done++
      notify({ message: `Importing videos... (${done}/${videoFiles.length})`, current: done, total })
    }

    const musicFiles = zip.file(/^music\//)
    for (const zf of musicFiles) {
      const name = zf.name.replace('music/', '')
      const blob = await zf.async('blob')
      const ext = name.split('.').pop().toLowerCase()
      const mimeTypes = { mp3: 'audio/mpeg', webm: 'audio/webm', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' }
      const mime = mimeTypes[ext] || 'audio/mpeg'
      const fileBlob = new Blob([await blob.arrayBuffer()], { type: mime })
      await LocalDB.storeFile(`music_${name}`, 'music', fileBlob, { filename: name })
      done++
      notify({ message: `Importing music... (${done - videoFiles.length}/${musicFiles.length})`, current: done, total })
    }

    notify({ message: 'Import complete', current: total, total })
    return { ok: true, summary }
  }
}
