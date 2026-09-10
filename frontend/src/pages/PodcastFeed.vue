<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { usePodcastStore } from '../stores/podcast.js'
import { useMusicStore } from '../stores/music.js'
import { isLocalMode } from '../api.js'

const router = useRouter()
const route = useRoute()
const podcastStore = usePodcastStore()
const musicStore = useMusicStore()

const feed = ref(null)
const loading = ref(true)
const queuing = ref(false)
const computing = ref(false)

const loadFeed = async () => {
  loading.value = true
  try {
    feed.value = await podcastStore.loadFeed(route.params.id)
  } catch (e) {
    feed.value = null
  } finally {
    loading.value = false
  }
}

const playAll = async (shuffled = false) => {
  if (!feed.value || !feed.value.episodes.length) return
  const episodes = [...feed.value.episodes]
  if (shuffled) episodes.sort(() => Math.random() - 0.5)
  musicStore.loadPlaylistSongs(episodes, { type: 'feed', name: feed.value.channel_name, kind: 'podcast' }, `feed-${feed.value.subscription_id}`)
  await nextTick()
  if (shuffled) musicStore.shufflePlay()
  else musicStore.playFirst()
}

const playEpisode = async (idx) => {
  if (!feed.value) return
  musicStore.loadPlaylistSongs(feed.value.episodes, { type: 'feed', name: feed.value.channel_name, kind: 'podcast' }, `feed-${feed.value.subscription_id}`)
  musicStore.playSong(idx)
}

const playEpisodeAndQueue = async (idx) => {
  if (!musicStore.hasActiveQueue || !musicStore.isInQueue(feed.value.episodes[idx].id)) {
    await playEpisode(idx)
  } else {
    musicStore.playSong(musicStore.displaySongs.findIndex(s => s.id === feed.value.episodes[idx].id))
  }
}

const checkNow = async () => {
  computing.value = true
  try {
    await podcastStore.checkNow(feed.value.subscription_id)
    await loadFeed()
  } finally {
    computing.value = false
  }
}

const unsubscribe = async () => {
  if (!confirm(`Unsubscribe from "${feed.value.channel_name}"? Episodes already in your library will be kept.`)) return
  await podcastStore.unsubscribe(feed.value.subscription_id)
  router.push('/podcast')
}

onMounted(loadFeed)
</script>

<template>
  <div class="fixed top-12 inset-0 bg-gray-900 z-50 flex flex-col">
    <div class="flex-1 overflow-hidden relative">
      <div class="relative z-10 h-full overflow-y-auto pb-24">
        <div class="p-4 py-8">
          <div class="font-bold text-lg text-center mb-1">{{ feed?.channel_name || 'Podcast' }}</div>
          <div v-if="feed?.channel_url" class="text-center text-xs text-gray-400 mb-4 truncate px-8">{{ feed.channel_url }}</div>
          <div v-if="feed" class="text-center text-xs text-gray-500 mb-6">
            {{ feed.episodes.length }} episodes
          </div>
          <div class="flex items-center justify-center gap-2 mb-6">
            <button @click="router.push('/podcast')" class="w-10 h-10 bg-gray-700 text-white rounded-full text-center text-sm font-medium">
              <FontAwesomeIcon :icon="['fas', 'arrow-left']" />
            </button>
            <button @click="playAll(false)" :disabled="!feed?.episodes.length || queuing" class="w-32 py-2 rounded-full text-center text-sm font-medium bg-white text-black disabled:bg-gray-700 disabled:text-gray-500">
              <FontAwesomeIcon :icon="['fas', 'play']" class="mr-2" />Play
            </button>
            <button @click="playAll(true)" :disabled="!feed?.episodes.length || queuing" class="w-32 py-2 rounded-full text-center text-sm font-medium bg-gray-700 text-white disabled:opacity-50">
              <FontAwesomeIcon :icon="['fas', 'random']" class="mr-2" />Shuffle
            </button>
            <button v-if="!isLocalMode()" @click="checkNow" :disabled="computing" class="sm:ml-2 p-2 rounded-full text-center text-sm font-medium bg-gray-700 text-white disabled:opacity-50">
              <FontAwesomeIcon :icon="['fas', 'rotate']" :spin="computing" />
            </button>
          </div>
        </div>

        <div class="p-4">
          <div v-if="loading" class="text-center py-8 text-gray-500">
            <FontAwesomeIcon :icon="['fas', 'spinner']" spin /> Loading episodes...
          </div>
          <div v-else-if="!feed" class="text-center py-8 text-gray-500">Feed not found.</div>
          <div v-else-if="feed.episodes.length === 0" class="text-center py-8 text-gray-500">
            No episodes yet. Tap <button class="text-blue-400 underline" @click="checkNow">Check</button> to fetch the latest.
          </div>
          <TransitionGroup v-else name="stagger" tag="div">
            <div v-for="(e, idx) in feed.episodes" :key="e.id"
              :style="{ '--i': idx }"
              class="flex items-center gap-3 p-3 rounded hover:bg-gray-800 cursor-pointer"
              @click="playEpisodeAndQueue(idx)">
              <div class="flex-1 min-w-0">
                <div class="text-sm truncate">{{ e.title }}</div>
                <div class="text-xs text-gray-400">{{ e.artist }}</div>
              </div>
              <div v-if="e.downloaded" class="text-xs text-gray-400 mr-1">
                <FontAwesomeIcon :icon="['fas', 'download']" />
              </div>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stagger-enter-active {
  animation: stagger-in 0.25s ease-out both;
  animation-delay: calc(var(--i, 0) * 25ms);
}

@keyframes stagger-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>