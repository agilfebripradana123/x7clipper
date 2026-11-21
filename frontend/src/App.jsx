import { useEffect, useRef, useState } from 'react'
import { createProject, getProject, uploadProject, getProjects, deleteProject } from './api'
import StatusTracker from './components/StatusTracker'
import ClipList from './components/ClipList'
import Editor from './components/Editor'

const BTN =
  'inline-flex h-11 items-center justify-center rounded-lg px-5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const BTN_PRIMARY = `${BTN} bg-accent text-void hover:bg-accent-2`
const BTN_GHOST = `${BTN} border border-line text-ink hover:border-line-2 hover:bg-panel-2`

const STATUS_LABEL = {
  queued: 'Menunggu antrean',
  extracting: 'Mengambil transkrip',
  analyzing: 'Menganalisis momen',
  ready: 'Selesai',
  failed: 'Gagal',
}

const ACTIVE = ['queued', 'extracting', 'analyzing']

function shouldKeepPolling(project) {
  if (!project || project.status === 'failed') return false
  if (project.status === 'ready') {
    return (project.clips || []).some((c) => c.prepare_status === 'preparing')
  }
  return true
}

function formatDuration(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return null
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function parseUrlRoute() {
  const path = window.location.pathname
  const matchClip = path.match(/^\/projects\/(\d+)\/clips\/(\d+)$/)
  if (matchClip) {
    return { projectId: Number(matchClip[1]), clipId: Number(matchClip[2]) }
  }
  const matchProject = path.match(/^\/projects\/(\d+)$/)
  if (matchProject) {
    return { projectId: Number(matchProject[1]), clipId: null }
  }
  return { projectId: null, clipId: null }
}

function setUrlRoute(projectId, clipId) {
  let target = '/'
  if (projectId != null && clipId != null) {
    target = `/projects/${projectId}/clips/${clipId}`
  } else if (projectId != null) {
    target = `/projects/${projectId}`
  }
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target)
  }
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M8.5 11.5l3-3M7 13l-1 1a2.5 2.5 0 01-3.5-3.5l2-2A2.5 2.5 0 018 8M13 7l1-1a2.5 2.5 0 013.5 3.5l-2 2A2.5 2.5 0 0112 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M3 13.5v2a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5v-2M10 3.5v9M6.5 7L10 3.5 13.5 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function VideoFileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.5h7a1 1 0 011 1v7a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1zM10.5 6.5l3-2v7l-3-2v-3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SubtitleFileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.5h11a1 1 0 011 1v8a1 1 0 01-1 1h-11a1 1 0 01-1-1v-8a1 1 0 011-1zM4.5 9.5h7M4.5 6.5h4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ErrorBox({ title, message }) {
  return (
    <div className="rounded-lg border border-fail/30 bg-fail/5 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fail">{title}</p>
      <p className="mt-1.5 text-sm text-ink/90">{message}</p>
    </div>
  )
}

