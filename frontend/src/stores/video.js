import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { API } from '../api.js'
import { useUserStore } from './user.js'

const STATE_KEY = 'videoPlayerState'
const MAX_POSITION = 60 // seconds with no changes before a watch progress write is flushed

export const videoThumb = (v) => v.thumbnail || (v.video_id ? `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg` : '')

export const useVideoStore = defineStore('video', () => {
  const videos = ref([])
  const videoPlaylists = ref([])
  const loadSettings = () => { try { return JSON.parse(localStorage.getItem('settings') || '{}') } catch { return {} } }
  const currentFilter = ref(loadSettings().defaultVideoFilter || 'my-feed')

  const queue = ref([])
  const originalOrder = ref([])
  const currentIndex = ref(-1)
  const shuffled = ref(false)
  const repeat = ref(false)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const queueSource = ref(null) // { type: 'feed' | 'playlist' | 'list', id }
  const audioMode = ref(false)
  const wakeLock = ref(null)
  const buffering = ref(false)

  const videoEl = ref(null)
  let elBound = false
  let positionTimer = null

  const filters = [
    { id: 'my-feed', label: 'My Feed' },
    { id: 'all', label: 'All Videos' },
    { id: 'unwatched', label: 'Unwatched' },
    { id: 'keep', label: 'Kept' }
  ]

  const playingVideo = computed(() => queue.value[currentIndex.value] || null)

  const filteredVideos = computed(() => {
    if (currentFilter.value === 'my-feed') {
      const userStore = useUserStore()
      return videos.value.filter(v => v.added_by === userStore.user?.id)
    }
    return videos.value
  })

  const load = async () => {
    const userStore = useUserStore()
    if (!userStore.user?.id) return
    const filter = currentFilter.value === 'my-feed' ? 'all' : currentFilter.value
    try {
      const data = await API.get('/videos', { user_id: userStore.user.id, filter })
      videos.value = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('Failed to load videos:', e)
      videos.value = []
    }
  }

  const setFilter = (filter) => {
    currentFilter.value = filter
    load()
  }

  const loadVideoPlaylists = async () => {
    const userStore = useUserStore()
    if (!userStore.user?.id) return
    try {
      const data = await API.get('/playlists', { user_id: userStore.user.id, kind: 'video' })
      videoPlaylists.value = Array.isArray(data) ? data : []
    } catch (e) {
      console.error('Failed to load video playlists:', e)
      videoPlaylists.value = []
    }
  }

  const resolveVideoPlaylist = async (playlistId) => {
    const userStore = useUserStore()
    let pl = videoPlaylists.value.find(p => p.id === Number(playlistId))
    if (!pl) {
      try {
        const data = await API.get('/playlists', { user_id: userStore.user.id, kind: 'video' })
        videoPlaylists.value = Array.isArray(data) ? data : []
        pl = videoPlaylists.value.find(p => p.id === Number(playlistId))
      } catch {}
    }
    if (!pl) return []
    const byId = new Map(videos.value.map(v => [v.id, v]))
    if (videos.value.length === 0) await load()
    const list = (pl.songs || [])
      .filter(s => s && s.type === 'video')
      .map(s => byId.get(s.video_id))
      .filter(Boolean)
    return list
  }

  const playlistSongCounts = computed(() => {
    const counts = {}
    for (const pl of videoPlaylists.value) {
      counts[pl.id] = (pl.songs || []).filter(s => s && s.type === 'video').length
    }
    return counts
  })

  const createVideoPlaylist = async (name) => {
    const userStore = useUserStore()
    if (!name || !name.trim()) return null
    const pl = await API.post('/playlists', { name, user_id: userStore.user.id, kind: 'video' })
    await loadVideoPlaylists()
    return pl
  }

  const deleteVideoPlaylist = async (playlistId) => {
    await API.delete(`/playlists/${playlistId}`)
    videoPlaylists.value = videoPlaylists.value.filter(p => p.id !== playlistId)
  }

  const renameVideoPlaylist = async (playlistId, name) => {
    const pl = await API.put(`/playlists/${playlistId}`, { name })
    const i = videoPlaylists.value.findIndex(p => p.id === playlistId)
    if (i >= 0) videoPlaylists.value[i] = pl
    return pl
  }

  const addVideoToList = async (playlistId, videoId) => {
    await API.post(`/playlists/${playlistId}/add`, { video_id: videoId, item_type: 'video' })
    await loadVideoPlaylists()
  }

  const removeVideoFromList = async (playlistId, videoId) => {
    await API.delete(`/playlists/${playlistId}/remove/${videoId}?item_type=video`)
    await loadVideoPlaylists()
  }

  const savePlaylistOrder = async (playlistId, songs) => {
    await API.put(`/playlists/${playlistId}`, { songs })
  }

  // ---------- playback ----------

  const waitForElement = () => new Promise(resolve => {
    if (videoEl.value) { resolve(videoEl.value); return }
    const check = setInterval(() => {
      if (videoEl.value) { clearInterval(check); resolve(videoEl.value) }
    }, 30)
  })

  const bindElement = (el) => {
    if (elBound && videoEl.value === el) return
    videoEl.value = el
    elBound = true
    el.addEventListener('timeupdate', () => {
      currentTime.value = el.currentTime
      reportPosition(el.currentTime)
    })
    el.addEventListener('durationchange', () => { duration.value = el.duration || 0 })
    el.addEventListener('play', () => { playing.value = true })
    el.addEventListener('pause', () => { playing.value = false })
    el.addEventListener('waiting', () => { buffering.value = true })
    el.addEventListener('playing', () => { buffering.value = false })
    el.addEventListener('ended', () => { onEnded() })
  }

  const reportPosition = (sec) => {
    if (positionTimer) clearTimeout(positionTimer)
    positionTimer = setTimeout(async () => {
      const vid = playingVideo.value
      if (vid) {
        try { await API.post(`/videos/${vid.id}/watch`, { position: Math.round(sec) }) } catch {}
      }
    }, MAX_POSITION * 1000)
  }

  const flushPosition = () => {
    if (positionTimer) { clearTimeout(positionTimer); positionTimer = null }
  }

  const markWatched = async (vid) => {
    if (!vid) return
    flushPosition()
    try {
      await API.post(`/videos/${vid.id}/watch`, { watched: true, position: 0 })
      await load()
    } catch {}
  }

  const playVideo = async (video) => {
    const el = await waitForElement()
    if (!video) return
    API.releaseUrl(el.src)
    playing.value = false
    buffering.value = true
    el.poster = videoThumb(video)
    try {
      el.src = await API.getVideoUrl(video)
    } catch (e) {
      console.error('Failed to resolve video url:', e)
      playing.value = false
      return
    }
    el.load()
    // resume where the user left off
    if (video.position && !video.watched_at && video.position < 0.9 * (video.duration || video.position + 1)) {
      el.currentTime = video.position
    } else {
      el.currentTime = 0
    }
    try { await el.play(); playing.value = true } catch {}
  }

  const playQueue = async (list, index, source) => {
    const items = list && list.length ? [...list] : []
    if (index < 0 || index >= items.length) return
    originalOrder.value = [...items]
    queueSource.value = source || null
    // restore per-list shuffle preference (mirrors music behavior)
    const storedShuffle = localStorage.getItem(shuffleKey())
    shuffled.value = storedShuffle ? storedShuffle === 'true' : false
    repeat.value = loadSettings().defaultVideoRepeat === true
    if (shuffled.value) {
      const order = shuffleOrder(items, items[index])
      queue.value = order
      currentIndex.value = order.findIndex(v => v.id === items[index].id)
    } else {
      queue.value = items
      currentIndex.value = index
    }
    await playVideo(queue.value[currentIndex.value])
  }

  const shuffleKey = () => {
    const src = queueSource.value
    const k = src && src.type === 'playlist' ? `playlist_${src.id}` : (src && src.type) ? `list_${src.id}` : 'feed'
    return `videolist_${k}_shuffled`
  }

  const shufflePlay = async (list, source) => {
    if (!list || !list.length) return
    queueSource.value = source || null
    shuffled.value = true
    localStorage.setItem(shuffleKey(), 'true')
    originalOrder.value = [...list]
    const current = list[0]
    queue.value = shuffleOrder(list, current)
    currentIndex.value = 0
    await playVideo(queue.value[0])
  }

  const shuffleOrder = (items, current) => {
    const copy = items.filter(v => v.id !== current.id)
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return [current, ...copy]
  }

  const next = async () => {
    if (queue.value.length === 0) return
    if (currentIndex.value < queue.value.length - 1) {
      currentIndex.value += 1
      await playVideo(queue.value[currentIndex.value])
    } else if (repeat.value && queue.value.length) {
      currentIndex.value = 0
      await playVideo(queue.value[currentIndex.value])
    } else {
      stop()
    }
  }

  const prev = async () => {
    if (currentTime.value > 3) {
      const el = videoEl.value
      if (el) { el.currentTime = 0; el.play() }
      return
    }
    if (currentIndex.value > 0) {
      currentIndex.value -= 1
      await playVideo(queue.value[currentIndex.value])
    }
  }

  const togglePlayPause = async () => {
    const el = videoEl.value
    if (!el || !playingVideo.value) return
    if (el.paused) { try { await el.play(); playing.value = true } catch {} }
    else el.pause()
  }

  const seekTo = (sec) => {
    const el = videoEl.value
    if (el) { el.currentTime = sec }
  }

  const toggleShuffle = async () => {
    shuffled.value = !shuffled.value
    localStorage.setItem(shuffleKey(), String(shuffled.value))
    if (shuffled.value) {
      const current = playingVideo.value
      if (current) {
        const order = shuffleOrder(queue.value, current)
        queue.value = order
        currentIndex.value = order.findIndex(v => v.id === current.id)
      }
    } else {
      const current = playingVideo.value
      if (current) {
        queue.value = [...originalOrder.value]
        currentIndex.value = queue.value.findIndex(v => v.id === current.id)
      }
    }
  }

  const toggleRepeat = () => {
    repeat.value = !repeat.value
  }

  const onEnded = () => {
    const vid = playingVideo.value
    markWatched(vid)
    next()
  }

  const stop = () => {
    flushPosition()
    const el = videoEl.value
    if (el) { el.pause(); el.removeAttribute('src'); el.load() }
    playing.value = false
    queue.value = []
    originalOrder.value = []
    currentIndex.value = -1
    currentTime.value = 0
    duration.value = 0
    saveState()
  }

  // ---------- persistence ----------

  const saveState = () => {
    if (currentIndex.value < 0) return
    const state = {
      queueIds: queue.value.map(v => v.id),
      currentIndex: currentIndex.value,
      shuffled: shuffled.value,
      repeat: repeat.value,
      playing: playing.value,
      currentTime: currentTime.value,
      source: queueSource.value
    }
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  }

  const restoreState = async () => {
    flushPosition()
    const saved = localStorage.getItem(STATE_KEY)
    if (!saved) return false
    try {
      const state = JSON.parse(saved)
      if (!Array.isArray(state.queueIds) || !state.queueIds.length || state.currentIndex < 0) return false
      const userStore = useUserStore()
      if (!userStore.user?.id) return false
      const all = await API.get('/videos', { user_id: userStore.user.id })
      const byId = new Map((Array.isArray(all) ? all : []).map(v => [v.id, v]))
      let items = state.queueIds.map(id => byId.get(id)).filter(Boolean)
      if (!items.length) return false
      queueSource.value = state.source || null
      shuffled.value = state.shuffled || false
      repeat.value = state.repeat || false
      originalOrder.value = [...items]
      if (shuffled.value) {
        const start = items[Math.min(state.currentIndex, items.length - 1)] || items[0]
        const order = shuffleOrder(items, start)
        queue.value = order
        currentIndex.value = order.findIndex(v => v.id === start.id)
      } else {
        queue.value = items
        currentIndex.value = Math.min(state.currentIndex, items.length - 1)
      }
      playing.value = false
      await playVideo(queue.value[currentIndex.value])
      const savedTime = state.playing ? (state.currentTime || 0) : 0
      const el = await waitForElement()
      if (savedTime > 0) {
        el.currentTime = Math.min(savedTime, el.duration || savedTime)
        if (state.playing) el.play()
      }
      return true
    } catch (e) {
      console.error('Failed to restore video state:', e)
      return false
    }
  }

  // ---------- watch / keep / audio ----------

  const toggleKeep = async (vid) => {
    await API.post(`/videos/${vid.id}/keep`, { keep: !vid.keep_flag })
    await load()
    const q = queue.value.find(v => v.id === vid.id)
    if (q) q.keep_flag = !vid.keep_flag
  }

  const releaseWakeLock = () => {
    if (wakeLock.value) {
      try { wakeLock.value.release() } catch {}
      wakeLock.value = null
    }
  }

  const acquireWakeLock = async () => {
    if ('wakeLock' in navigator && !wakeLock.value) {
      try {
        wakeLock.value = await navigator.wakeLock.request('screen')
        wakeLock.value.addEventListener('release', () => {
          wakeLock.value = null
          if (audioMode.value) acquireWakeLock()
        })
      } catch {}
    }
  }

  const toggleAudioMode = async () => {
    audioMode.value = !audioMode.value
    if (audioMode.value) acquireWakeLock()
    else releaseWakeLock()
  }

  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && audioMode.value) acquireWakeLock()
    })
    window.addEventListener('pagehide', () => saveState())
    window.addEventListener('beforeunload', () => saveState())
  }

  return {
    videos,
    videoPlaylists,
    currentFilter,
    queue,
    originalOrder,
    currentIndex,
    shuffled,
    repeat,
    playing,
    currentTime,
    duration,
    audioMode,
    buffering,
    wakeLock,
    playingVideo,
    filters,
    filteredVideos,
    playlistSongCounts,
    load,
    setFilter,
    loadVideoPlaylists,
    resolveVideoPlaylist,
    createVideoPlaylist,
    deleteVideoPlaylist,
    renameVideoPlaylist,
    addVideoToList,
    removeVideoFromList,
    savePlaylistOrder,
    bindElement,
    playQueue,
    shufflePlay,
    playVideo,
    next,
    prev,
    togglePlayPause,
    seekTo,
    toggleShuffle,
    toggleRepeat,
    stop,
    markWatched,
    saveState,
    restoreState,
    toggleKeep,
    toggleAudioMode
  }
})