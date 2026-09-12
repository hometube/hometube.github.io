<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useVideoStore, videoThumb } from '../stores/video.js'
import { isLocalMode } from '../api.js'

const route = useRoute()
const videoStore = useVideoStore()

const videoRef = ref(null)

const expanded = computed(() => route.path.startsWith('/video'))
const active = computed(() => !!videoStore.playingVideo)
const isSettings = computed(() => route.path === '/settings' || route.path === '/debug')

const progress = computed(() => {
  if (!videoStore.duration) return 0
  return Math.min(100, (videoStore.currentTime / videoStore.duration) * 100)
})

const showMini = computed(() => active.value && !expanded.value && !isSettings.value)

const bind = () => {
  if (videoRef.value) videoStore.bindElement(videoRef.value)
}

onMounted(bind)
watch(videoRef, bind)

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const formatTime = (s) => {
  const h = Math.floor(s / 3600)
  if (h > 0) {
    const m = Math.floor((s % 3600) / 60)
    return `${h}:${m.toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }
  return fmt(s)
}

const keep = async () => {
  await videoStore.toggleKeep(videoStore.playingVideo)
}

const addToPlaylist = async () => {
  const name = prompt('Playlist name (create or select existing)')
  if (!name || !name.trim()) return
  const existing = videoStore.videoPlaylists.find(p => p.name === name.trim())
  const pl = existing || (await videoStore.createVideoPlaylist(name.trim()))
  if (pl) await videoStore.addVideoToList(pl.id, videoStore.playingVideo.id)
}
</script>

<template>
  <!-- The <video> element is always mounted so playback never restarts on navigation. -->
  <div>
    <div :class="expanded && active ? 'sticky top-[60px] z-40 bg-gray-900 border-b border-gray-700' : ''">
      <video
        ref="videoRef"
        :class="expanded && active ? 'w-full bg-black block' : 'hidden'"
        :poster="active ? videoThumb(videoStore.playingVideo) : ''"
        controls
        playsinline
        controlslist="nodownload"
      />

      <div v-if="expanded && active" class="px-3 pb-3">
        <div class="text-sm font-medium py-2">{{ videoStore.playingVideo.title }}</div>
      <div class="flex flex-wrap items-center gap-2">
        <button @click="videoStore.prev()" class="px-3 py-1 bg-gray-700 rounded text-sm" title="Previous">
          <FontAwesomeIcon :icon="['fas', 'backward']" />
        </button>
        <button @click="videoStore.togglePlayPause()" class="px-3 py-1 bg-blue-600 rounded text-sm" title="Play/Pause">
          <FontAwesomeIcon :icon="['fas', videoStore.playing ? 'pause' : 'play']" />
        </button>
        <button @click="videoStore.next()" class="px-3 py-1 bg-gray-700 rounded text-sm" title="Next">
          <FontAwesomeIcon :icon="['fas', 'forward-step']" />
        </button>
        <button @click="videoStore.toggleShuffle()" :class="['px-3 py-1 rounded text-sm', videoStore.shuffled ? 'bg-green-600' : 'bg-gray-700']" title="Shuffle">
          <FontAwesomeIcon :icon="['fas', 'random']" />
        </button>
        <button @click="videoStore.toggleRepeat()" :class="['px-3 py-1 rounded text-sm', videoStore.repeat ? 'bg-green-600' : 'bg-gray-700']" title="Repeat">
          <FontAwesomeIcon :icon="['fas', 'redo']" />
        </button>
        <button @click="videoStore.toggleAudioMode()" :class="['px-3 py-1 rounded text-sm', videoStore.audioMode ? 'bg-green-600' : 'bg-gray-700']" title="Screen-off audio mode">
          <FontAwesomeIcon :icon="['fas', 'headphones']" />
        </button>
        <button @click="keep" :class="['px-3 py-1 rounded text-sm', videoStore.playingVideo.keep_flag ? 'bg-yellow-600' : 'bg-gray-700']" title="Keep">
          <FontAwesomeIcon :icon="['fas', 'save']" />
        </button>
        <button v-if="!isLocalMode()" @click="addToPlaylist" class="px-3 py-1 bg-gray-700 rounded text-sm" title="Add to playlist">
          <FontAwesomeIcon :icon="['fas', 'list']" />
        </button>
        <span class="ml-auto text-xs text-gray-400">{{ videoStore.buffering ? 'Buffering…' : `${formatTime(videoStore.currentTime)} / ${formatTime(videoStore.duration)}` }}</span>
      </div>
      </div>
    </div>

    <div v-if="showMini" class="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 px-3 py-2 flex items-center gap-3">
      <img
        :src="videoThumb(videoStore.playingVideo)"
        class="w-24 h-14 object-cover rounded bg-black"
        alt=""
        @click="videoStore.togglePlayPause()"
      />
      <div class="flex-1 min-w-0">
        <div class="text-xs font-medium truncate">{{ videoStore.playingVideo.title }}</div>
        <div class="mt-1 h-1.5 bg-gray-700 rounded overflow-hidden">
          <div class="h-full bg-blue-600" :style="{ width: progress + '%' }"></div>
        </div>
      </div>
      <button @click="videoStore.prev()" class="px-2 text-gray-300"><FontAwesomeIcon :icon="['fas', 'backward']" /></button>
      <button @click="videoStore.togglePlayPause()" class="px-2 text-white text-lg"><FontAwesomeIcon :icon="['fas', videoStore.playing ? 'pause' : 'play']" /></button>
      <button @click="videoStore.next()" class="px-2 text-gray-300"><FontAwesomeIcon :icon="['fas', 'forward-step']" /></button>
      <button @click="videoStore.stop()" class="px-2 text-gray-400"><FontAwesomeIcon :icon="['fas', 'times']" /></button>
    </div>
  </div>
</template>