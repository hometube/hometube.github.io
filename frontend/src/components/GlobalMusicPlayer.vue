<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useMusicStore } from '../stores/music.js'
import WaveformVisual from './WaveformVisual.vue'

const router = useRouter()
const route = useRoute()
const musicStore = useMusicStore()

const {
  audio,
  playlistId,
  currentIndex,
  playing,
  currentSong,
  repeat,
  currentTime,
  duration,
  playbackError,
  playlist,
} = storeToRefs(musicStore)

const {
  togglePlay,
  next,
  prev,
  toggleRepeat,
  isCurrentPlaylist,
  cleanTitle,
  dismissError
} = musicStore

const showWaveform = computed(() => {
  try {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}')
    return settings.showWaveform !== false
  } catch {
    return true
  }
})

const onPlaylistPage = computed(() => {
  if (!route.path.startsWith('/music/playlist/') && !route.path.startsWith('/podcast/playlist/')) return false
  const id = route.params.id || route.path.split('/').pop()
  return isCurrentPlaylist(String(id))
})

const goToCurrentPlaylist = () => {
  if (!playlistId.value) return
  if (playlistId.value === 'my-songs' || playlistId.value === 'all-songs') {
    router.push(`/music/playlist/${playlistId.value}`)
    return
  }
  if (String(parseInt(playlistId.value)) === String(playlistId.value)) {
    const kind = playlist.value?.kind === 'podcast' ? 'podcast' : 'music'
    router.push(`/${kind}/playlist/${playlistId.value}`)
  }
}
</script>

<template>
  <WaveformVisual v-if="currentIndex >= 0 && showWaveform" :audioElement="audio" :playing="playing" :subtle="!onPlaylistPage" />
  <div v-if="currentIndex >= 0" class="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-3 z-[90]">
    <div v-if="playbackError" class="absolute bottom-full h-10 left-0 right-0 z-[100] bg-red-600 text-white text-sm px-4 py-2 rounded-t-lg flex justify-between items-center gap-2">
      <FontAwesomeIcon :icon="['fas', 'exclamation-triangle']" />
      <span>{{ playbackError }}</span>
      <button @click="dismissError" class="ml-2 text-white/70 hover:text-white">
        <FontAwesomeIcon :icon="['fas', 'times']" />
      </button>
    </div>
    <div class="absolute top-0 left-0 right-0">
      <div class="h-1 bg-gray-200" :style="{ width: `${(currentTime / duration) * 100}%` }"></div>
    </div>
    <div class="text-center mb-2">
      <span class="text-sm font-medium truncate">{{ cleanTitle(currentSong.title) }}</span>
      •
      <span class="text-xs text-gray-400 truncate">{{ currentSong.artist }}</span>
    </div>
    <div class="flex items-center justify-center gap-10">
      <button @click="goToCurrentPlaylist" :class="onPlaylistPage ? 'text-gray-400/70' : 'text-white'" class="w-6">
        <FontAwesomeIcon :icon="['fas', 'eye']" />
      </button>
      <button @click="prev" class="text-white">
        <FontAwesomeIcon :icon="['fas', 'backward']" />
      </button>
      <button @click="togglePlay" class="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black">
        <FontAwesomeIcon :icon="['fas', playing ? 'pause' : 'play']" />
      </button>
      <button @click="next" class="text-white">
        <FontAwesomeIcon :icon="['fas', 'forward']" />
      </button>
      <button @click="toggleRepeat" :class="repeat ? 'text-white' : 'text-gray-400/70'" class="w-6">
        <FontAwesomeIcon :icon="['fas', 'redo']" />
      </button>
    </div>
  </div>
</template>
