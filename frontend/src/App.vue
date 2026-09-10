<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { useUserStore } from './stores/user.js'
import { useMusicStore } from './stores/music.js'
import GlobalMusicPlayer from './components/GlobalMusicPlayer.vue'
import BackendMenu from './components/BackendMenu.vue'
import { isLocalMode } from './api.js'
import './icons.js'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const musicStore = useMusicStore()

const {
  currentIndex,
  playing,
  togglePlay,
  init,
  restoreState
} = musicStore

const navOpen = ref(false)
const installPrompt = ref(null)
const showInstall = ref(false)
const backendMenu = ref(null)

const mode = computed(() => {
  if (route.path.startsWith('/video')) return 'video'
  if (route.path.startsWith('/music')) return 'music'
  if (route.path.startsWith('/podcast')) return 'podcast'
  if (route.path === '/export' || route.path === '/import') return 'data'
  if (route.path === '/settings' || route.path === '/debug') return 'settings'
  return 'setup'
})
const modeLabel = computed(() => {
  if (mode.value === 'video') return 'Video'
  if (mode.value === 'music') return 'Music'
  if (mode.value === 'podcast') return 'Podcast'
  if (mode.value === 'data') return 'Data'
  if (mode.value === 'settings') return 'Settings'
  return 'Setup'
})
const hideNavbar = computed(() => mode.value === 'setup')

const navigate = (tab, subPage = null) => {
  navOpen.value = false
  if (tab === 'video') {
    router.push(subPage === 'add' ? '/video/add' : subPage === 'channel' ? '/video/channel' : '/video')
  } else if (tab === 'music') {
    router.push(subPage === 'add' ? '/music/add' : '/music')
  } else if (tab === 'podcast') {
    router.push(subPage === 'add' ? '/podcast/add' : '/podcast')
  } else if (tab === 'settings') {
    router.push('/settings')
  } else if (tab === 'export') {
    router.push('/export')
  } else if (tab === 'import') {
    router.push('/import')
  }
}

const installApp = async () => {
  if (!installPrompt.value) return
  installPrompt.value.prompt()
  const { outcome } = await installPrompt.value.userChoice
  if (outcome === 'accepted') installPrompt.value = null
  showInstall.value = false
}

const handleBeforeInstallPrompt = (e) => {
  e.preventDefault()
  installPrompt.value = e
  showInstall.value = true
}

// Pause music when navigating to video pages
watch(() => route.path, (newPath, oldPath) => {
  if (newPath.startsWith('/video') && playing.value && !oldPath.startsWith('/video')) {
    togglePlay()
  }
})

onMounted(async () => {
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  if (window.matchMedia('(display-mode: standalone)').matches) showInstall.value = false
  init()
  await restoreState()
  if (userStore.hasUser) {
    userStore.startPinging()
  }
})

watch(() => userStore.hasUser, (hasUser) => {
  if (hasUser) {
    userStore.startPinging()
  } else {
    userStore.stopPinging()
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
})
</script>

<template>
  <div class="min-h-screen bg-black text-white" :class="{ 'pt-[60px]': hideNavbar }">
    <!-- Top bar with nav toggle -->
    <div v-if="!hideNavbar" class="fixed top-0 left-0 right-0 bg-gray-900 border-b border-gray-700 z-[100] flex items-center p-3">
      <button @click="navOpen = !navOpen" class="text-white mr-3">
        <FontAwesomeIcon :icon="['fas', 'bars']" />
      </button>
      <span class="text-lg font-bold">{{ modeLabel }}</span>
      <button class="ml-auto flex items-center text-xs" @click="backendMenu.open">
        <FontAwesomeIcon v-if="userStore.checked" :icon="['fas', 'circle']" :class="userStore.online ? 'text-green-500' : 'text-red-500'" class="mr-1" />
        <span v-else class="text-gray-500">Checking...</span>
      </button>
    </div>

    <!-- Left nav menu -->
    <Transition name="nav">
      <div v-if="!hideNavbar && navOpen" class="fixed inset-0 z-[100]" @click="navOpen = false">
        <div class="absolute inset-0 bg-black/50"></div>
        <div class="nav-panel absolute top-0 left-0 bottom-0 w-64 bg-gray-900 p-4 overflow-y-auto" @click.stop>
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold">Menu</h2>
            <button @click="navOpen = false" class="text-gray-400">
              <FontAwesomeIcon :icon="['fas', 'times']" />
            </button>
          </div>

          <div class="mb-4">
            <div class="text-xs text-gray-500 uppercase mb-2">Video</div>
            <button @click="navigate('video', 'home')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'home']" class="mr-2" /> Video Home
            </button>
            <button v-if="!isLocalMode()" @click="navigate('video', 'add')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'plus']" class="mr-2" /> Add Video
            </button>
            <button v-if="!isLocalMode()" @click="navigate('video', 'channel')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'tv']" class="mr-2" /> Add Channel
            </button>
          </div>

          <div class="mb-4">
            <div class="text-xs text-gray-500 uppercase mb-2">Music</div>
            <button @click="navigate('music', 'home')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'home']" class="mr-2" /> Music Home
            </button>
            <button v-if="!isLocalMode()" @click="navigate('music', 'add')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'plus']" class="mr-2" /> Add Music
            </button>
          </div>

          <div class="mb-4">
            <div class="text-xs text-gray-500 uppercase mb-2">Podcast</div>
            <button @click="navigate('podcast', 'home')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'rss']" class="mr-2" /> Podcast Home
            </button>
            <button v-if="!isLocalMode()" @click="navigate('podcast', 'add')"
              class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'plus']" class="mr-2" /> Add Podcast
            </button>
          </div>

          <div class="mb-4">
            <div class="text-xs text-gray-500 uppercase mb-2">App</div>
            <button v-if="showInstall" @click="installApp" class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'save']" class="mr-2" /> Install App
            </button>
            <button @click="navigate('settings')" class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'cog']" class="mr-2" /> Settings
            </button>
            <button @click="navigate('export')" class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'download']" class="mr-2" /> Export Data
            </button>
            <button @click="navigate('import')" class="block w-full text-left p-2 rounded hover:bg-gray-800 text-white">
              <FontAwesomeIcon :icon="['fas', 'upload']" class="mr-2" /> Import Data
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <router-view />

    <!-- Global Music Player (hidden on settings/debug) -->
    <GlobalMusicPlayer v-if="mode !== 'settings'" />

    <!-- Backend Configuration -->
    <BackendMenu ref="backendMenu" />

    <!-- Global Popover Portal -->
    <div id="popover-portal" class="fixed z-[1000]"></div>
  </div>
</template>

<style scoped>
.nav-enter-active,
.nav-leave-active {
  transition: opacity 0.2s ease;
}
.nav-enter-from,
.nav-leave-to {
  opacity: 0;
}

.nav-enter-active .nav-panel,
.nav-leave-active .nav-panel {
  transition: transform 0.2s ease;
}
.nav-enter-from .nav-panel,
.nav-leave-to .nav-panel {
  transform: translateX(-100%);
}
</style>
