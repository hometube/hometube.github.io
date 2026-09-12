<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useUserStore } from '../stores/user.js'
import { useVideoStore, videoThumb } from '../stores/video.js'
import { waitForServerDownload } from '../utils/downloads.js'

const router = useRouter()
const userStore = useUserStore()
const videoStore = useVideoStore()

const searchQuery = ref('')
const section = ref('playlists') // 'playlists' | 'feed'
const downloadingId = ref(null)

const filteredVideos = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = videoStore.filteredVideos
  if (!q) return list
  return list.filter(v =>
    (v.title || '').toLowerCase().includes(q) ||
    (v.channel_name || '').toLowerCase().includes(q)
  )
})

const filteredPlaylists = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return videoStore.videoPlaylists
  return videoStore.videoPlaylists.filter(p =>
    (p.name || '').toLowerCase().includes(q)
  )
})

const playRow = async (v, list = filteredVideos.value) => {
  const idx = list.findIndex(i => i.id === v.id)
  if (idx < 0) return
  await videoStore.loadVideoPlaylists()
  await videoStore.playQueue(list, idx, { type: 'feed' })
}

const downloadVideo = async (v) => {
  if (downloadingId.value) return
  downloadingId.value = v.id
  try {
    await API.post(`/videos/${v.id}/download`, { quality: v.quality })
    await waitForServerDownload({ type: 'video', itemId: v.id })
    await videoStore.load()
  } catch (err) {
    console.error('[VideoHome] download failed:', err)
  } finally {
    downloadingId.value = null
  }
}

watch(() => userStore.user, () => {
  videoStore.load()
  videoStore.loadVideoPlaylists()
}, { immediate: true })

onMounted(() => {
  videoStore.load()
  videoStore.loadVideoPlaylists()
})
</script>

<template>
  <div class="p-4 pt-16">
    <div class="flex items-center gap-2 mb-4">
      <input v-model="searchQuery" type="text" placeholder="Search videos, channels, or playlists…"
        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-500" />
      <button @click="router.push('/video/add')" class="shrink-0 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm font-medium">
        <FontAwesomeIcon :icon="['fas', 'plus']" /> Add
      </button>
    </div>

    <div class="flex gap-2 mb-4 overflow-x-auto">
      <button @click="section = 'playlists'" :class="['px-3 py-1 rounded-full text-sm whitespace-nowrap', section === 'playlists' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300']">
        Playlists
      </button>
      <button @click="section = 'feed'" :class="['px-3 py-1 rounded-full text-sm whitespace-nowrap', section === 'feed' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300']">
        Feed
      </button>
    </div>

    <div v-if="section === 'feed'">
      <div class="flex gap-2 mb-4 overflow-x-auto">
        <button v-for="f in videoStore.filters" :key="f.id" @click="videoStore.setFilter(f.id)"
          :class="['px-3 py-1 rounded-full text-sm whitespace-nowrap', videoStore.currentFilter === f.id ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300']">
          {{ f.label }}
        </button>
      </div>

      <div v-if="filteredVideos.length === 0" class="text-center py-8 text-gray-500">
        <template v-if="searchQuery.trim()">No videos match your search.</template>
        <template v-else>No videos found. Go to Add Video to get started!</template>
      </div>
      <div v-else class="space-y-2">
        <div v-for="v in filteredVideos" :key="v.id" class="bg-gray-800 border border-gray-700 rounded-lg p-2 flex items-center gap-3">
          <button class="shrink-0" @click="playRow(v)">
            <div class="relative w-28 h-16 bg-black rounded overflow-hidden">
              <img v-if="videoThumb(v)" :src="videoThumb(v)" class="w-full h-full object-cover" alt="" />
              <div class="absolute inset-0 flex items-center justify-center">
                <FontAwesomeIcon :icon="['fas', 'play']" class="text-white text-lg drop-shadow" />
              </div>
              <span v-if="v.duration" class="absolute bottom-0.5 right-0.5 bg-black/70 text-[10px] px-1 rounded">{{ Math.floor(v.duration / 60) }}m</span>
            </div>
          </button>
          <div class="flex-1 min-w-0 cursor-pointer" @click="playRow(v)">
            <div class="text-sm font-medium truncate">{{ v.title }}</div>
            <div class="flex gap-2 mt-1 flex-wrap">
              <span v-if="v.watched_at" class="text-xs text-gray-400"><FontAwesomeIcon :icon="['fas', 'eye']" /> Watched</span>
              <span v-else-if="v.position && v.position > 0" class="text-xs text-blue-400"><FontAwesomeIcon :icon="['fas', 'rotate']" /> {{ Math.round(v.position / 60) }}m in</span>
              <span v-if="v.keep_flag" class="text-xs text-yellow-400"><FontAwesomeIcon :icon="['fas', 'save']" /> Kept</span>
              <span v-if="v.downloaded" class="text-xs text-green-400"><FontAwesomeIcon :icon="['fas', 'check-circle']" /></span>
            </div>
          </div>
          <div class="flex flex-col gap-1 shrink-0">
            <button @click="videoStore.toggleKeep(v)" :class="['px-2 py-1 rounded text-xs', v.keep_flag ? 'bg-yellow-600' : 'bg-gray-700']" title="Keep">
              <FontAwesomeIcon :icon="['fas', 'save']" />
            </button>
            <button v-if="!v.downloaded && downloadingId !== v.id" @click="downloadVideo(v)" class="px-2 py-1 bg-blue-600 rounded text-xs" title="Download">
              <FontAwesomeIcon :icon="['fas', 'download']" />
            </button>
            <span v-if="downloadingId === v.id" class="px-2 py-1 bg-blue-600 rounded text-xs text-center animate-pulse" title="Downloading…">
              <FontAwesomeIcon :icon="['fas', 'spinner']" spin />
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="section === 'playlists'">
      <div v-if="filteredPlaylists.length === 0" class="text-center py-8 text-gray-500">
        <template v-if="searchQuery.trim()">No playlists match your search.</template>
        <template v-else>No video playlists yet. Add one while adding videos or from a video player.</template>
      </div>
      <div v-else class="grid grid-cols-2 gap-3">
        <button v-for="p in filteredPlaylists" :key="p.id" @click="router.push(`/video/playlist/${p.id}`)"
          class="text-left rounded-xl p-4 min-h-[96px] bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700">
          <div class="font-medium text-sm text-blue-300"><FontAwesomeIcon :icon="['fas', 'list']" class="mr-1" /> {{ p.name }}</div>
          <div class="text-xs text-gray-400 mt-2">{{ videoStore.playlistSongCounts[p.id] || 0 }} videos</div>
        </button>
      </div>
    </div>
  </div>
</template>