<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API } from '../api.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useUserStore } from '../stores/user.js'
import { waitForServerDownload } from '../utils/downloads.js'

const router = useRouter()
const userStore = useUserStore()

const url = ref('')
const mode = ref('select')
const channelVideos = ref([])
const selectedVideos = ref([])
const channelId = ref(null)
const loading = ref(false)
const settings = JSON.parse(localStorage.getItem('settings') || '{}')
const quality = ref(settings.defaultSubQuality || 'best')
const subCriteria = ref({ keywords: '', min_length: null, max_length: null, quality: settings.defaultSubQuality || 'best' })

const loadChannelVideos = async () => {
  if (!url.value) return
  loading.value = true
  const channels = await API.get('/channels')
  let chan = channels.find(c => c.url === url.value)
  if (!chan) {
    chan = await API.post('/channels/add', { url: url.value })
  }
  channelId.value = chan.id
  channelVideos.value = await API.get('/channels/' + chan.id + '/videos')
  loading.value = false
}

const toggleSelect = (vid) => {
  const idx = selectedVideos.value.findIndex(v => v.id === vid.id)
  if (idx >= 0) {
    selectedVideos.value.splice(idx, 1)
  } else {
    selectedVideos.value.push(vid)
  }
}

const downloadSelected = async () => {
  loading.value = true
  const added = []
  for (const vid of selectedVideos.value) {
    const vidUrl = vid.url || 'https://youtube.com/watch?v=' + vid.id
    const created = await API.post('/videos/add', { url: vidUrl, user_id: userStore.user.id, quality: quality.value })
    const newVid = Array.isArray(created) ? created[0] : created
    if (newVid && newVid.id) {
      added.push(newVid.id)
      try {
        await API.post('/videos/' + newVid.id + '/download', { quality: quality.value })
      } catch (err) {
        console.error('[AddChannel] download kickoff failed:', err)
      }
    }
  }
  if (added.length) {
    try {
      await Promise.all(added.map(itemId => waitForServerDownload({ type: 'video', itemId })))
    } catch (err) {
      console.error('[AddChannel] background download failed:', err)
    }
  }
  selectedVideos.value = []
  loading.value = false
}

const subscribe = async () => {
  if (!channelId.value) return
  const criteria = {}
  if (subCriteria.value.keywords) criteria.keywords = subCriteria.value.keywords.split(',').map(k => k.trim())
  if (subCriteria.value.min_length) criteria.min_length = parseInt(subCriteria.value.min_length)
  if (subCriteria.value.max_length) criteria.max_length = parseInt(subCriteria.value.max_length)
  criteria.quality = subCriteria.value.quality
  await API.post('/channels/' + channelId.value + '/subscribe', { user_id: userStore.user.id, criteria: criteria })
  alert('Subscribed!')
}
</script>

<template>
  <div class="p-4 pt-16" v-if="userStore.user">
    <button @click="router.push('/video')" class="text-gray-400 mb-4">
       <FontAwesomeIcon :icon="['fas', 'arrow-left']" /> Back
     </button>
    <h2 class="text-xl font-bold mb-4">Add Channel</h2>
    <input v-model="url" placeholder="Paste YouTube channel URL" class="w-full p-3 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
    <div class="flex gap-2 mb-3">
      <button @click="mode = 'select'" :class="['flex-1 py-2 rounded', mode === 'select' ? 'bg-blue-600' : 'bg-gray-700']">Select Videos</button>
      <button @click="mode = 'subscribe'" :class="['flex-1 py-2 rounded', mode === 'subscribe' ? 'bg-blue-600' : 'bg-gray-700']">Subscribe</button>
    </div>

    <button @click="loadChannelVideos" :disabled="loading || !url" class="w-full p-3 bg-gray-700 rounded-lg text-white mb-4">
      {{ loading ? 'Loading...' : 'Load Channel' }}
    </button>

    <div v-if="mode === 'select'" class="space-y-2">
      <div v-for="v in channelVideos" :key="v.id" @click="toggleSelect(v)"
        :class="['p-3 rounded-lg cursor-pointer', selectedVideos.find(s => s.id === v.id) ? 'bg-blue-900 border-blue-600' : 'bg-gray-800 border-gray-700']">
        <div class="text-sm">{{ v.title }}</div>
      </div>
      <button v-if="selectedVideos.length" @click="downloadSelected" class="w-full p-3 bg-blue-600 rounded-lg text-white">
        Download {{ selectedVideos.length }} Videos
      </button>
    </div>

    <div v-if="mode === 'subscribe'" class="space-y-3">
      <div>
        <label class="text-sm text-gray-400">Keywords (comma-separated)</label>
        <input v-model="subCriteria.keywords" placeholder="e.g. music, live" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
      </div>
      <div class="flex gap-2">
        <div class="flex-1">
          <label class="text-sm text-gray-400">Min length (sec)</label>
          <input v-model.number="subCriteria.min_length" type="number" placeholder="0" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
        </div>
        <div class="flex-1">
          <label class="text-sm text-gray-400">Max length (sec)</label>
          <input v-model.number="subCriteria.max_length" type="number" placeholder="0" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
        </div>
      </div>
      <div>
        <label class="text-sm text-gray-400">Quality</label>
        <select v-model="subCriteria.quality" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white">
          <option value="best">Best</option>
          <option value="best[height<=1080]">1080p</option>
          <option value="best[height<=720]">720p</option>
          <option value="best[height<=480]">480p</option>
        </select>
      </div>
      <button @click="subscribe" class="w-full p-3 bg-green-600 rounded-lg text-white">Subscribe</button>
    </div>
  </div>
</template>
