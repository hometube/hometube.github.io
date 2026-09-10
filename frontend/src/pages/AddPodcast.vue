<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { usePodcastStore } from '../stores/podcast.js'
import { useUserStore } from '../stores/user.js'
import { API } from '../api.js'

const router = useRouter()
const userStore = useUserStore()
const podcastStore = usePodcastStore()

const mode = ref('subscribe')
const url = ref('')
const loading = ref(false)

const subCriteria = ref({ keywords: '', min_length: null, max_length: null })
const subCheckInterval = ref(null)

const selectedPlaylistId = ref(null)
const newPlaylistName = ref('')

const subscribe = async () => {
  if (!url.value || !userStore.user) return
  loading.value = true
  try {
    const criteria = {}
    if (subCriteria.value.keywords) criteria.keywords = subCriteria.value.keywords.split(',').map(k => k.trim())
    if (subCriteria.value.min_length) criteria.min_length = parseInt(subCriteria.value.min_length)
    if (subCriteria.value.max_length) criteria.max_length = parseInt(subCriteria.value.max_length)
    const res = await podcastStore.subscribe(url.value, criteria, subCheckInterval.value || null)
    router.push('/podcast')
    alert(res?.backfilled ? `Subscribed! Added ${res.backfilled} episodes.` : 'Subscribed!')
  } finally {
    loading.value = false
  }
}

const addEpisode = async () => {
  if (!url.value || !userStore.user) return
  loading.value = true
  let playlistId = selectedPlaylistId.value
  if (newPlaylistName.value) {
    const pl = await API.post('/playlists', { name: newPlaylistName.value, user_id: userStore.user.id, kind: 'podcast' })
    playlistId = pl.id
  }
  try {
    await podcastStore.addEpisode(url.value, playlistId)
    url.value = ''
    router.push('/podcast')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  podcastStore.load()
})
</script>

<template>
  <div class="p-4 pt-16" v-if="userStore.user">
    <button @click="router.push('/podcast')" class="text-gray-400 mb-4">
      <FontAwesomeIcon :icon="['fas', 'arrow-left']" /> Back
    </button>
    <h2 class="text-xl font-bold mb-4">Add Podcast</h2>

    <div class="flex gap-2 mb-4">
      <button @click="mode = 'subscribe'"
        :class="['flex-1 py-2 rounded', mode === 'subscribe' ? 'bg-blue-600' : 'bg-gray-700']">
        Subscribe to Channel
      </button>
      <button @click="mode = 'episode'"
        :class="['flex-1 py-2 rounded', mode === 'episode' ? 'bg-blue-600' : 'bg-gray-700']">
        Add Episode
      </button>
    </div>

    <div v-if="mode === 'subscribe'">
      <input v-model="url" placeholder="Paste channel or video URL" class="w-full p-3 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
      <div class="mb-3">
        <label class="text-sm text-gray-400 mb-1 block">Keywords (comma-separated)</label>
        <input v-model="subCriteria.keywords" placeholder="e.g. news, interviews" class="w-full p-3 mb-2 bg-gray-800 border border-gray-700 rounded-lg text-white" />
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
      </div>
      <div>
        <label class="text-sm text-gray-400 mb-1 block">Check interval (minutes, optional)</label>
        <input v-model.number="subCheckInterval" type="number" placeholder="Default" class="w-full p-3 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
      </div>
      <button @click="subscribe" :disabled="loading || !url" class="w-full p-3 bg-green-600 rounded-lg text-white disabled:bg-gray-700">
        <FontAwesomeIcon :icon="['fas', 'rss']" /> {{ loading ? 'Subscribing...' : 'Subscribe' }}
      </button>
    </div>

    <div v-else>
      <input v-model="url" placeholder="Paste video or audio URL" class="w-full p-3 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
      <div class="mb-3">
        <label class="text-sm text-gray-400 mb-1 block">Playlist</label>
        <select v-model="selectedPlaylistId" class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white mb-2">
          <option :value="null">No playlist</option>
          <option v-for="pl in podcastStore.playlists" :key="pl.id" :value="pl.id">{{ pl.name }}</option>
        </select>
        <input v-model="newPlaylistName" placeholder="Or create new playlist..." class="w-full p-3 bg-gray-800 border border-gray-700 rounded-lg text-white" />
      </div>
      <button @click="addEpisode" :disabled="loading || !url" class="w-full p-3 bg-blue-600 rounded-lg text-white disabled:bg-gray-700">
        <FontAwesomeIcon :icon="['fas', 'music']" /> {{ loading ? 'Adding...' : 'Add Episode' }}
      </button>
    </div>
  </div>
</template>