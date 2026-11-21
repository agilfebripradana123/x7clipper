import { useEffect, useState } from 'react'
import { createProject, getProject } from './api'
import StatusTracker from './components/StatusTracker'
import ClipList from './components/ClipList'

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

function ErrorBox({ title, message }) {
  return (
    <div className="rounded-lg border border-fail/30 bg-fail/5 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fail">{title}</p>
      <p className="mt-1.5 text-sm text-ink/90">{message}</p>
    </div>
  )
}

export default function App() {
  const [url, setUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [fieldError, setFieldError] = useState(null)
  const [fatalError, setFatalError] = useState(null)
  const [project, setProject] = useState(null)

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
    } catch (err) {
      setFieldError(err?.body?.errors?.youtube_url?.[0] || err?.message || 'Gagal memulai analisis.')
    } finally {
      setCreating(false)
    }
  }

  const reset = () => {
    setProject(null)
    setUrl('')
    setFieldError(null)
    setFatalError(null)
    setCreating(false)
  }

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
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-accent/50 bg-accent/10 font-mono text-[11px] font-medium text-accent">
            X7
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-ink">Clipper</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">Lokal · Beta</span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
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
            Tempel tautan YouTube. Sistem mengambil transkrip, memilih momen terbaik, lalu menyiapkan klip untuk
            dirapikan.
          </p>
        </div>

        <div className="mt-9 max-w-3xl">
          {!project ? (
            <form onSubmit={handleSubmit} noValidate className="rise" style={{ animationDelay: '0.28s' }}>
              <div className="relative overflow-hidden rounded-2xl border border-line bg-panel/70 p-5 backdrop-blur-sm sm:p-7">
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent"
                  aria-hidden="true"
                />
                <label
                  htmlFor="youtube-url"
                  className="block font-mono text-[11px] uppercase tracking-[0.16em] text-muted"
                >
                  Tautan video YouTube
                </label>

                <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
                  <div className="relative flex-1">
                    <span
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
                      aria-hidden="true"
                    >
                      <LinkIcon />
                    </span>
                    <input
                      id="youtube-url"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck="false"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value)
                        if (fieldError) setFieldError(null)
                      }}
                      placeholder="https://youtu.be/…"
                      aria-invalid={fieldError ? 'true' : undefined}
                      aria-describedby={fieldError ? 'url-error' : 'url-hint'}
                      className={`h-12 w-full rounded-lg border bg-void/60 pl-10 pr-3 text-[15px] text-ink outline-none transition placeholder:text-faint focus:border-accent ${
                        fieldError ? 'border-fail' : 'border-line'
                      }`}
                    />
                  </div>
                  <button type="submit" disabled={creating} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
                    {creating ? (
                      <>
                        <span
                          className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-void/40 border-t-void motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                        Memulai…
                      </>
                    ) : (
                      'Mulai analisis'
                    )}
                  </button>
                </div>

                {fieldError ? (
                  <p id="url-error" role="alert" className="mt-2.5 text-sm text-fail">
                    {fieldError}
                  </p>
                ) : (
                  <p id="url-hint" className="mt-2.5 text-xs text-faint">
                    Tempel tautan lalu tekan Enter.
                  </p>
                )}
              </div>
            </form>
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
                      <a
                        href={project.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-full truncate font-mono text-faint underline-offset-2 hover:text-muted hover:underline"
                      >
                        {project.youtube_url}
                      </a>
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
          <ClipList project={project} onRefresh={refresh} onReset={reset} />
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">X7 Clipper · Pemrosesan lokal</p>
      </footer>
    </div>
  )
}
