<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useUserStore } from '../stores/user.js'
import { useMusicStore } from '../stores/music.js'
import { API, isLocalMode } from '../api.js'

const router = useRouter()
const userStore = useUserStore()
const musicStore = useMusicStore()

const searchQuery = ref('')

const norm = (s) => (s || '').toLowerCase()

const query = computed(() => norm(searchQuery.value.trim()))

const songMatches = computed(() => {
  const q = query.value
  if (!q) return null
  const matches = new Set()
  for (const s of musicStore.songs) {
    if (norm(s.title).includes(q) || norm(s.artist).includes(q) || norm(s.filename).includes(q)) {
      matches.add(s.id)
    }
  }
  return matches
})

const filteredPlaylists = computed(() => {
  const pls = musicStore.playlists
  if (query.value) {
    const set = songMatches.value
    return pls.filter(p => {
      if (norm(p.name).includes(query.value)) return true
      return (p.songs || []).some(sp => set.has(sp.music_id))
    })
  }
  return pls
})

const filteredVirtualPlaylists = computed(() => {
  const vps = visibleVirtualPlaylists.value
  if (query.value) {
    const set = songMatches.value
    return vps.filter(vp => {
      if (norm(vp.name).includes(query.value)) return true
      const songs = (vp.songs || []).filter(s => set.has(s.id))
      return songs.length > 0
    })
  }
  return vps
})

const totalShown = computed(() => filteredPlaylists.value.length + filteredVirtualPlaylists.value.length)

const visibleVirtualPlaylists = computed(() => {
  const settings = JSON.parse(localStorage.getItem('settings') || '{}')
  if (settings.showVirtualPlaylists === false) return []
  const vps = musicStore.virtualPlaylists
  if (isLocalMode()) return vps.filter(vp => vp.id === 'all-songs')
  return vps
})

watch(() => userStore.user, (user) => {
  if (user) musicStore.load()
}, { immediate: true })

onMounted(() => {
  if (userStore.user) musicStore.load()
})

const openPlaylist = (pl) => {
  router.push(`/music/playlist/${pl.id}`)
}

const openVirtual = (vp) => {
  router.push(`/music/playlist/${vp.id}`)
}

const deletePlaylist = async (e, pl) => {
  e.stopPropagation()
  if (!confirm(`Delete playlist "${pl.name}"?`)) return
  await API.delete(`/playlists/${pl.id}`)
  await musicStore.load()
}

const computeBackground = (name) => {
  const hash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const hue = hash * 7 % 360
  const start = `hsla(${hue}, 30%, 10%, calc(0.8 * var(--opacity, 1)))`
  const end = `hsla(${hue}, 30%, 20%, calc(0.8 * var(--opacity, 1)))`
  const x = (hash % 50) + 25
  const y = ((hash >> 8) % 50) + 25
  return `radial-gradient(circle at ${x}% ${y}%, ${start}, ${end})`
}
</script>

<template>
  <div class="p-4 pt-16">
    <div class="mb-4">
      <div class="flex items-center gap-2 mb-4">
        <input v-model="searchQuery" type="text" placeholder="Search playlists & songs…"
          class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-gray-500" />
        <button @click="router.push('/music/add')" class="shrink-0 px-4 py-2 bg-blue-600 rounded-lg text-white text-sm font-medium">
          <FontAwesomeIcon :icon="['fas', 'plus']" /> Add
        </button>
      </div>
      <Transition name="fade" mode="out-in">
        <div v-if="totalShown === 0" key="empty" class="text-center py-8 text-gray-500">
          <template v-if="query && (musicStore.playlists.length || visibleVirtualPlaylists.length)">No matches found.</template>
          <template v-else>No playlists yet. Add music to create one.</template>
        </div>
        <TransitionGroup v-else key="grid" name="stagger" tag="div" class="grid grid-cols-2 gap-2">
          <div v-for="(pl, i) in filteredPlaylists" :key="pl.id" @click="openPlaylist(pl)"
            class="border border-gray-700 rounded-lg py-6 px-4 cursor-pointer hover:bg-gray-700 flex items-center justify-between"
            :style="{ '--i': i, background: computeBackground(pl.name) }"
          >
            <div>
              <div class="text-lg font-medium">{{ pl.name }}</div>
              <div class="text-xs text-gray-400">{{ (pl.songs || []).length }} songs</div>
            </div>
            <button @click="(e) => deletePlaylist(e, pl)" class="hidden sm:block text-gray-500 hover:text-red-400">
              <FontAwesomeIcon :icon="['fas', 'trash']" />
            </button>
          </div>
        </TransitionGroup>
      </Transition>
      <TransitionGroup name="stagger" tag="div" class="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-gray-700">
        <div v-for="(vp, i) in filteredVirtualPlaylists" :key="vp.id" @click="openVirtual(vp)"
          :style="{ '--i': i }"
          class="bg-gray-800 border border-gray-700 rounded-lg py-6 px-4 cursor-pointer hover:bg-gray-700">
          <div class="text-lg font-medium">{{ vp.name }}</div>
          <div class="text-xs text-gray-400">{{ vp.songs.length }} songs</div>
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
