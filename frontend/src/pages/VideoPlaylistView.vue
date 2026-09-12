<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useVideoStore, videoThumb } from '../stores/video.js'
import { API } from '../api.js'
import { isLocalMode } from '../api.js'
import { waitForServerDownload } from '../utils/downloads.js'

const route = useRoute()
const router = useRouter()
const videoStore = useVideoStore()

const playlist = ref(null)
const members = ref([])
const loading = ref(true)
const manage = ref(false)

const playlistId = computed(() => Number(route.params.id))

const load = async () => {
  loading.value = true
  await Promise.all([videoStore.load(), videoStore.loadVideoPlaylists()])
  const byId = new Map(videoStore.videos.map(v => [v.id, v]))
  playlist.value = videoStore.videoPlaylists.find(p => p.id === playlistId.value) || null
  members.value = ((playlist.value && playlist.value.songs) || [])
    .filter(s => s && s.type === 'video')
    .map(s => ({ ...s, video: byId.get(s.video_id) }))
    .filter(m => m.video)
  loading.value = false
}

onMounted(load)

const playAll = async (index = 0) => {
  const list = members.value.map(m => m.video)
  await videoStore.playQueue(list, index, { type: 'playlist', id: playlistId.value })
}

const shufflePlay = async () => {
  const list = members.value.map(m => m.video)
  await videoStore.shufflePlay(list, { type: 'playlist', id: playlistId.value })
}

const remove = async (m) => {
  await videoStore.removeVideoFromList(playlistId.value, m.video.id)
  members.value = members.value.filter(x => x.video.id !== m.video.id)
  const pl = videoStore.videoPlaylists.find(p => p.id === playlistId.value)
  if (pl) {
    pl.songs = pl.songs.filter(s => !(s.type === 'video' && s.video_id === m.video.id))
  }
}

const move = (idx, dir) => {
  const target = idx + dir
  if (target < 0 || target >= members.value.length) return
  const arr = [...members.value]
  ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
  members.value = arr
  persistOrder()
}

const persistOrder = async () => {
  const songs = members.value.map((m, i) => ({ video_id: m.video.id, position: i, type: 'video' }))
  await videoStore.savePlaylistOrder(playlistId.value, songs)
  const pl = videoStore.videoPlaylists.find(p => p.id === playlistId.value)
  if (pl) pl.songs = songs
}

const rename = async () => {
  const name = prompt('Playlist name', playlist.value?.name || '')
  if (!name || !name.trim()) return
  await videoStore.renameVideoPlaylist(playlistId.value, name.trim())
  await load()
}

const removePlaylist = async () => {
  if (!confirm(`Delete playlist "${playlist.value?.name}"?`)) return
  await videoStore.deleteVideoPlaylist(playlistId.value)
  router.push('/video')
}

const tapRow = (m, idx) => {
  if (manage.value) return
  playAll(idx)
}

const downloadVideo = async (m) => {
  await API.post(`/videos/${m.video.id}/download`, { quality: m.video.quality })
  try {
    await waitForServerDownload({ type: 'video', itemId: m.video.id })
    m.video.downloaded = true
  } catch (err) {
    console.error('[VideoPlaylistView] download failed:', err)
  }
}
</script>

<template>
  <div class="p-4 pt-16">
    <div class="flex items-center gap-2 mb-4">
      <button @click="router.push('/video')" class="px-3 py-1 bg-gray-700 rounded-lg text-sm">
        <FontAwesomeIcon :icon="['fas', 'arrow-left']" /> Back
      </button>
      <h2 class="text-lg font-bold truncate">{{ playlist?.name || 'Video Playlist' }}</h2>
    </div>

    <div class="flex flex-wrap gap-2 mb-4">
      <button @click="playAll(0)" class="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium">
        <FontAwesomeIcon :icon="['fas', 'play']" /> Play All
      </button>
      <button @click="shufflePlay" class="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium">
        <FontAwesomeIcon :icon="['fas', 'random']" /> Shuffle
      </button>
      <button @click="manage = !manage" :class="['px-4 py-2 rounded-lg text-sm', manage ? 'bg-green-600' : 'bg-gray-700']">Manage</button>
      <button @click="rename" class="px-4 py-2 bg-gray-700 rounded-lg text-sm"><FontAwesomeIcon :icon="['fas', 'pencil']" /> Rename</button>
      <button @click="removePlaylist" class="px-4 py-2 bg-red-900 rounded-lg text-sm"><FontAwesomeIcon :icon="['fas', 'trash']" /> Delete</button>
    </div>

    <div v-if="loading" class="text-center py-10 text-gray-500">Loading…</div>
    <div v-else-if="members.length === 0" class="text-center py-10 text-gray-500">This playlist is empty.</div>
    <div v-else class="space-y-2">
      <div v-for="(m, idx) in members" :key="m.video.id" class="bg-gray-800 border border-gray-700 rounded-lg p-2 flex items-center gap-3">
        <button class="shrink-0" @click="tapRow(m, idx)">
          <div class="relative w-28 h-16 bg-black rounded overflow-hidden">
            <img v-if="videoThumb(m.video)" :src="videoThumb(m.video)" class="w-full h-full object-cover" alt="" />
            <div class="absolute inset-0 flex items-center justify-center">
              <FontAwesomeIcon :icon="manage ? ['fas', 'bars'] : ['fas', 'play']" class="text-white text-lg drop-shadow" />
            </div>
          </div>
        </button>
        <div class="flex-1 min-w-0 cursor-pointer" @click="tapRow(m, idx)">
          <div class="text-sm font-medium truncate">{{ m.video.title }}</div>
          <div class="text-xs text-gray-400 mt-0.5">
            <span v-if="m.video.watched_at"><FontAwesomeIcon :icon="['fas', 'eye']" /> Watched</span>
            <span v-else-if="m.video.position" class="text-blue-400"><FontAwesomeIcon :icon="['fas', 'rotate']" /> {{ Math.round(m.video.position / 60) }}m in</span>
            <span v-if="m.video.downloaded" class="text-green-400 ml-2"><FontAwesomeIcon :icon="['fas', 'check-circle']" /></span>
          </div>
        </div>
        <div v-if="manage" class="flex flex-col shrink-0">
          <button :disabled="idx === 0" @click="move(idx, -1)" class="px-2 py-0.5 text-gray-300 disabled:opacity-30"><FontAwesomeIcon :icon="['fas', 'chevron-up']" /></button>
          <button :disabled="idx === members.length - 1" @click="move(idx, 1)" class="px-2 py-0.5 text-gray-300 disabled:opacity-30"><FontAwesomeIcon :icon="['fas', 'chevron-down']" /></button>
        </div>
        <div v-else class="flex flex-col gap-1 shrink-0">
          <button @click="remove(m)" class="px-2 py-1 bg-red-900 rounded text-xs" title="Remove from playlist"><FontAwesomeIcon :icon="['fas', 'times']" /></button>
          <button v-if="!m.video.downloaded && !isLocalMode()" @click="downloadVideo(m)" class="px-2 py-1 bg-blue-600 rounded text-xs" title="Download"><FontAwesomeIcon :icon="['fas', 'download']" /></button>
        </div>
      </div>
    </div>
  </div>
</template>