<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { usePodcastStore } from '../stores/podcast.js'
import { useUserStore } from '../stores/user.js'
import { API, isLocalMode } from '../api.js'

const router = useRouter()
const podcastStore = usePodcastStore()
const userStore = useUserStore()

const searchQuery = ref('')
const episodeTitles = ref({})
const episodeCache = {}
let searchTimer = null

const query = computed(() => searchQuery.value.trim().toLowerCase())

const loadEpisodeTitles = async () => {
  if (!query.value) return
  const feeds = podcastStore.feeds.filter(f => !(f.subscription_id in episodeCache))
  if (feeds.length === 0) return
  await Promise.all(feeds.map(async (feed) => {
    try {
      const res = await API.get(`/podcasts/${feed.subscription_id}/episodes`, { user_id: userStore.user?.id })
      episodeCache[feed.subscription_id] = (res.episodes || []).map(e => (e.title || '').toLowerCase())
    } catch {
      episodeCache[feed.subscription_id] = []
    }
  }))
  episodeTitles.value = { ...episodeCache }
}

watch(searchQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadEpisodeTitles, 300)
})

const filteredFeeds = computed(() => {
  if (!query.value) return podcastStore.feeds
  return podcastStore.feeds.filter(f => {
    if ((f.channel_name || '').toLowerCase().includes(query.value)) return true
    return (episodeTitles.value[f.subscription_id] || []).some(t => t.includes(query.value))
  })
})

const filteredPlaylists = computed(() => {
  if (!query.value) return podcastStore.playlists
  return podcastStore.playlists.filter(p => (p.name || '').toLowerCase().includes(query.value))
})

const computing = ref(null)

const openFeed = (feed) => {
  router.push(`/podcast/feed/${feed.subscription_id}`)
}

const openPlaylist = (pl) => {
  router.push(`/podcast/playlist/${pl.id}`)
}

const checkFeed = async (feed) => {
  if (computing.value) return
  computing.value = feed.subscription_id
  try {
    await podcastStore.checkNow(feed.subscription_id)
  } finally {
    computing.value = null
  }
}

const unsubscribe = async (feed) => {
  if (!confirm(`Unsubscribe from "${feed.channel_name}"? Episodes already in your library will be kept.`)) return
  await podcastStore.unsubscribe(feed.subscription_id)
}

const deletePlaylist = async (e, pl) => {
  e.stopPropagation()
  if (!confirm(`Delete playlist "${pl.name}"?`)) return
  await API.delete(`/playlists/${pl.id}`)
  await podcastStore.load()
}

const formatDate = (iso) => {
  if (!iso) return 'Never'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

const computeBackground = (name) => {
  const hash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const hue = hash * 13 % 360
  const start = `hsla(${hue}, 35%, 10%, calc(0.8 * var(--opacity, 1)))`
  const end = `hsla(${hue}, 35%, 22%, calc(0.8 * var(--opacity, 1)))`
  const x = (hash % 50) + 25
  const y = ((hash >> 8) % 50) + 25
  return `radial-gradient(circle at ${x}% ${y}%, ${start}, ${end})`
}

onMounted(() => podcastStore.load())
</script>

<template>
  <div class="p-4 pt-16">
    <div class="flex items-center gap-2 mb-4">
      <input v-model="searchQuery" type="text" placeholder="Search feeds, playlists & episodes…"
        class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-500" />
      <button v-if="!isLocalMode()" @click="router.push('/podcast/add')" class="shrink-0 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm font-medium">
        <FontAwesomeIcon :icon="['fas', 'plus']" /> Add
      </button>
    </div>

    <div class="mb-4">
      <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Podcast Feeds</h2>
      <div v-if="podcastStore.loading" class="text-gray-500 py-8 text-center">
        <FontAwesomeIcon :icon="['fas', 'spinner']" spin /> Loading...
      </div>
      <Transition name="fade" mode="out-in">
        <div v-if="!podcastStore.loading && filteredFeeds.length === 0" key="empty" class="text-center py-6 text-gray-500">
          <template v-if="query">No feeds match your search.</template>
          <template v-else>No podcast subscriptions yet.</template>
        </div>
        <TransitionGroup v-else key="grid" name="stagger" tag="div" class="grid grid-cols-2 gap-2">
          <div v-for="(feed, i) in filteredFeeds" :key="feed.subscription_id" @click="openFeed(feed)"
            class="border border-gray-700 rounded-lg py-6 px-4 cursor-pointer hover:bg-gray-700 flex flex-col gap-1"
            :style="{ '--i': i, background: computeBackground(feed.channel_name) }"
          >
            <div class="text-lg font-medium leading-tight">{{ feed.channel_name }}</div>
            <div class="text-xs text-gray-300">{{ feed.episode_count }} episodes</div>
            <div class="text-xs text-gray-400">
              <FontAwesomeIcon :icon="['fas', 'download']" class="mr-1" />{{ feed.downloaded_count }} downloaded
            </div>
            <div class="text-xs text-gray-400">
              <FontAwesomeIcon :icon="['fas', 'clock']" class="mr-1" />Checked: {{ formatDate(feed.last_checked) }}
            </div>
            <div class="flex gap-2 mt-2" @click.stop>
              <button v-if="!isLocalMode()" @click="checkFeed(feed)" :disabled="computing === feed.subscription_id"
                class="flex-1 text-xs p-2 rounded bg-gray-600 text-white disabled:opacity-50">
                <FontAwesomeIcon :icon="['fas', 'rotate']" :spin="computing === feed.subscription_id" class="mr-1" />Check
              </button>
              <button @click="unsubscribe(feed)" class="flex-1 text-xs p-2 rounded bg-gray-600 hover:text-red-400 text-white">
                <FontAwesomeIcon :icon="['fas', 'trash']" class="mr-1" />Unsub
              </button>
            </div>
          </div>
        </TransitionGroup>
      </Transition>
    </div>

    <div class="mb-4">
      <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">Podcast Playlists</h2>
      <div v-if="filteredPlaylists.length === 0" class="text-center py-6 text-gray-500">
        <template v-if="query">No playlists match your search.</template>
        <template v-else>No podcast playlists yet.</template>
      </div>
      <TransitionGroup name="stagger" tag="div" class="grid grid-cols-2 gap-2">
        <div v-for="(pl, i) in filteredPlaylists" :key="pl.id" @click="openPlaylist(pl)"
          class="border border-gray-700 rounded-lg py-6 px-4 cursor-pointer hover:bg-gray-700 flex items-center justify-between"
          :style="{ '--i': i, background: computeBackground(pl.name) }"
        >
          <div>
            <div class="text-lg font-medium">{{ pl.name }}</div>
            <div class="text-xs text-gray-400">{{ (pl.songs || []).length }} episodes</div>
          </div>
          <button @click="(e) => deletePlaylist(e, pl)" class="hidden sm:block text-gray-500 hover:text-red-400">
            <FontAwesomeIcon :icon="['fas', 'trash']" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.stagger-enter-active {
  animation: stagger-in 0.5s ease-out both;
  animation-delay: calc(var(--i, 0) * 100ms);
}

@keyframes stagger-in {
  from {
    --opacity: 0;
  }
  to {
    --opacity: 1;
  }
}
</style>