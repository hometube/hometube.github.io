import { createRouter, createWebHistory } from 'vue-router'
import UserPage from './pages/UserPage.vue'
import VideoHome from './pages/VideoHome.vue'
import AddVideo from './pages/AddVideo.vue'
import AddChannel from './pages/AddChannel.vue'
import MusicHome from './pages/MusicHome.vue'
import AddMusic from './pages/AddMusic.vue'
import PlaylistView from './pages/PlaylistView.vue'
import PodcastHome from './pages/PodcastHome.vue'
import AddPodcast from './pages/AddPodcast.vue'
import PodcastFeed from './pages/PodcastFeed.vue'
import AboutPage from './pages/AboutPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import DebugPage from './pages/DebugPage.vue'
import ExportPage from './pages/ExportPage.vue'
import ImportPage from './pages/ImportPage.vue'
import SetupBackend from './pages/SetupBackend.vue'
import SetupUser from './pages/SetupUser.vue'
import { isLocalMode } from './api.js'

const routes = [
  { path: '/', name: 'home', component: AboutPage },
  { path: '/setup', name: 'setup-backend', component: SetupBackend, meta: { isSetup: true } },
  { path: '/setup/user', name: 'setup-user', component: SetupUser, meta: { isSetup: true } },
  { path: '/user', name: 'user', component: UserPage, meta: { isSetup: true } },
  { path: '/video', name: 'video', component: VideoHome, meta: { requiresUser: true } },
  { path: '/video/add', name: 'video-add', component: AddVideo, meta: { requiresUser: true } },
  { path: '/video/channel', name: 'video-channel', component: AddChannel, meta: { requiresUser: true } },
  { path: '/music', name: 'music', component: MusicHome, meta: { requiresUser: true } },
  { path: '/music/add', name: 'music-add', component: AddMusic, meta: { requiresUser: true } },
  { path: '/music/playlist/:id', name: 'playlist', component: PlaylistView, props: true, meta: { requiresUser: true } },
  { path: '/podcast', name: 'podcast', component: PodcastHome, meta: { requiresUser: true } },
  { path: '/podcast/add', name: 'podcast-add', component: AddPodcast, meta: { requiresUser: true } },
  { path: '/podcast/feed/:id', name: 'podcast-feed', component: PodcastFeed, props: true, meta: { requiresUser: true } },
  { path: '/podcast/playlist/:id', name: 'podcast-playlist', component: PlaylistView, props: true, meta: { requiresUser: true } },
  { path: '/settings', name: 'settings', component: SettingsPage, meta: { requiresUser: true } },
  { path: '/debug', name: 'debug', component: DebugPage, meta: { requiresUser: true } },
  { path: '/export', name: 'export', component: ExportPage, meta: { requiresUser: true } },
  { path: '/import', name: 'import', component: ImportPage, meta: { requiresUser: true } }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const backendUrl = localStorage.getItem('backendUrl') || ''
  const lastVisited = localStorage.getItem('lastVisited') || '/video'
  const localMode = isLocalMode()

  const hasBackend = backendUrl.trim().length > 0 || localMode
  const hasUser = !!user && typeof user === 'object' && 'id' in user

  // Save current route as last visited (for non-setup, non-home routes)
  if (!to.meta.isSetup && to.name !== 'home') {
    localStorage.setItem('lastVisited', to.fullPath)
  }

  // Home route: if user exists, redirect to last visited
  if (to.name === 'home') {
    if (hasUser) {
      next(lastVisited)
      return
    }
    next()
    return
  }

  // Setup routes: if backend+user exist, redirect to home
  if (to.meta.isSetup) {
    if (hasBackend && hasUser) {
      next('/')
      return
    }
    next()
    return
  }

  // Routes requiring user: check backend and user
  if (to.meta.requiresUser) {
    if (!hasBackend) {
      next('/setup')
      return
    }
    if (!hasUser) {
      next('/setup/user')
      return
    }
    // Block add pages in local mode (no backend to download from URLs)
    if (localMode && (to.path === '/video/add' || to.path === '/video/channel' || to.path === '/music/add' || to.path === '/podcast/add')) {
      next('/import')
      return
    }
  }

  next()
})

export default router
