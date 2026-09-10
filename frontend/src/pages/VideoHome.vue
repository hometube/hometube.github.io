<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import { useUserStore } from '../stores/user.js'
import { useVideoStore } from '../stores/video.js'

const router = useRouter()
const userStore = useUserStore()
const videoStore = useVideoStore()

const searchQuery = ref('')

const filteredVideos = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return videoStore.filteredVideos
  return videoStore.filteredVideos.filter(v =>
    (v.title || '').toLowerCase().includes(q) ||
    (v.channel_name || '').toLowerCase().includes(q)
  )
})

const playerRef = ref(null)
const player = ref(null)
const videoUrl = ref(null)

const playVideo = async (vid) => {
  await videoStore.playVideo(vid)
  API.releaseUrl(videoUrl.value)
  videoUrl.value = await API.getVideoUrl(vid)
  await nextTick()
  if (playerRef.value && !player.value) {
    player.value = new Plyr(playerRef.value, {
      controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'speed', 'fullscreen'],
      speed: [0.5, 0.75, 1, 1.25, 1.5, 2]
    })
  }
}

watch(() => userStore.user, () => videoStore.load(), { immediate: true })
onMounted(() => videoStore.load())
</script>

<template>
  <div class="p-4 pt-16">
    <div class="flex items-center gap-2 mb-4">
      <input v-model="searchQuery" type="text" placeholder="Search videos by title or channel…"
        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-500" />
      <button @click="router.push('/video/add')" class="shrink-0 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm font-medium">
        <FontAwesomeIcon :icon="['fas', 'plus']" /> Add
      </button>
    </div>

    <div class="flex gap-2 mb-4 overflow-x-auto">
      <button v-for="f in videoStore.filters" :key="f.id" @click="videoStore.setFilter(f.id)"
        :class="['px-3 py-1 rounded-full text-sm whitespace-nowrap', videoStore.currentFilter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300']">
        {{ f.label }}
      </button>
    </div>

    <div v-if="videoStore.playingVideo" class="mb-4 bg-gray-900 rounded-lg p-2">
      <video ref="playerRef" :src="videoUrl" controls class="w-full rounded" crossorigin="anonymous" />
      <div class="flex items-center justify-between mt-2">
        <span class="text-sm">{{ videoStore.playingVideo.title }}</span>
        <div class="flex gap-2">
          <button @click="videoStore.toggleAudioMode()" :class="['px-3 py-1 rounded text-sm', videoStore.audioMode ? 'bg-green-600' : 'bg-gray-700']">
            <FontAwesomeIcon :icon="['fas', 'headphones']" /> {{ videoStore.audioMode ? 'On' : 'Off' }}
          </button>
          <button @click="videoStore.toggleKeep(videoStore.playingVideo)" :class="['px-3 py-1 rounded text-sm', videoStore.playingVideo.keep_flag ? 'bg-yellow-600' : 'bg-gray-700']">
            <FontAwesomeIcon :icon="['fas', 'save']" /> {{ videoStore.playingVideo.keep_flag ? 'Kept' : 'Keep' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="filteredVideos.length === 0" class="text-center py-8 text-gray-500">
      <template v-if="searchQuery.trim()">No videos match your search.</template>
      <template v-else>No videos found. Go to Add Video to get started!</template>
    </div>
    <div v-else class="space-y-2">
      <div v-for="v in filteredVideos" :key="v.id" class="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center justify-between">
        <div class="flex-1 cursor-pointer" @click="playVideo(v)">
          <div class="text-sm font-medium">{{ v.title }}</div>
          <div class="flex gap-2 mt-1">
            <span v-if="v.watched_at" class="text-xs text-gray-400"><FontAwesomeIcon :icon="['fas', 'eye']" /> Watched</span>
            <span v-if="v.keep_flag" class="text-xs text-yellow-400"><FontAwesomeIcon :icon="['fas', 'save']" /> Kept</span>
            <span v-if="v.downloaded" class="text-xs text-green-400">Downloaded</span>
          </div>
        </div>
        <div class="flex gap-2">
          <button v-if="!v.downloaded" @click="API.post(`/videos/${v.id}/download`, { quality: v.quality })" class="px-2 py-1 bg-blue-600 rounded text-xs">
            <FontAwesomeIcon :icon="['fas', 'download']" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
