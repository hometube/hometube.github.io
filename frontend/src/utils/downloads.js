import { API } from '../api.js'

export async function waitForServerDownload({ type, itemId, timeoutMs = 10 * 60 * 1000 }) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const jobs = await API.get('/downloads', {})
    if (Array.isArray(jobs)) {
      const job = jobs.find(j => j && j.type === type && Number(j.item_id) === Number(itemId))
      if (job) {
        if (job.status === 'done') return job
        if (job.status === 'error') throw new Error(job.error || 'Download failed')
      }
    }
    await new Promise(r => setTimeout(r, 1200))
  }
  throw new Error('Download timed out')
}