export default function App() {
  const [sourceMode, setSourceMode] = useState('youtube') // 'youtube' | 'upload'
  const [url, setUrl] = useState('')
  const [videoFile, setVideoFile] = useState(null)
  const [subtitleFile, setSubtitleFile] = useState(null)
  const [creating, setCreating] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const [uploadErrors, setUploadErrors] = useState({})
  const [fatalError, setFatalError] = useState(null)
  const [project, setProject] = useState(null)
  const [editingClipId, setEditingClipId] = useState(null)
  const [historyList, setHistoryList] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const videoInputRef = useRef(null)
  const subtitleInputRef = useRef(null)

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const data = await getProjects()
      setHistoryList(data || [])
    } catch {
      /* ignore */
    } finally {
      setHistoryLoading(false)
    }
  }

  // Initial load: parse route and history
  useEffect(() => {
    loadHistory()

    const route = parseUrlRoute()
    if (route.projectId) {
      getProject(route.projectId)
        .then((data) => {
          setProject(data)
          if (route.clipId) setEditingClipId(route.clipId)
        })
        .catch(() => {
          setUrlRoute(null, null)
        })
    }

    const onPopState = () => {
      const current = parseUrlRoute()
      if (current.projectId) {
        getProject(current.projectId)
          .then((data) => {
            setProject(data)
            setEditingClipId(current.clipId)
          })
          .catch(() => {
            setProject(null)
            setEditingClipId(null)
          })
      } else {
        setProject(null)
        setEditingClipId(null)
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Sync URL when state changes
  useEffect(() => {
    if (project) {
      setUrlRoute(project.id, editingClipId)
    } else {
      setUrlRoute(null, null)
    }
  }, [project?.id, editingClipId])

  const anyPreparing = project?.clips?.some((c) => c.prepare_status === 'preparing') ?? false

  useEffect(() => {
    if (!project) return
    if (!shouldKeepPolling(project)) return

    let cancelled = false
    let timer
    const id = project.id

    const tick = async () => {
      try {
        const data = await getProject(id)
        if (cancelled) return
        setProject(data)
        if (shouldKeepPolling(data)) {
          timer = setTimeout(tick, 2000)
        } else {
          loadHistory()
        }
      } catch (err) {
        if (!cancelled) setFatalError(err?.message || 'Gagal memuat status.')
      }
    }

    timer = setTimeout(tick, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [project?.id, project?.status, anyPreparing])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (creating) return

    const value = url.trim()
    if (!value) {
      setFieldError('Tempel tautan YouTube dulu.')
      return
    }

    setFieldError(null)
    setFatalError(null)
    setCreating(true)
    try {
      const data = await createProject(value)
      setProject(data)
      loadHistory()
    } catch (err) {
      setFieldError(err?.body?.errors?.youtube_url?.[0] || err?.message || 'Gagal memulai analisis.')
    } finally {
      setCreating(false)
    }
  }

  const handleUploadSubmit = async (e) => {
    e.preventDefault()
    if (creating) return

    const errs = {}
    if (!videoFile) errs.video = 'Pilih berkas video (MP4, MOV, atau M4V).'
    if (!subtitleFile) errs.subtitle = 'Pilih berkas subtitle (VTT atau SRT).'

    if (Object.keys(errs).length > 0) {
      setUploadErrors(errs)
      return
    }

    setUploadErrors({})
    setFatalError(null)
    setCreating(true)
    try {
      const data = await uploadProject({ videoFile, subtitleFile })
      setProject(data)
      loadHistory()
    } catch (err) {
      const serverErrs = err?.body?.errors || {}
      if (Object.keys(serverErrs).length > 0) {
        setUploadErrors({
          video: serverErrs.video?.[0],
          subtitle: serverErrs.subtitle?.[0],
          general: err?.body?.message,
        })
      } else {
        setUploadErrors({ general: err?.body?.message || err?.message || 'Gagal mengunggah berkas.' })
      }
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteHistory = async (e, id) => {
    e.stopPropagation()
    if (!confirm('Yakin ingin menghapus riwayat proyek ini?')) return
    try {
      await deleteProject(id)
      if (project?.id === id) {
        reset()
      }
      loadHistory()
    } catch {
      alert('Gagal menghapus proyek.')
    }
  }

  const reset = () => {
    setProject(null)
    setUrl('')
    setVideoFile(null)
    setSubtitleFile(null)
    if (videoInputRef.current) videoInputRef.current.value = ''
    if (subtitleInputRef.current) subtitleInputRef.current.value = ''
    setFieldError(null)
    setUploadErrors({})
    setFatalError(null)
    setCreating(false)
    setEditingClipId(null)
    setUrlRoute(null, null)
  }

  const editingClip =
    editingClipId != null ? project?.clips?.find((c) => c.id === editingClipId) ?? null : null

  const refresh = async () => {
    if (!project) return
    try {
      const data = await getProject(project.id)
      setProject(data)
    } catch (err) {
      setFatalError(err?.message || 'Gagal memuat status.')
    }
  }

  const status = project?.status
  const isActive = ACTIVE.includes(status)
  const duration = formatDuration(project?.duration_sec)
  const clipCount = project?.clips?.length ?? 0
  const heading =
    project?.video_title ||
    (status === 'queued'
      ? 'Menunggu antrean'
      : status === 'failed'
        ? 'Pemrosesan gagal'
        : status === 'ready'
          ? 'Video selesai diproses'
          : 'Memproses video…')

  const dotClass = isActive ? 'bg-accent' : status === 'ready' ? 'bg-ok' : 'bg-fail'
  const readoutClass = isActive ? 'text-muted' : status === 'ready' ? 'text-ok' : 'text-fail'

  return (
    <div className="relative flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-2.5 text-left focus:outline-none"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/50 bg-accent/10 font-mono text-[11px] font-medium text-accent">
            X7
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">Clipper</span>
        </button>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Lokal · Beta</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        {editingClip ? (
          <Editor key={editingClip.id} clip={editingClip} onBack={() => setEditingClipId(null)} />
        ) : (
          <>
        <div className="max-w-2xl">
          <p
            className="rise font-mono text-[11px] uppercase tracking-[0.18em] text-accent/90"
            style={{ animationDelay: '0.05s' }}
          >
            Sumber video
          </p>
          <h1
            className="rise mt-4 font-display text-[clamp(2rem,6vw,3.4rem)] font-semibold leading-[1.04] tracking-[-0.02em] text-ink"
            style={{ animationDelay: '0.12s' }}
          >
            Ubah video panjang jadi <span className="text-accent">klip pendek</span>.
          </h1>
          <p
            className="rise mt-5 max-w-xl text-[15px] leading-relaxed text-muted sm:text-base"
            style={{ animationDelay: '0.2s' }}
          >
            Tempel tautan YouTube atau unggah berkas video + subtitle lokal. Sistem memilih momen terbaik dan menyiapkan klip untuk dirapikan.
          </p>
        </div>

        <div className="mt-9 max-w-3xl">
          {!project ? (
            <div className="rise" style={{ animationDelay: '0.28s' }}>
              {/* Tab Selector */}
              <div role="tablist" aria-label="Sumber masukan video" className="mb-3 flex items-center gap-1">
                <button
                  type="button"
                  role="tab"
                  id="tab-youtube"
                  aria-selected={sourceMode === 'youtube'}
                  aria-controls="panel-youtube"
                  onClick={() => {
                    setSourceMode('youtube')
                    setFieldError(null)
                    setUploadErrors({})
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-mono text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    sourceMode === 'youtube'
                      ? 'border border-accent/40 bg-accent/10 font-medium text-accent'
                      : 'border border-transparent text-muted hover:border-line hover:bg-panel-2 hover:text-ink'
                  }`}
                >
                  <LinkIcon />
                  Tautan YouTube
                </button>
                <button
                  type="button"
                  role="tab"
                  id="tab-upload"
                  aria-selected={sourceMode === 'upload'}
                  aria-controls="panel-upload"
                  onClick={() => {
                    setSourceMode('upload')
                    setFieldError(null)
                    setUploadErrors({})
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 font-mono text-xs transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    sourceMode === 'upload'
                      ? 'border border-accent/40 bg-accent/10 font-medium text-accent'
                      : 'border border-transparent text-muted hover:border-line hover:bg-panel-2 hover:text-ink'
                  }`}
                >
                  <UploadIcon />
                  Unggah Video Lokal
                </button>
              </div>

              {sourceMode === 'youtube' ? (
                <form
                  id="panel-youtube"
                  role="tabpanel"
                  aria-labelledby="tab-youtube"
                  onSubmit={handleSubmit}
                  noValidate
                >
                  <div className="relative rounded-2xl border border-line bg-panel/70 p-2 shadow-2xl backdrop-blur-sm sm:p-2.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <div className="relative flex-1">
                        <label htmlFor="yt-url" className="sr-only">
                          Tautan video YouTube
                        </label>
                        <input
                          id="yt-url"
                          type="url"
                          value={url}
                          onChange={(e) => {
                            setUrl(e.target.value)
                            if (fieldError) setFieldError(null)
                          }}
                          placeholder="https://www.youtube.com/watch?v=..."
                          autoComplete="off"
                          spellCheck="false"
                          disabled={creating}
                          className="h-11 w-full rounded-lg bg-void/60 px-4 font-mono text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <button type="submit" disabled={creating} className={BTN_PRIMARY}>
                        {creating ? (
                          <>
                            <span
                              className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-void/40 border-t-void motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Memproses…
                          </>
                        ) : (
                          'Analisis video'
                        )}
                      </button>
                    </div>
                  </div>
                  {fieldError && (
                    <p role="alert" className="mt-2.5 px-2 font-mono text-xs text-fail">
                      {fieldError}
                    </p>
                  )}
                </form>
              ) : (
                <form
                  id="panel-upload"
                  role="tabpanel"
                  aria-labelledby="tab-upload"
                  onSubmit={handleUploadSubmit}
                  noValidate
                >
                  <div className="rounded-2xl border border-line bg-panel/70 p-4 shadow-2xl backdrop-blur-sm sm:p-5">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                          1. Berkas Video (MP4 / MOV / M4V)
                        </span>
                        <input
                          ref={videoInputRef}
                          id="local-video-input"
                          type="file"
                          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v"
                          onChange={(e) => {
                            setVideoFile(e.target.files?.[0] || null)
                            if (uploadErrors.video) setUploadErrors((p) => ({ ...p, video: null }))
                          }}
                          disabled={creating}
                          className="sr-only"
                        />
                        <div
                          onClick={() => videoInputRef.current?.click()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              videoInputRef.current?.click()
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className={`flex min-h-[96px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-3 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                            videoFile
                              ? 'border-accent/60 bg-accent/5'
                              : 'border-line hover:border-line-2 hover:bg-panel-2'
                          }`}
                        >
                          <VideoFileIcon />
                          <span className="mt-2 line-clamp-1 max-w-[200px] text-xs font-medium text-ink">
                            {videoFile ? videoFile.name : 'Pilih berkas video'}
                          </span>
                          <span className="mt-0.5 text-[10px] text-faint">
                            {videoFile ? `${(videoFile.size / (1024 * 1024)).toFixed(1)} MB` : 'Maks. 500 MB'}
                          </span>
                        </div>
                        {uploadErrors.video && (
                          <p role="alert" className="mt-2 text-xs text-fail">
                            {uploadErrors.video}
                          </p>
                        )}
                      </div>

                      <div>
                        <span className="mb-2 block font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                          2. Berkas Subtitle (VTT / SRT)
                        </span>
                        <input
                          ref={subtitleInputRef}
                          id="local-subtitle-input"
                          type="file"
                          accept=".vtt,.srt,text/vtt,application/x-subrip"
                          onChange={(e) => {
                            setSubtitleFile(e.target.files?.[0] || null)
                            if (uploadErrors.subtitle) setUploadErrors((p) => ({ ...p, subtitle: null }))
                          }}
                          disabled={creating}
                          className="sr-only"
                        />
                        <div
                          onClick={() => subtitleInputRef.current?.click()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              subtitleInputRef.current?.click()
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className={`flex min-h-[96px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-3 py-3 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                            subtitleFile
                              ? 'border-accent/60 bg-accent/5'
                              : 'border-line hover:border-line-2 hover:bg-panel-2'
                          }`}
                        >
                          <SubtitleFileIcon />
                          <span className="mt-2 line-clamp-1 max-w-[200px] text-xs font-medium text-ink">
                            {subtitleFile ? subtitleFile.name : 'Pilih berkas subtitle'}
                          </span>
                          <span className="mt-0.5 text-[10px] text-faint">
                            {subtitleFile ? `${(subtitleFile.size / 1024).toFixed(1)} KB` : 'VTT atau SRT'}
                          </span>
                        </div>
                        {uploadErrors.subtitle && (
                          <p role="alert" className="mt-2 text-xs text-fail">
                            {uploadErrors.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    {uploadErrors.general && (
                      <p role="alert" className="mt-4 text-xs text-fail">
                        {uploadErrors.general}
                      </p>
                    )}

                    <div className="mt-5 flex flex-col items-center justify-between gap-3 border-t border-line pt-4 sm:flex-row">
                      <p className="text-xs text-faint">
                        Fallback saat IP server terblokir oleh YouTube.
                      </p>
                      <button type="submit" disabled={creating} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                        {creating ? (
                          <>
                            <span
                              className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-void/40 border-t-void motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            Mengunggah…
                          </>
                        ) : (
                          'Mulai analisis berkas'
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Riwayat Proyek Section */}
              <div className="mt-8 border-t border-line/60 pt-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                    Riwayat Proyek Terakhir
                  </h3>
                  <button
                    type="button"
                    onClick={loadHistory}
                    disabled={historyLoading}
                    className="font-mono text-[10px] text-muted hover:text-ink"
                  >
                    {historyLoading ? 'Memuat…' : 'Segarkan'}
                  </button>
                </div>

                {historyList.length === 0 ? (
                  <p className="mt-3 text-xs text-faint">Belum ada proyek yang pernah diproses.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {historyList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          getProject(item.id).then(setProject).catch(() => alert('Gagal memuat proyek.'))
                        }}
                        className="group flex cursor-pointer items-center justify-between rounded-xl border border-line bg-panel/40 p-3 transition hover:border-accent/40 hover:bg-panel-2"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="truncate text-xs font-medium text-ink group-hover:text-accent">
                            {item.video_title || item.youtube_url || `Proyek #${item.id}`}
                          </p>
                          <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-faint">
                            <span>{new Date(item.created_at).toLocaleDateString()}</span>
                            <span>·</span>
                            <span>{item.clips_count} klip</span>
                            <span>·</span>
                            <span className={item.status === 'ready' ? 'text-ok' : item.status === 'failed' ? 'text-fail' : 'text-accent'}>
                              {STATUS_LABEL[item.status] || item.status}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => handleDeleteHistory(e, item.id)}
                            className="rounded p-1 text-faint hover:text-fail"
                            title="Hapus proyek"
                          >
                            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor">
                              <path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M12 4.5v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <section aria-busy={isActive} className="rise">
              <div className="relative overflow-hidden rounded-2xl border border-line bg-panel/70 p-5 backdrop-blur-sm sm:p-7">
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
                  aria-hidden="true"
                />

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Proyek</p>
                    <h2
                      className="mt-1.5 truncate font-display text-lg font-semibold text-ink sm:text-xl"
                      title={heading}
                    >
                      {heading}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {duration && <span className="font-mono">{duration}</span>}
                      {project.source_type === 'upload' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-faint">
                          <span className="h-1.5 w-1.5 rounded-full bg-accent/60" aria-hidden="true" />
                          Berkas lokal
                        </span>
                      ) : (
                        <a
                          href={project.youtube_url}
                          target="_blank"
                          rel="noreferrer"
                          className="max-w-full truncate font-mono text-faint underline-offset-2 hover:text-muted hover:underline"
                        >
                          {project.youtube_url}
                        </a>
                      )}
                    </div>
                  </div>

                  <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="flex shrink-0 items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em]"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${dotClass} ${
                        isActive ? 'animate-pulse motion-reduce:animate-none' : ''
                      }`}
                      aria-hidden="true"
                    />
                    <span className={readoutClass}>{STATUS_LABEL[status] || status}</span>
                  </div>
                </div>

                <div className="mt-8">
                  <StatusTracker status={status} />
                </div>

                {fatalError ? (
                  <div className="mt-7 border-t border-line pt-6">
                    <ErrorBox title="Koneksi bermasalah" message={fatalError} />
                    <div className="mt-4">
                      <button type="button" onClick={reset} className={BTN_GHOST}>
                        Mulai ulang
                      </button>
                    </div>
                  </div>
                ) : status === 'ready' ? (
                  <div className="mt-7 flex flex-col gap-5 border-t border-line pt-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <p className="font-display text-2xl font-semibold text-ink">
                        <span className="text-accent">{clipCount}</span> klip siap
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        Tinjau rekomendasi di bawah, lalu siapkan klip untuk diedit.
                      </p>
                    </div>
                    <button type="button" onClick={reset} className={BTN_GHOST}>
                      Analisis video lain
                    </button>
                  </div>
                ) : status === 'failed' ? (
                  <div className="mt-7 border-t border-line pt-6">
                    <ErrorBox
                      title="Pemrosesan gagal"
                      message={project.error_message || 'Terjadi kesalahan saat memproses video.'}
                    />
                    <div className="mt-4">
                      <button type="button" onClick={reset} className={BTN_GHOST}>
                        Coba video lain
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-6">
                    <p className="text-sm text-muted">Halaman ini memperbarui otomatis.</p>
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                      Polling 2 dtk
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {project?.status === 'ready' && (
          <ClipList
            project={project}
            onRefresh={refresh}
            onReset={reset}
            onOpenEditor={(clip) => setEditingClipId(clip.id)}
          />
        )}
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">X7 Clipper · Pemrosesan lokal</p>
      </footer>
    </div>
  )
}
