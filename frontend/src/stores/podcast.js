import { defineStore } from 'pinia'
import { ref } from 'vue'
import { API } from '../api.js'
import { useUserStore } from './user.js'

export const usePodcastStore = defineStore('podcast', () => {
  const feeds = ref([])
  const playlists = ref([])
  const loading = ref(false)
  const feedEpisodes = ref(null)

  const load = async () => {
    const userStore = useUserStore()
    if (!userStore.user) return
    loading.value = true
    try {
      const [fds, pls] = await Promise.all([
        API.get('/podcasts', { user_id: userStore.user.id }),
        API.get('/playlists', { user_id: userStore.user.id, kind: 'podcast' })
      ])
      feeds.value = fds || []
      playlists.value = pls || []
    } catch (e) {
      console.error('Failed to load podcast data:', e)
    } finally {
      loading.value = false
    }
  }

  const loadFeed = async (subId) => {
    const userStore = useUserStore()
    const data = await API.get(`/podcasts/${subId}/episodes`, { user_id: userStore.user.id })
    feedEpisodes.value = data
    return data
  }

  const subscribe = async (url, criteria = {}, checkInterval = null) => {
    const userStore = useUserStore()
    return API.post('/podcasts/subscribe', {
      url,
      user_id: userStore.user.id,
      criteria,
      check_interval: checkInterval
    })
  }

  const checkNow = async (subId) => {
    const res = await API.post(`/podcasts/${subId}/check`)
    await load()
    return res
  }

  const unsubscribe = async (subId) => {
    await API.delete(`/podcasts/${subId}`)
    await load()
  }

  const addEpisode = async (url, playlistId = null) => {
    const userStore = useUserStore()
    return API.post('/music/add', {
      url,
      user_id: userStore.user.id,
      playlist_id: playlistId,
      kind: 'podcast'
    })
  }

  const createPlaylist = async (name) => {
    const userStore = useUserStore()
    const pl = await API.post('/playlists', { name, user_id: userStore.user.id, kind: 'podcast' })
    await load()
    return pl
  }

  return {
    feeds,
    playlists,
    loading,
    feedEpisodes,
    load,
    loadFeed,
    subscribe,
    checkNow,
    unsubscribe,
    addEpisode,
    createPlaylist
  }
})