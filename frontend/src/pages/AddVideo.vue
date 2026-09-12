<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useUserStore } from '../stores/user.js'
import { useVideoStore } from '../stores/video.js'
import { waitForServerDownload } from '../utils/downloads.js'

const router = useRouter()
const userStore = useUserStore()
const videoStore = useVideoStore()

const url = ref('')
const settings = JSON.parse(localStorage.getItem('settings') || '{}')
const quality = ref(settings.defaultVideoQuality || 'best')
const qualities = [
  { id: 'best', label: 'Best' },
  { id: 'best[height<=1080]', label: '1080p' },
  { id: 'best[height<=720]', label: '720p' },
  { id: 'best[height<=480]', label: '480p' }
]
const loading = ref(false)
const availableFormats = ref([])
const playlists = ref([])
const selectedPlaylist = ref(null)
const started = ref(false)

const fetchFormats = async () => {
  if (!url.value) return
  availableFormats.value = await API.get('/videos/info', { url: url.value })
}

const add = async () => {
  if (!url.value || !userStore.user) return
  loading.value = true
  await API.post('/videos/add', {
    url: url.value,
    user_id: userStore.user.id,
    quality: quality.value,
    playlist_id: selectedPlaylist.value || undefined
  })
  await videoStore.load()
  await videoStore.loadVideoPlaylists()
  const s = JSON.parse(localStorage.getItem('settings') || '{}')
  if (s.autoDownloadVideo !== false) {
    const items = await API.get('/videos', { user_id: userStore.user.id, filter: 'all' })
    const newItems = items.filter(v => !v.downloaded)
    const jobs = []
    for (const vid of newItems) {
      try {
        await API.post(`/videos/${vid.id}/download`, { quality: quality.value })
        jobs.push(vid.id)
      } catch (err) {
        console.error(`[AddVideo] download kickoff failed for ${vid.id}:`, err)
      }
    }
    if (jobs.length) {
      try {
        await Promise.all(jobs.map(itemId => waitForServerDownload({ type: 'video', itemId })))
        await videoStore.load()
        const done = await API.get('/videos', { user_id: userStore.user.id, filter: 'all' })
        const newDone = done.filter(v => newItems.some(n => n.id === v.id) && v.downloaded)
        if (newDone.length && !started.value) {
          started.value = true
          if (confirm(`"${newDone[0].title}" downloaded! Save to device?`)) {
            const hasFilename = !!newDone[0].filename
            API.downloadFile(hasFilename ? `/api/videos/${newDone[0].id}/file` : `/api/files/videos/${newDone[0].video_id}.mp4`, `${newDone[0].title}.mp4`)
          }
        }
      } catch (err) {
        console.error('[AddVideo] background download failed:', err)
      }
    }
  }
  url.value = ''
  availableFormats.value = []
  loading.value = false
}

onMounted(async () => {
  await videoStore.loadVideoPlaylists()
  playlists.value = videoStore.videoPlaylists
})
</script>

<template>
  <div class="p-4 pt-16" v-if="userStore.user">
    <button @click="router.push('/video')" class="text-gray-400 mb-4">
       <FontAwesomeIcon :icon="['fas', 'arrow-left']" /> Back
     </button>
    <h2 class="text-xl font-bold mb-4">Add Video</h2>
    <input v-model="url" @blur="fetchFormats" placeholder="Paste YouTube video or playlist URL" class="w-full p-3 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
    <div class="mb-3">
      <label class="text-sm text-gray-400 mb-1 block">Quality</label>
      <select v-model="quality" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
        <option v-for="q in qualities" :key="q.id" :value="q.id">{{ q.label }}</option>
      </select>
    </div>
    <div class="mb-3">
      <label class="text-sm text-gray-400 mb-1 block">Add to playlist (optional)</label>
      <select v-model="selectedPlaylist" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
        <option :value="null">None</option>
        <option v-for="p in playlists" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>
    <button @click="add" :disabled="loading || !url" class="w-full p-3 bg-blue-600 rounded-lg text-white disabled:bg-gray-700">
      <FontAwesomeIcon :icon="['fas', 'download']" /> {{ loading ? 'Adding...' : 'Add & Download' }}
    </button>
    <p v-if="availableFormats.length > 1" class="text-xs text-gray-500 mt-2">
      Playlist detected: {{ availableFormats.length }} videos will be added.
    </p>
  </div>
</template>