<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { API } from '../api.js'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import SongMenu from '../components/SongMenu.vue'
import PlaylistMenu from '../components/PlaylistMenu.vue'
import { useUserStore } from '../stores/user.js'
import { useMusicStore } from '../stores/music.js'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const musicStore = useMusicStore()

const {
  playlist,
  playlistId,
  displaySongs,
  currentIndex,
  shuffled,
  playing,
  audio,
  currentTime,
  duration,
  currentSong,
  hasActiveQueue,
} = storeToRefs(musicStore)

const {
  playSong,
  togglePlay,
  next,
  prev,
  toggleRepeat,
  playFirst,
  shufflePlay,
  loadPlaylistSongs,
  isCurrentPlaylist,
  formatTime,
  cleanTitle,
  stop,
  isInQueue,
  addToQueueNext,
  addToQueue,
  removeFromQueue,
  load,
} = musicStore

const isPodcast = computed(() => route.name === 'podcast-playlist')
const kind = computed(() => isPodcast.value ? 'podcast' : 'music')

const showPlaylistMenu = ref(false)
const showSongMenu = ref(false)
const menuSong = ref(null)

const openSongMenu = (song) => {
  menuSong.value = song
  showSongMenu.value = true
}

const closeMenu = () => {
  showSongMenu.value = false
  menuSong.value = null
}

const handlePlay = () => {
  if (!menuSong.value) return
  const idx = displaySongs.value.findIndex(s => s.id === menuSong.value.id)
  if (idx >= 0) playSong(idx)
  closeMenu()
}

const handlePlayNext = () => {
  if (!menuSong.value) return
  addToQueueNext(menuSong.value)
  closeMenu()
}

const handleAddToQueue = () => {
  if (!menuSong.value) return
  addToQueue(menuSong.value)
  closeMenu()
}

const handleRemoveFromQueue = () => {
  if (!menuSong.value) return
  removeFromQueue(menuSong.value.id)
  closeMenu()
}

const handleRemoveFromPlaylist = async () => {
  if (!menuSong.value || !playlist.value || playlist.value.type === 'virtual') return
  await API.delete(`/playlists/${playlist.value.id}/remove/${menuSong.value.id}`)
  loadPlaylist()
  closeMenu()
}

const downloadedSongs = computed(() => displaySongs.value.filter(s => s.downloaded))

const otherPlaylists = computed(() => {
  const all = musicStore.playlists.filter(p => (p.kind || 'music') === kind.value)
  if (!playlist.value || playlist.value.type === 'virtual') return all
  return all.filter(p => p.id !== playlist.value.id)
})

const menuSongInQueue = computed(() => isInQueue(menuSong.value?.id))

const handleAddToPlaylist = async (pl) => {
  if (!menuSong.value) return
  await API.post(`/playlists/${pl.id}/add`, { music_id: menuSong.value.id })
  load(kind.value)
  closeMenu()
}

const createNewPlaylist = async () => {
  if (!menuSong.value || !userStore.user) return
  const name = prompt('Playlist name:')
  if (!name) return
  const pl = await API.post('/playlists', { name, user_id: userStore.user.id, kind: kind.value })
  await API.post(`/playlists/${pl.id}/add`, { music_id: menuSong.value.id })
  load(kind.value)
  closeMenu()
}

const handleDeleteSong = async () => {
  if (!menuSong.value) return
  if (!confirm(`Delete "${cleanTitle(menuSong.value.title)}"? This cannot be undone.`)) return
  await API.delete(`/music/${menuSong.value.id}`)
  await load(kind.value)
  loadPlaylist()
  closeMenu()
}

const handleRenamePlaylist = async () => {
  if (!playlist.value || playlist.value.type === 'virtual') return
  const name = prompt('Rename playlist:', playlist.value.name)
  if (!name || name === playlist.value.name) return
  await API.put(`/playlists/${playlist.value.id}`, { name })
  playlist.value.name = name
  await load(kind.value)
}

const handleDeletePlaylist = async () => {
  if (!playlist.value || playlist.value.type === 'virtual') return
  if (!confirm(`Delete playlist "${playlist.value.name}"?`)) return
  await API.delete(`/playlists/${playlist.value.id}`)
  await load(kind.value)
  router.push(kind.value === 'podcast' ? '/podcast' : '/music')
}

const handleDownloadPlaylist = async () => {
  if (!playlist.value || playlist.value.type === 'virtual' || !displaySongs.value.length) return
  for (const song of displaySongs.value) {
    if (!song.downloaded) {
      API.cache(`/music/${song.id}/file`, { ttl: Infinity, refetch: false }, false)
    }
  }
  displaySongs.value = displaySongs.value.map(s => ({ ...s, downloaded: true }))
}

const download = async () => {
  if (!menuSong.value) return
  API.cache(`/music/${menuSong.value}/file`, { ttl: Infinity, refetch: false }, false)
  const idx = displaySongs.value.findIndex(s => s.id === menuSong.value.id)
  if (idx >= 0) displaySongs.value[idx].downloaded = true
  closeMenu()
}

const isOffline = computed(() => userStore.checked && !userStore.online)

const loading = ref(true)
const error = ref(null)

