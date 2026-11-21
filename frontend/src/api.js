const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...options,
  })

  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const err = new Error(body?.message || `Permintaan gagal (${res.status})`)
    err.status = res.status
    err.body = body
    throw err
  }

  return body
}

export async function createProject(youtubeUrl) {
  const res = await request('/projects', {
    method: 'POST',
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  })
  return res.data
}

export async function uploadProject({ videoFile, subtitleFile }) {
  const formData = new FormData()
  if (videoFile) formData.append('video', videoFile)
  if (subtitleFile) formData.append('subtitle', subtitleFile)

  const res = await fetch(BASE + '/projects/upload', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
  })

  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const err = new Error(body?.message || `Unggah gagal (${res.status})`)
    err.status = res.status
    err.body = body
    throw err
  }

  return body.data
}

export async function getProject(id) {
  const res = await request(`/projects/${id}`)
  return res.data
}

export async function getProjects() {
  const res = await request('/projects')
  return res.data
}

export async function deleteProject(id) {
  const res = await request(`/projects/${id}`, { method: 'DELETE' })
  return res
}

export function patchClipConfig(clipId, payload) {
  return request(`/clips/${clipId}/config`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function prepareClip(clipId) {
  return request(`/clips/${clipId}/prepare`, { method: 'POST' })
}

export function renderClip(clipId) {
  return request(`/clips/${clipId}/render`, { method: 'POST' })
}

export async function getRenderJob(id) {
  const res = await request(`/render-jobs/${id}`)
  return res.data
}
