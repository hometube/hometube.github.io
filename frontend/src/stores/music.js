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

  const updateMediaSession = (song) => {
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
    if ('mediaSession' in navigator && duration.value > 0) {
      navigator.mediaSession.setPositionState({
        duration: duration.value,
        playbackRate: 1,
        position: currentTime.value
      })
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

  let audioContext = null
  let analyser = null
  let dataArray = null

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
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      dataArray = new Uint8Array(analyser.frequencyBinCount)
      const osc = audioContext.createOscillator()
      osc.frequency.value = 220
      osc.connect(analyser)
      osc.start()
    }
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
        audio.value.load()
        audio.value.currentTime = state.currentTime || 0
        currentTime.value = state.currentTime || 0
        duration.value = state.duration || 0

        updateMediaSession(song)
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused'
        }

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
    if (wakeLock) {
      dbg('wakelock releasing')
      try { wakeLock.release() } catch (e) { dbg('wakelock release error', e?.message) }
      wakeLock = null
    }
  }

  const acquireWakeLock = async () => {
    if ('wakeLock' in navigator) {
      if (wakeLock) { dbg('wakelock already held'); return }
      try {
        wakeLock = await navigator.wakeLock.request('screen')
        dbg('wakelock acquired')
        wakeLock.addEventListener('release', () => {
          dbg('wakelock released by system')
          wakeLock = null
          if (playing.value) {
            dbg('wakelock re-acquiring (was playing)')
            acquireWakeLock()
          }
        })
      } catch (e) {
        dbg('wakelock acquire failed', e?.message || e?.name)
      }
    } else {
      dbg('wakelock not supported')
    }
  }

  const init = () => {
    if (initialized.value) return
    initialized.value = true
    audio.value = new Audio()
    dbg('init: audio element created')

    window.addEventListener('beforeunload', () => { dbg('beforeunload'); saveState() })
    window.addEventListener('pagehide', () => { dbg('pagehide'); saveState() })

    document.addEventListener('visibilitychange', () => {
      dbg('visibilitychange', document.visibilityState)
      if (document.visibilityState === 'visible') {
        resumeAudioContext()
        // If there's a pending next song (ended while hidden), advance now
        const pending = localStorage.getItem('pendingNextIdx')
        if (pending && displaySongs.value.length > 0) {
          const idx = parseInt(pending)
          localStorage.removeItem('pendingNextIdx')
          dbg('visibility: visible, advancing to pending next song', idx)
          playSong(idx)
          return
        }

        const song = currentSong.value
        if (song && 'mediaSession' in navigator) {
          updateMediaSession(song)
          navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
        }

        if (playing.value) {
          dbg('visibility: visible, was playing — re-acquiring wakelock')
          acquireWakeLock()
          // Android may have reset the audio element; resume playback if needed
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
      dbg('init: setting up Media Session handlers')
      navigator.mediaSession.setActionHandler('play', () => {
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
      navigator.mediaSession.setActionHandler('pause', () => {
        dbg('mediaSession: pause action')
        if (playing.value) togglePlay()
      })
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        dbg('mediaSession: nexttrack action')
        next()
      })
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        dbg('mediaSession: previoustrack action')
        prev()
      })
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        dbg('mediaSession: seekto', details.seekTime)
        if (details.seekTime && audio.value) {
          audio.value.currentTime = details.seekTime
        }
      })
      navigator.mediaSession.setActionHandler('seekforward', () => {
        dbg('mediaSession: seekforward')
        if (audio.value) audio.value.currentTime = Math.min(audio.value.currentTime + 10, audio.value.duration || Infinity)
      })
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        dbg('mediaSession: seekbackward')
        if (audio.value) audio.value.currentTime = Math.max(audio.value.currentTime - 10, 0)
      })
    } else {
      dbg('init: Media Session NOT available')
    }

    const handleEndedHidden = (idx) => {
      currentIndex.value = idx
      if (!displaySongs.value[idx]) return
      playing.value = false
      localStorage.setItem('pendingNextIdx', String(idx))
      saveState()
      dbg('audio: ended -> hidden, pending next song', displaySongs.value[idx]?.title)
    }

    audio.value.addEventListener('ended', () => {
      dbg('audio: ended')
      resumeAudioContext()
      const idx = findNextIndex(true)
      if (idx < 0) {
        dbg('audio: ended -> queue empty')
        playing.value = false
        releaseWakeLock()
        saveState()
        return
      }
      if (document.visibilityState === 'hidden') {
        handleEndedHidden(idx)
        return
      }
      dbg('audio: ended -> playing next', idx)
      playSong(idx)
    })
    audio.value.addEventListener('loadedmetadata', () => {
      dbg('audio: loadedmetadata', { duration: audio.value.duration })
      duration.value = audio.value.duration
      playbackError.value = null
      updatePositionState()
    })
    audio.value.addEventListener('error', (e) => {
      const err = audio.value?.error
      dbg('audio: error', { code: err?.code, message: err?.message, src: audio.value?.src?.slice(0, 80) })
      playing.value = false
      currentTime.value = 0
      duration.value = 0
      playbackError.value = err?.message || 'Failed to load song'
    })
    audio.value.addEventListener('play', () => {
      dbg('audio: play event')
      playbackError.value = null
    })
    audio.value.addEventListener('pause', () => {
      dbg('audio: pause event', { wasPlaying: playing.value })
      if (playing.value) {
        dbg('audio: system pause detected (likely screen lock), updating state')
        playing.value = false
        saveState()
      }
    })
    audio.value.addEventListener('stalled', () => {
      dbg('audio: stalled')
    })
    audio.value.addEventListener('waiting', () => {
      dbg('audio: waiting')
    })
    audio.value.addEventListener('canplay', () => {
      dbg('audio: canplay')
    })
    audio.value.addEventListener('timeupdate', () => {
      currentTime.value = audio.value.currentTime
      updatePositionState()
    })
    audio.value.addEventListener('playing', () => {
      dbg('audio: playing event')
    })
    audio.value.addEventListener('suspend', () => {
      dbg('audio: suspend')
    })

    window.__musicDebug = () => ({ log: debug.value, playing: playing.value, paused: audio.value?.paused,
      currentTime: currentTime.value, duration: duration.value, currentIndex: currentIndex.value,
      wakeLockHeld: !!wakeLock, audioContextState: audioContext?.state })
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

    // Set Media Session metadata BEFORE changing audio src so the lock screen
    // immediately shows the new song and the session survives the src transition
    updateMediaSession(song)
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing'
    }

    acquireWakeLock()

    if (audio.value && reloadAudio) {
      currentTime.value = 0
      const url = await API.getMusicUrl(song)
      if (!url) {
        playing.value = false
        duration.value = 0
        const reason = !song.filename && !song.video_id
          ? 'missing filename and video_id'
          : 'no matching file blob in local storage'
        playbackError.value = `Cannot play "${song.title || 'Unknown'}": ${reason}`
        dbg('playSong: no URL', { songId: song.id, title: song.title, reason })
        return
      }
      dbg('playSong: setting src', url.slice(0, 80))
      audio.value.src = url
      audio.value.load()
    }
    resumeAudioContext()
    audio.value.play().catch((err) => {
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