const loadPlaylist = async () => {
  const { id } = route.params
  loading.value = true
  error.value = null
  displaySongs.value = []
  playlist.value = null
  currentIndex.value = -1

  if (!id) {
    error.value = 'No playlist specified'
    loading.value = false
    return
  }

  if (!userStore.user) {
    error.value = 'Please select a user first'
    loading.value = false
    return
  }

  try {
    let pl = null
    let songs = []

    if (id === 'my-songs') {
      const allSongs = await API.get('/music', { user_id: userStore.user.id })
      pl = { type: 'virtual', name: 'My Songs' }
      songs = allSongs.filter(m => m.added_by === userStore.user.id)
    } else if (id === 'all-songs') {
      const allSongs = await API.get('/music', { user_id: userStore.user.id })
      pl = { type: 'virtual', name: 'All Songs' }
      songs = allSongs
    } else {
      const playlists = await API.get('/playlists', { user_id: userStore.user.id, kind: kind.value })
      const found = playlists.find(p => p.id === parseInt(id))
      if (found) {
        pl = found
        const allMusic = await API.get('/music', { user_id: userStore.user.id, kind: kind.value })
        songs = (found.songs || [])
          .map(s => allMusic.find(m => m.id === s.music_id))
          .filter(Boolean)
      }
    }

    if (pl) {
      loadPlaylistSongs(songs, pl, id)
    } else {
      error.value = 'Playlist not found'
    }
    load(kind.value)
    scrollToCurrentSong()
  } catch (e) {
    error.value = 'Failed to load playlist'
    console.error('Failed to load playlist:', e)
  } finally {
    loading.value = false
  }
}

const close = () => {
  router.push(kind.value === 'podcast' ? '/podcast' : '/music')
}

const scrollToCurrentSong = async () => {
  await nextTick()
  const el = document.querySelector('[data-active-song]')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

watch(() => route.params.id, () => {
  loadPlaylist()
}, { immediate: true })

watch(currentIndex, () => {
  scrollToCurrentSong()
})
</script>

<template>
  <div class="fixed top-12 inset-0 bg-gray-900 z-50 flex flex-col">
    <div class="flex-1 overflow-hidden relative">
      <div class="relative z-10 h-full overflow-y-auto pb-24">
        <div class="p-4 py-8">
          <div class="font-bold text-lg text-center mb-4">{{ playlist?.name || 'Songs' }}</div>
          <div class="flex items-center justify-center gap-2 mb-6">
            <button @click="close" class="sm:w-32 sm:h-auto w-10 h-10 bg-gray-700 text-white sm:py-2 rounded-full text-center text-sm font-medium">
              <FontAwesomeIcon :icon="['fas', 'arrow-left']" /><span class="sm:inline hidden sm:ml-2">Back</span>
            </button>
            <button @click="playFirst"
              :class="['w-32 py-2 rounded-full text-center text-sm font-medium', isOffline && !downloadedSongs.length ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-white text-black']"
              :disabled="isOffline && !downloadedSongs.length">
              <FontAwesomeIcon :icon="['fas', 'play']" class="mr-2" />Play
            </button>
            <button @click="shufflePlay"
              :class="['w-32 py-2 rounded-full text-center text-sm font-medium', isOffline && !downloadedSongs.length ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-700 text-white']"
              :disabled="isOffline && !downloadedSongs.length">
              <FontAwesomeIcon :icon="['fas', 'random']" class="mr-2" />Shuffle
            </button>
            <button @click="showPlaylistMenu = true"
              :class="['sm:-mr-10 p-2 rounded-full text-center text-sm font-medium bg-gray-700 text-white']"
            >
              <FontAwesomeIcon :icon="['fas', 'ellipsis-v']" />
            </button>
          </div>
        </div>

        <div class="p-4">
          <TransitionGroup name="stagger" tag="div">
            <div v-for="(s, idx) in displaySongs" :key="s.id"
              :data-active-song="idx === currentIndex || undefined"
              :style="{ '--i': idx }"
              class="flex items-center gap-3 p-3 rounded"
              :class="{
                'bg-gray-800': idx === currentIndex,
                'opacity-50': isOffline && !s.downloaded,
                'hover:bg-gray-800': !isOffline || s.downloaded,
                'cursor-pointer': !isOffline || s.downloaded,
                'cursor-default': isOffline && !s.downloaded,
              }"
              @click="(!isOffline || s.downloaded) && playSong(idx)">
              <div class="flex-1">
                <div class="text-sm">{{ cleanTitle(s.title) }}</div>
                <div class="text-xs text-gray-400">{{ s.artist }}</div>
              </div>
              <div v-if="s.downloaded" class="text-xs text-gray-400 mr-1">
                <FontAwesomeIcon :icon="['fas', 'download']" />
              </div>
              <button @click.stop="openSongMenu(s)" class="text-gray-400 px-2">
                <FontAwesomeIcon :icon="['fas', 'ellipsis-v']" />
              </button>
            </div>
          </TransitionGroup>
        </div>
      </div>
    </div>

    <Transition name="menu">
      <PlaylistMenu
        v-if="showPlaylistMenu"
        :playlist="playlist"
        @close="showPlaylistMenu = false"
        @download="handleDownloadPlaylist"
        @rename="handleRenamePlaylist"
        @delete="handleDeletePlaylist"
      />
    </Transition>

    <Transition name="menu">
      <SongMenu
        v-if="showSongMenu"
        :song="menuSong"
        :playlist="playlist"
        :downloaded="menuSong?.downloaded"
        :has-active-queue="hasActiveQueue"
        :in-queue="menuSongInQueue"
        :other-playlists="otherPlaylists"
        :clean-title="cleanTitle"
        @close="closeMenu"
        @play="handlePlay"
        @play-next="handlePlayNext"
        @add-to-queue="handleAddToQueue"
        @remove-from-queue="handleRemoveFromQueue"
        @remove-from-playlist="handleRemoveFromPlaylist"
        @add-to-playlist="handleAddToPlaylist"
        @create-new-playlist="createNewPlaylist"
        @download="download"
        @delete="handleDeleteSong"
      />
    </Transition>
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

.menu-enter-active,
.menu-leave-active {
  transition: opacity 0.2s ease;
}
.menu-enter-from,
.menu-leave-to {
  opacity: 0;
}
</style>
