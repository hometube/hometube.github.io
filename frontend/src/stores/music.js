import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { API } from '../api.js'
import { useUserStore } from './user.js'

export const useMusicStore = defineStore('music', () => {
  const audio = ref(null)
  const playlist = ref(null)
  const playlistId = ref(null)
  const displaySongs = ref([])
  const originalOrder = ref([])
  const currentIndex = ref(-1)
  const shuffled = ref(false)
  const repeat = ref(false)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const initialized = ref(false)
  const playbackError = ref(null)
  const DEBUG_KEY = '__musicDebugLog'
  const MAX_DEBUG = 200
  const debug = ref([])
  const dbg = (msg, data) => {
    const entry = { t: Date.now(), m: msg, d: data }
    debug.value.push(entry)
    if (debug.value.length > MAX_DEBUG) debug.value.splice(0, debug.value.length - MAX_DEBUG)
    try { localStorage.setItem(DEBUG_KEY, JSON.stringify(debug.value)) } catch {}
    console.log(`[MusicDBG] ${msg}`, data ?? '')
  }
  const loadDebug = () => {
    try {
      const saved = localStorage.getItem(DEBUG_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) debug.value = parsed.slice(-MAX_DEBUG)
      }
    } catch {}
  }
  loadDebug()

  let audioContext = null
  let analyser = null
  let dataArray = null
  const isAndroid = /Android/i.test(navigator.userAgent)
  const useAudioContext = !isAndroid
  let transitioningTrack = false

  const setMsState = (state) => {
    if (!('mediaSession' in navigator)) return
    dbg(`MS playbackState -> ${state}`)
    navigator.mediaSession.playbackState = state
  }

  const setMediaAction = (action, handler) => {
    try { navigator.mediaSession?.setActionHandler(action, handler) } catch {}
  }

  let supportsPositionState = false

  const registerMediaActions = () => {
    if (!('mediaSession' in navigator)) return
    setMediaAction('play', () => {
      dbg('mediaSession: play action')
      if (!playing.value) {
        togglePlay()
      } else if (audio.value?.paused) {
        dbg('mediaSession: play — system paused, force-resuming')
        resumeAudioContext()
        acquireWakeLock()
        audio.value.play().catch((err) => {
          dbg('mediaSession: play — force resume failed', err?.message)
        })
      }
    })
    setMediaAction('pause', () => {
      dbg('mediaSession: pause action')
      if (playing.value) togglePlay()
    })
    if (findNextIndex(true) !== -1) {
      setMediaAction('nexttrack', () => {
        dbg('mediaSession: nexttrack action')
        next()
      })
    } else {
      setMediaAction('nexttrack', null)
    }
    if (findNextIndex(false) !== -1) {
      setMediaAction('previoustrack', () => {
        dbg('mediaSession: previoustrack action')
        prev()
      })
    } else {
      setMediaAction('previoustrack', null)
    }
    setMediaAction('seekto', (details) => {
      dbg('mediaSession: seekto', details.seekTime)
      if (details.seekTime && audio.value) {
        audio.value.currentTime = details.seekTime
      }
    })
    setMediaAction('seekforward', () => {
      dbg('mediaSession: seekforward')
      if (audio.value) audio.value.currentTime = Math.min(audio.value.currentTime + 10, audio.value.duration || Infinity)
    })
    setMediaAction('seekbackward', () => {
      dbg('mediaSession: seekbackward')
      if (audio.value) audio.value.currentTime = Math.max(audio.value.currentTime - 10, 0)
    })
  }

  const clearMediaSession = () => {
    if (!('mediaSession' in navigator)) return
    setMsState('none')
    navigator.mediaSession.metadata = null
    const actions = ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto']
    for (const a of actions) setMediaAction(a, null)
    if (supportsPositionState) {
      try { navigator.mediaSession.setPositionState() } catch {}
    }
  }

  const setupMediaSession = (song) => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'Unknown',
      artist: song.artist || 'Unknown',
      album: playlist.value?.name || '',
      artwork: song.album_art
        ? [{ src: song.album_art, sizes: '512x512', type: 'image/jpeg' }]
        : []
    })
  }

  const updatePositionState = () => {
    if (!('mediaSession' in navigator) || !supportsPositionState) return
    if (duration.value > 0 && Number.isFinite(duration.value)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration.value,
          playbackRate: 1,
          position: currentTime.value
        })
      } catch {}
    }
  }

  const isOffline = computed(() => {
    const userStore = useUserStore()
    return userStore.checked && !userStore.online
  })

  const findNextIndex = (forward = true) => {
    if (forward) {
      const start = currentIndex.value + 1
      for (let i = start; i < displaySongs.value.length; i++) {
        if (!isOffline.value || displaySongs.value[i].downloaded) return i
      }
      if (repeat.value) {
        for (let i = 0; i < currentIndex.value; i++) {
          if (!isOffline.value || displaySongs.value[i].downloaded) return i
        }
      }
    } else {
      const start = currentIndex.value - 1
      for (let i = start; i >= 0; i--) {
        if (!isOffline.value || displaySongs.value[i].downloaded) return i
      }
      if (repeat.value) {
        for (let i = displaySongs.value.length - 1; i > currentIndex.value; i--) {
          if (!isOffline.value || displaySongs.value[i].downloaded) return i
        }
      }
    }
    return -1
  }

  const hasActiveQueue = computed(() => displaySongs.value.length > 0)

  const isInQueue = (songId) => displaySongs.value.some(s => s.id === songId)

  const addToQueueNext = (song) => {
    displaySongs.value.splice(currentIndex.value + 1, 0, { ...song })
  }

  const addToQueue = (song) => {
    if (isInQueue(song.id)) return
    displaySongs.value.push({ ...song })
  }

  const removeFromQueue = (songId) => {
    displaySongs.value = displaySongs.value.filter(s => s.id !== songId)
  }

  const playlists = ref([])
  const songs = ref([])

  const downloadedCache = ref({})

  const checkDownloaded = async (songs) => {
    const paths = songs.map(s => `/api/music/${s.id}/file`)
    try {
      const status = await API.checkCache(paths)
      downloadedCache.value = Object.fromEntries(
        songs.map(s => [s.id, !!status[`/api/music/${s.id}/file`]])
      )
      displaySongs.value = displaySongs.value.map(s => ({
        ...s,
        downloaded: downloadedCache.value[s.id] || false
      }))
    } catch {}
  }

  const mySongs = computed(() => songs.value.filter(m => m.added_by === useUserStore().user?.id))

  const virtualPlaylists = computed(() => [
    { id: 'my-songs', name: 'My Songs', songs: mySongs.value },
    { id: 'all-songs', name: 'All Songs', songs: songs.value }
  ])

  const load = async () => {
    const userStore = useUserStore()
    if (!userStore.user) return
    try {
      const [pls, allSongs] = await Promise.all([
        API.get('/playlists', { user_id: userStore.user.id }),
        API.get('/music', { user_id: userStore.user.id })
      ])
      playlists.value = pls
      songs.value = allSongs
    } catch (e) {
      console.error('Failed to load music data:', e)
    }
  }

  // BPM detection
  const bpm = ref(0)
  let lastBeatTime = 0
  let energyHistory = []
  let beatIntervals = []

  const detectBeat = () => {
    if (!analyser || !dataArray) return
    const bassBins = Math.min(6, dataArray.length)
    let totalEnergy = 0
    for (let i = 0; i < bassBins; i++) {
      totalEnergy += dataArray[i]
    }

    energyHistory.push(totalEnergy)
    if (energyHistory.length > 60) {
      energyHistory.shift()
    }
    if (energyHistory.length < 10) return

    const localAvg = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length
    if (totalEnergy > localAvg * 1.35 && totalEnergy > 20) {
      const now = performance.now()
      if (lastBeatTime > 0) {
        const interval = now - lastBeatTime
        if (interval > 200 && interval < 2000) {
          beatIntervals.push(interval)
          if (beatIntervals.length > 8) {
            beatIntervals.shift()
          }
          const avgInterval = beatIntervals.reduce((a, b) => a + b, 0) / beatIntervals.length
          bpm.value = Math.round(60000 / avgInterval)
        }
      }
      lastBeatTime = now
    }
  }

  const resumeAudioContext = () => {
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }
  }

  const currentSong = computed(() => {
    if (displaySongs.value.length === 0) return null
    return currentIndex.value >= 0 ? displaySongs.value[currentIndex.value] : displaySongs.value[0]
  })

  const getAnalyser = () => {
    if (!useAudioContext || !audioContext) return { analyser: null, dataArray: null, audioContext: null }
    resumeAudioContext()
    return { analyser, dataArray, audioContext }
  }

  const saveState = () => {
    if (!audio.value || currentIndex.value < 0) return
    const state = {
      playlistId: playlistId.value,
      currentIndex: currentIndex.value,
      shuffled: shuffled.value,
      repeat: repeat.value,
      playing: playing.value,
      currentTime: audio.value.currentTime,
      duration: audio.value.duration
    }
    localStorage.setItem('musicPlayerState', JSON.stringify(state))
  }

  const restoreState = async () => {
    dbg('restoreState: start')
    const saved = localStorage.getItem('musicPlayerState')
    if (!saved) { dbg('restoreState: no saved state'); return false }

    try {
      const state = JSON.parse(saved)
      dbg('restoreState: loaded state', { playlistId: state.playlistId, currentIndex: state.currentIndex, playing: state.playing })
      if (!state.playlistId || state.currentIndex < 0) { dbg('restoreState: invalid state'); return false }

      const user = JSON.parse(localStorage.getItem('user') || 'null')
      if (!user || !user.id) { dbg('restoreState: no user'); return false }

      let pl = null
      let songs = []

      if (state.playlistId === 'my-songs') {
        const allSongs = await API.get('/music', { user_id: user.id })
        pl = { type: 'virtual', name: 'My Songs' }
        songs = allSongs.filter(m => m.added_by === user.id)
      } else if (state.playlistId === 'all-songs') {
        const allSongs = await API.get('/music', { user_id: user.id })
        pl = { type: 'virtual', name: 'All Songs' }
        songs = allSongs
      } else {
        const playlists = await API.get('/playlists', { user_id: user.id })
        const found = playlists.find(p => p.id === parseInt(state.playlistId))
        if (found) {
          pl = found
          const allMusic = await API.get('/music', { user_id: user.id })
          songs = (found.songs || [])
            .map(s => allMusic.find(m => m.id === s.music_id))
            .filter(Boolean)
        }
      }

      if (!pl || songs.length === 0) { dbg('restoreState: playlist/songs not found'); return false }

      playlist.value = pl
      playlistId.value = state.playlistId
      originalOrder.value = songs

      if (!downloadedCache.value || Object.keys(downloadedCache.value).length === 0) {
        await checkDownloaded(songs)
      }

      displaySongs.value = songs.map(s => ({
        ...s,
        downloaded: downloadedCache.value[s.id] || false
      }))
      shuffled.value = state.shuffled
      repeat.value = state.repeat

      if (shuffled.value) {
        shuffleOrder()
      }

      currentIndex.value = state.currentIndex

      if (audio.value && currentIndex.value >= 0 && displaySongs.value[currentIndex.value]) {
        const song = displaySongs.value[currentIndex.value]
        dbg('restoreState: loading song', { title: song.title, currentTime: state.currentTime })
        const url = await API.getMusicUrl(song)
        if (!url) {
          dbg('restoreState: no URL for song', { songId: song.id, title: song.title })
          return false
        }
        audio.value.src = url
        audio.value.currentTime = state.currentTime || 0
        currentTime.value = state.currentTime || 0
        duration.value = state.duration || 0

        setupMediaSession(song)
        setMsState(state.playing ? 'playing' : 'paused')

        if (state.playing) {
          dbg('restoreState: resuming playback')
          audio.value.play().catch((err) => {
            dbg('restoreState: play() rejected', { message: err?.message, name: err?.name })
            playing.value = false
            releaseWakeLock()
          })
          playing.value = true
          acquireWakeLock()
        }
      }

      dbg('restoreState: done')
      return true
    } catch (e) {
      dbg('restoreState: error', e?.message)
      return false
    }
  }

  let wakeLock = null

  const releaseWakeLock = () => {
    if (isAndroid) return
    if (wakeLock) {
      dbg('wakelock releasing')
      try { wakeLock.release() } catch (e) { dbg('wakelock release error', e?.message) }
      wakeLock = null
    }
  }

  const acquireWakeLock = async () => {
    if (isAndroid) return
    if ('wakeLock' in navigator) {
      if (wakeLock) { dbg('wakelock already held'); return }
      try {
        wakeLock = await navigator.wakeLock.request('screen')
        dbg('wakelock acquired')
        wakeLock.addEventListener('release', () => {
          dbg('wakelock released by system')
          wakeLock = null
        })
      } catch (e) {
        dbg('wakelock acquire failed', e?.message || e?.name)
      }
    } else {
      dbg('wakelock not supported')
    }
  }

  // === MSE Stream Management ===
  let mediaSource = null
  let sourceBuffer = null
  let msObjectUrl = null
  let trackRanges = []
  let mseActive = false
  const mseSupported = typeof MediaSource !== 'undefined'

  const cleanupMSE = () => {
    mseActive = false
    trackRanges = []
    if (msObjectUrl) {
      URL.revokeObjectURL(msObjectUrl)
      msObjectUrl = null
    }
    if (mediaSource && mediaSource.readyState !== 'closed') {
      try { mediaSource.endOfStream() } catch {}
    }
    mediaSource = null
    sourceBuffer = null
  }

  const mseInit = async (startIndex) => {
    if (!mseSupported || !audio.value) return false
    const song = displaySongs.value[startIndex]
    if (!song) return false

    const url = await API.getMusicUrl(song)
    if (!url) return false

    let response
    try { response = await fetch(url) } catch { return false }
    if (!response.ok) return false

    const contentType = response.headers.get('content-type') || 'audio/mpeg'
    if (!MediaSource.isTypeSupported(contentType)) return false

    const data = await response.arrayBuffer()
    cleanupMSE()
    trackRanges = []

    mediaSource = new MediaSource()
    msObjectUrl = URL.createObjectURL(mediaSource)

    return new Promise(resolve => {
      mediaSource.addEventListener('sourceopen', () => {
        try {
          sourceBuffer = mediaSource.addSourceBuffer(contentType)
        } catch (e) {
          dbg('mse: addSourceBuffer failed', e?.message)
          cleanupMSE(); resolve(false); return
        }

        sourceBuffer.addEventListener('updateend', () => {
          const last = trackRanges[trackRanges.length - 1]
          if (last) last.endTime = mediaSource.duration || 0
          mseAppendNext()
        })

        const before = mediaSource.duration || 0
        trackRanges.push({ trackIndex: startIndex, startTime: before, endTime: before })
        sourceBuffer.appendBuffer(data)
        audio.value.src = msObjectUrl
        mseActive = true
        resolve(true)
      }, { once: true })

      mediaSource.addEventListener('error', () => {
        dbg('mse: mediaSource error')
        cleanupMSE(); resolve(false)
      }, { once: true })
    })
  }

  const mseAppendTrack = async (trackIndex) => {
    if (!sourceBuffer || sourceBuffer.updating || !mseActive) return
    const song = displaySongs.value[trackIndex]
    if (!song) return
    const url = await API.getMusicUrl(song)
    if (!url) return
    try {
      const response = await fetch(url)
      if (!response.ok) return
      const data = await response.arrayBuffer()
      if (sourceBuffer.updating) return
      const before = mediaSource.duration || 0
      trackRanges.push({ trackIndex, startTime: before, endTime: before })
      sourceBuffer.appendBuffer(data)
    } catch (e) {
      dbg('mse: append failed', e?.message)
    }
  }

  const mseAppendNext = () => {
    if (!mseActive) return
    const buffered = new Set(trackRanges.map(r => r.trackIndex))
    const nextIdx = findNextIndex(true)
    if (nextIdx >= 0 && !buffered.has(nextIdx)) {
      mseAppendTrack(nextIdx)
    }
  }

  const mseGetTrackAtTime = (time) => {
    for (let i = trackRanges.length - 1; i >= 0; i--) {
      const r = trackRanges[i]
      if (r.endTime > 0 && time >= r.startTime && time < r.endTime) return r.trackIndex
    }
    return -1
  }

  const mseSeekToTrack = (trackIndex) => {
    const range = trackRanges.find(r => r.trackIndex === trackIndex)
    if (range && audio.value) {
      audio.value.currentTime = range.startTime
      return true
    }
    return false
  }

  const init = () => {
    if (initialized.value) return
    initialized.value = true
    audio.value = new Audio()
    audio.value.preload = 'auto'
    audio.value.autoplay = false
    audio.value.crossOrigin = 'anonymous'
    audio.value.id = 'global-player'
    audio.value.style.display = 'none'
    document.body.appendChild(audio.value)

    if (useAudioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)()
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        dataArray = new Uint8Array(analyser.frequencyBinCount)
        const source = audioContext.createMediaElementSource(audio.value)
        source.connect(analyser)
        analyser.connect(audioContext.destination)
      } catch (e) {
        dbg('init: audio analysis setup failed', e?.message)
      }
    } else {
      dbg('init: AudioContext disabled on Android — native playback only')
    }
    dbg('init: audio element created')

    registerMediaActions()

    window.addEventListener('beforeunload', () => { dbg('beforeunload'); saveState() })
    window.addEventListener('pagehide', () => { dbg('pagehide'); saveState() })

    document.addEventListener('visibilitychange', () => {
      dbg('visibilitychange', document.visibilityState)
      if (document.visibilityState === 'visible') {
        resumeAudioContext()

        if (playing.value) {
          acquireWakeLock()
          if (audio.value && audio.value.paused && currentIndex.value >= 0) {
            dbg('visibility: visible, audio was paused by system — resuming')
            audio.value.play().catch(() => {})
          }
        }
      } else {
        saveState()
      }
    })

    if ('mediaSession' in navigator) {
      dbg('init: setting up Media Session')
      supportsPositionState = !!navigator.mediaSession.setPositionState
    } else {
      dbg('init: Media Session NOT available')
    }

    audio.value.addEventListener('ended', async () => {
      dbg('audio: ended')
      if (mseActive && sourceBuffer) {
        if (sourceBuffer.updating) {
          await new Promise(r => { sourceBuffer.addEventListener('updateend', r, { once: true }) })
        }
        const nextIdx = findNextIndex(true)
        if (nextIdx >= 0) {
          dbg('ended: extending MSE stream')
          await mseAppendTrack(nextIdx)
          if (sourceBuffer && !sourceBuffer.updating && trackRanges.length >= 2) {
            const prevEnd = trackRanges[trackRanges.length - 2].endTime
            audio.value.currentTime = prevEnd
            audio.value.play().catch(() => {})
            return
          }
        }
      }
      const idx = findNextIndex(true)
      if (idx < 0) {
        dbg('audio: ended -> queue empty')
        playing.value = false
        releaseWakeLock()
        saveState()
        return
      }
      dbg('ended: transitioning to next track')
      await new Promise(r => setTimeout(r, 300))
      playSong(idx)
    })
    audio.value.addEventListener('loadedmetadata', () => {
      dbg('audio: loadedmetadata', { duration: audio.value.duration })
      duration.value = audio.value.duration
      playbackError.value = null
      if (audio.value.currentTime >= audio.value.duration - 1) {
        audio.value.currentTime = 0
      }
      updatePositionState()
    })
    audio.value.addEventListener('error', () => {
      const err = audio.value.error
      dbg('audio: error', { code: err?.code, message: err?.message, src: audio.value.src?.slice(0, 80), transitioningTrack })
      transitioningTrack = false
      playing.value = false
      currentTime.value = 0
      duration.value = 0
      playbackError.value = err?.message || 'Failed to load song'
      setMsState('none')
      if (supportsPositionState) {
        try { navigator.mediaSession.setPositionState() } catch {}
      }
    })
    audio.value.addEventListener('play', () => {
      dbg('audio: play event', { transitioningTrack })
      transitioningTrack = false
      playbackError.value = null
      setMsState('playing')
    })
    audio.value.addEventListener('pause', () => {
      dbg('audio: pause event', { wasPlaying: playing.value, transitioningTrack })
      if (transitioningTrack) {
        dbg('pause: suppressed during track transition')
        return
      }
      if (playing.value) {
        clearTimeout(pauseTimer)
        const el = audio.value
        pauseTimer = setTimeout(() => {
          if (el.paused) {
            dbg('audio: system pause confirmed, updating state')
            playing.value = false
            setMsState('paused')
            saveState()
          }
        }, 300)
      }
    })
    audio.value.addEventListener('stalled', () => { dbg('audio: stalled') })
    audio.value.addEventListener('waiting', () => { dbg('audio: waiting') })
    audio.value.addEventListener('canplay', () => { dbg('audio: canplay') })
    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value.currentTime
      updatePositionState()
      if (mseActive && trackRanges.length > 1) {
        const ti = mseGetTrackAtTime(audio.value.currentTime)
        if (ti >= 0 && ti !== currentIndex.value) {
          dbg('timeupdate: MSE track boundary crossed', { from: currentIndex.value, to: ti })
          currentIndex.value = ti
          setupMediaSession(displaySongs.value[ti])
          duration.value = audio.value.duration || 0
          saveState()
        }
      }
    })
    audio.value.addEventListener('playing', () => {
      dbg('audio: playing event', { transitioningTrack })
      transitioningTrack = false
      setMsState('playing')
    })
    audio.value.addEventListener('suspend', () => { dbg('audio: suspend') })

    window.__musicDebug = () => ({ log: debug.value, playing: playing.value, paused: audio.value?.paused,
      currentTime: currentTime.value, duration: duration.value, currentIndex: currentIndex.value,
      wakeLockHeld: !!wakeLock, audioContextState: audioContext?.state,
      mseActive, trackRanges: trackRanges.length })
    window.__musicDebugClear = () => {
      debug.value = []
      try { localStorage.removeItem(DEBUG_KEY) } catch {}
    }
    dbg('init complete: debug helpers available via window.__musicDebug()')
  }

  const loadSettings = () => { try { return JSON.parse(localStorage.getItem('settings') || '{}') } catch { return {} } }

  const loadPlaylistSongs = (songs, pl, plId) => {
    const wasPlaying = playing.value && currentIndex.value >= 0
    const currentSongId = wasPlaying ? displaySongs.value[currentIndex.value]?.id : null
    const s = loadSettings()

    currentIndex.value = -1
    playlist.value = pl
    playlistId.value = plId
    originalOrder.value = songs
    displaySongs.value = songs.map(s => ({
      ...s,
      downloaded: downloadedCache.value[s.id] || false
    }))
    shuffled.value = JSON.parse(localStorage.getItem(`playlist_${plId}_shuffled`) || String(!!s.defaultShuffle))
    repeat.value = !!s.defaultRepeat

    if (shuffled.value) {
      shuffleOrder()
    }

    if (wasPlaying && currentSongId) {
      const newIndex = displaySongs.value.findIndex(s => s.id === currentSongId)
      if (newIndex >= 0) {
        currentIndex.value = newIndex
      }
    }

    checkDownloaded(songs)
  }

  const shuffleOrder = () => {
    const arr = [...displaySongs.value]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    const currentSongId = displaySongs.value[currentIndex.value]?.id
    displaySongs.value = arr
    currentIndex.value = displaySongs.value.findIndex(s => s.id === currentSongId)
  }

  const playSong = async (index, reloadAudio = true) => {
    dbg('playSong', { index, reloadAudio, title: displaySongs.value[index]?.title })
    if (!Object.keys(downloadedCache.value).length) {
      await checkDownloaded(displaySongs.value)
    }

    bpm.value = 0
    lastBeatTime = 0
    energyHistory = []
    beatIntervals = []

    currentIndex.value = index

    const song = displaySongs.value[index]
    if (!song) { dbg('playSong: no song at index'); return }
    playing.value = true

    acquireWakeLock()

    if (audio.value && reloadAudio) {
      // Try seeking within existing MSE stream
      if (mseActive && mseSeekToTrack(index)) {
        dbg('playSong: seeking within MSE stream', { index })
        setupMediaSession(song)
        resumeAudioContext()
        audio.value.play().catch((err) => {
          dbg('playSong: play() rejected after MSE seek', { message: err?.message, name: err?.name })
          playing.value = false
          releaseWakeLock()
          saveState()
        })
        return
      }

      // Reset for new playback session
      currentTime.value = 0
      cleanupMSE()

      // Try MSE for continuous stream
      const mseOk = await mseInit(index)
      if (mseOk) {
        dbg('playSong: using MSE stream', { index })
        setupMediaSession(song)
        resumeAudioContext()
        audio.value.play().catch((err) => {
          dbg('playSong: MSE play() rejected', { message: err?.message, name: err?.name })
          mseActive = false
          playing.value = false
          releaseWakeLock()
          saveState()
        })
        return
      }

      // Fallback to direct src
      dbg('playSong: MSE not available, falling back to direct src')
      const url = await API.getMusicUrl(song)
      if (!url) {
        transitioningTrack = false
        playing.value = false
        duration.value = 0
        const reason = !song.filename && !song.video_id
          ? 'missing filename and video_id'
          : 'no matching file blob in local storage'
        playbackError.value = `Cannot play "${song.title || 'Unknown'}": ${reason}`
        dbg('playSong: no URL', { songId: song.id, title: song.title, reason })
        return
      }
      dbg('playSong: setting src (direct)', url.slice(0, 80))
      await new Promise(r => setTimeout(r, 0))
      transitioningTrack = true
      audio.value.src = url
    }
    setupMediaSession(song)
    resumeAudioContext()
    audio.value.play().catch((err) => {
      transitioningTrack = false
      dbg('playSong: play() rejected', { message: err?.message, name: err?.name })
      playing.value = false
      releaseWakeLock()
      saveState()
      return
    })

    if (!song.downloaded) {
      try {
        const s = JSON.parse(localStorage.getItem('settings') || '{}')
        if (s.downloadOnPlay !== false) {
          API.cache(`/music/${song.id}/file`, { ttl: Infinity, refetch: false }, false)
          const idx = displaySongs.value.findIndex(s => s.id === song.id)
          if (idx >= 0) displaySongs.value[idx].downloaded = true
          if (downloadedCache.value) downloadedCache.value[song.id] = true
        }
      } catch {}
    }
  }

  const togglePlay = () => {
    if (!audio.value) { dbg('togglePlay: no audio element'); return }
    playing.value = !playing.value
    dbg('togglePlay', { nowPlaying: playing.value, paused: audio.value.paused })
    if (playing.value) {
      resumeAudioContext()
      acquireWakeLock()
      audio.value.play().catch((err) => {
        dbg('togglePlay: play() rejected', { message: err?.message, name: err?.name })
        playing.value = false
        releaseWakeLock()
      })
    } else {
      audio.value.pause()
      releaseWakeLock()
    }
  }

  const next = () => {
    dbg('next')
    const idx = findNextIndex(true)
    if (idx >= 0) playSong(idx); else dbg('next: no next song')
  }

  const prev = () => {
    dbg('prev', { currentTime: audio.value?.currentTime })
    if (audio.value && audio.value.currentTime > 3) {
      audio.value.currentTime = 0
      return
    }
    const idx = findNextIndex(false)
    if (idx >= 0) playSong(idx); else dbg('prev: no prev song')
  }

  const toggleRepeat = () => { repeat.value = !repeat.value }

  const toggleShuffle = () => {
    shuffled.value = !shuffled.value
    if (playlistId.value) {
      localStorage.setItem(`playlist_${playlistId.value}_shuffled`, shuffled.value.toString())
    }
    if (shuffled.value) {
      shuffleOrder()
    } else {
      const currentSongId = displaySongs.value[currentIndex.value]?.id
      displaySongs.value = [...originalOrder.value]
      currentIndex.value = displaySongs.value.findIndex(s => s.id === currentSongId)
    }
  }

  const findFirstPlayable = () => {
    for (let i = 0; i < displaySongs.value.length; i++) {
      if (!isOffline.value || displaySongs.value[i].downloaded) return i
    }
    return -1
  }

  const playFirst = () => {
    if (shuffled.value) {
      shuffled.value = false
      if (playlistId.value) {
        localStorage.setItem(`playlist_${playlistId.value}_shuffled`, 'false')
      }
      displaySongs.value = [...originalOrder.value]
      currentIndex.value = 0
    }
    const idx = findFirstPlayable()
    if (idx >= 0) playSong(idx)
  }

  const shufflePlay = () => {
    if (!shuffled.value) {
      shuffled.value = true
      if (playlistId.value) {
        localStorage.setItem(`playlist_${playlistId.value}_shuffled`, 'true')
      }
      shuffleOrder()
    }
    const idx = findFirstPlayable()
    if (idx >= 0) playSong(idx)
  }

  const isCurrentPlaylist = (plId) => {
    return playlistId.value === plId
  }

  const stop = () => {
    dbg('stop')
    clearMediaSession()
    cleanupMSE()
    if (audio.value) {
      audio.value.pause()
      audio.value.src = ''
    }
    playing.value = false
    currentIndex.value = -1
    releaseWakeLock()
  }

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const dismissError = () => {
    playbackError.value = null
  }

  const cleanTitle = (title) => {
    if (!title) return title
    return title.replace(/\s*\[[^\]]+\]\s*$/, '')
  }

  const clearDebug = () => {
    debug.value = []
    try { localStorage.removeItem(DEBUG_KEY) } catch {}
  }

  return {
    debug,
    getDebugLog: () => debug.value,
    clearDebug,
    audio,
    playlist,
    playlistId,
    displaySongs,
    currentIndex,
    shuffled,
    repeat,
    playing,
    currentTime,
    duration,
    initialized,
    playbackError,
    bpm,
    currentSong,
    playlists,
    songs,
    mySongs,
    virtualPlaylists,
    hasActiveQueue,
    isInQueue,
    addToQueueNext,
    addToQueue,
    removeFromQueue,
    getAnalyser,
    saveState,
    restoreState,
    init,
    load,
    loadPlaylistSongs,
    checkDownloaded,
    shuffleOrder,
    detectBeat,
    playSong,
    togglePlay,
    next,
    prev,
    toggleRepeat,
    toggleShuffle,
    playFirst,
    shufflePlay,
    isCurrentPlaylist,
    stop,
    formatTime,
    cleanTitle,
    dismissError
  }
})
