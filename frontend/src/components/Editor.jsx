import { useEffect, useMemo, useRef, useState } from 'react'
import { patchClipConfig } from '../api'

const HOOK = {
  contrarian: 'Kontrarian',
  story: 'Cerita',
  actionable_tip: 'Tips praktis',
  emotional: 'Emosional',
  debate: 'Debat',
}

const MIN_GAP = 1

const round1 = (n) => Math.round(n * 10) / 10
const round3 = (n) => Math.round(n * 1000) / 1000
const clamp = (n, min, max) => Math.min(Math.max(n, min), max)

function formatTime(t) {
  const tenths = Math.round(Math.max(0, t) * 10)
  const m = Math.floor(tenths / 600)
  const rest = tenths - m * 600
  const s = Math.floor(rest / 10)
  const d = rest % 10
  return `${m}:${String(s).padStart(2, '0')}.${d}`
}

const BTN =
  'inline-flex h-10 items-center justify-center rounded-lg px-4 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50'
const BTN_PRIMARY = `${BTN} bg-accent text-void hover:bg-accent-2`
const BTN_GHOST = `${BTN} border border-line text-ink hover:border-line-2 hover:bg-panel-2`

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5-9-5.5z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <rect x="4" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  )
}

function Handle({ label, value, min, max, onChange, pct, timeFromClientX }) {
  const dragging = useRef(false)

  const update = (clientX) => {
    onChange(clamp(round1(timeFromClientX(clientX)), min, max))
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={round1(min)}
      aria-valuemax={round1(max)}
      aria-valuenow={round1(value)}
      aria-valuetext={formatTime(value)}
      aria-orientation="horizontal"
      style={{ left: `${pct(value)}%` }}
      className="absolute top-1/2 z-10 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 touch-none cursor-ew-resize place-items-center rounded-full border-2 border-accent bg-panel shadow-[0_0_0_3px_rgba(10,11,13,0.7)] transition-colors hover:bg-panel-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragging.current = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
        update(e.clientX)
      }}
      onPointerMove={(e) => {
        if (dragging.current) update(e.clientX)
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      }}
      onPointerCancel={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 1 : 0.1
        if (e.key === 'Home') {
          e.preventDefault()
          onChange(min)
          return
        }
        if (e.key === 'End') {
          e.preventDefault()
          onChange(max)
          return
        }
        let delta = 0
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step
        else return
        e.preventDefault()
        onChange(clamp(round1(value + delta), min, max))
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
    </div>
  )
}

function Timeline({ duration, start, end, currentTime, onChangeStart, onChangeEnd, onSeek }) {
  const railRef = useRef(null)
  const pct = (v) => (duration > 0 ? clamp((v / duration) * 100, 0, 100) : 0)

  const timeFromClientX = (clientX) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration)
  }

  return (
    <div
      ref={railRef}
      className="relative h-11 touch-none select-none"
      onPointerDown={(e) => onSeek(clamp(timeFromClientX(e.clientX), start, end))}
    >
      <div
        className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-line bg-void/70"
        aria-hidden="true"
      />
      <div
        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full border border-accent/50 bg-accent/25"
        style={{ left: `${pct(start)}%`, width: `${Math.max(0, pct(end) - pct(start))}%` }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute top-1/2 h-4 w-px -translate-y-1/2 bg-ink/80"
        style={{ left: `${pct(currentTime)}%` }}
        aria-hidden="true"
      />
      <Handle
        label="Awal potongan"
        value={start}
        min={0}
        max={Math.max(0, end - MIN_GAP)}
        onChange={onChangeStart}
        pct={pct}
        timeFromClientX={timeFromClientX}
      />
      <Handle
        label="Akhir potongan"
        value={end}
        min={Math.min(duration, start + MIN_GAP)}
        max={duration}
        onChange={onChangeEnd}
        pct={pct}
        timeFromClientX={timeFromClientX}
      />
    </div>
  )
}

function TimeField({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-void/50 px-3 py-2">
      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</span>
      <span className="mt-1 block font-mono text-sm text-ink">{formatTime(value)}</span>
    </div>
  )
}

export default function Editor({ clip, onBack }) {
  const duration = useMemo(() => {
    const d = round3((clip.end_sec ?? 0) - (clip.start_sec ?? 0))
    return d > 0 ? d : 1
  }, [clip.end_sec, clip.start_sec])

  const [trim, setTrim] = useState(() => {
    const cfg = clip.edit_config_json || {}
    const rawStart = typeof cfg.trim_start === 'number' ? cfg.trim_start : 0
    const rawEnd = typeof cfg.trim_end === 'number' ? cfg.trim_end : duration
    const start = clamp(round1(rawStart), 0, Math.max(0, duration - MIN_GAP))
    const end = clamp(round1(rawEnd), Math.min(duration, start + MIN_GAP), duration)
    return { start, end }
  })

  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState(null)

  const videoRef = useRef(null)

  const seekTo = (t) => {
    const v = videoRef.current
    if (!v) return
    const clamped = clamp(t, trim.start, trim.end)
    try {
      v.currentTime = clamped
    } catch {
      /* ignore seek errors before metadata */
    }
    setCurrentTime(clamped)
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)
    if (t >= trim.end) {
      try {
        v.currentTime = trim.start
      } catch {
        /* ignore */
      }
      setCurrentTime(trim.start)
    }
  }

  const togglePlay = async () => {
    const v = videoRef.current
    if (!v || videoError) return
    if (!v.paused) {
      v.pause()
      return
    }
    if (v.currentTime < trim.start || v.currentTime >= trim.end) {
      try {
        v.currentTime = trim.start
      } catch {
        /* ignore */
      }
      setCurrentTime(trim.start)
    }
    try {
      await v.play()
    } catch {
      /* autoplay rejection */
    }
  }

  const changeStart = (v) => {
    setTrim((prev) => ({ ...prev, start: clamp(v, 0, prev.end - MIN_GAP) }))
    setSaveState('idle')
    setSaveError(null)
  }

  const changeEnd = (v) => {
    setTrim((prev) => ({ ...prev, end: clamp(v, prev.start + MIN_GAP, duration) }))
    setSaveState('idle')
    setSaveError(null)
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (v.currentTime < trim.start) {
      v.currentTime = trim.start
      setCurrentTime(trim.start)
    } else if (v.currentTime > trim.end) {
      v.currentTime = trim.end
      setCurrentTime(trim.end)
    }
  }, [trim.start, trim.end])

  const resetRange = () => {
    setTrim({ start: 0, end: duration })
    setSaveState('idle')
    setSaveError(null)
    const v = videoRef.current
    if (v) {
      try {
        v.currentTime = 0
      } catch {
        /* ignore */
      }
    }
    setCurrentTime(0)
  }

  const handleSave = async () => {
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await patchClipConfig(clip.id, {
        edit_config: { trim_start: round3(trim.start), trim_end: round3(trim.end) },
      })
      const saved = res?.data?.edit_config_json
      if (saved) {
        setTrim((prev) => ({
          start: typeof saved.trim_start === 'number' ? round1(saved.trim_start) : prev.start,
          end: typeof saved.trim_end === 'number' ? round1(saved.trim_end) : prev.end,
        }))
      }
      setSaveState('saved')
    } catch (err) {
      const first = err?.body?.errors ? Object.values(err.body.errors).flat()[0] : null
      setSaveError(first || err?.body?.message || err?.message || 'Gagal menyimpan potongan.')
      setSaveState('error')
    }
  }

  const retryVideo = () => {
    setVideoError(false)
    setReady(false)
    const v = videoRef.current
    if (v) v.load()
  }

  const saveLabel =
    saveState === 'saving'
      ? 'Menyimpan…'
      : saveState === 'saved'
        ? 'Tersimpan'
        : saveState === 'error'
          ? 'Gagal menyimpan'
          : 'Belum disimpan'
  const saveColor =
    saveState === 'saved' ? 'text-ok' : saveState === 'error' ? 'text-fail' : 'text-faint'

  return (
    <div className="w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-md py-1 text-[13px] text-muted transition hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
              <path d="M9.5 3.5L5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Kembali ke daftar
          </button>

          <h1
            className="mt-3 truncate font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl"
            title={clip.title}
          >
            {clip.title}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent"
              aria-label={`Skor viral ${clip.viral_score} dari 100`}
            >
              <span className="text-[9px] uppercase tracking-[0.1em] opacity-70">skor</span>
              <span className="text-xs">{clip.viral_score}</span>
            </span>
            <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted">
              {HOOK[clip.hook_type] || clip.hook_type}
            </span>
          </div>
        </div>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] ${saveColor}`}
        >
          {saveLabel}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
            <video
              ref={videoRef}
              src={`/api/clips/${clip.id}/video`}
              preload="metadata"
              playsInline
              className="h-full w-full bg-black object-contain"
              onLoadedMetadata={() => setReady(true)}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => {
                setVideoError(true)
                setReady(false)
              }}
            />

            {!ready && !videoError && (
              <div className="absolute inset-0 grid place-items-center bg-black/70">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Memuat video…</p>
              </div>
            )}

            {videoError && (
              <div className="absolute inset-0 grid place-items-center bg-void/85 p-6 text-center">
                <div>
                  <p className="text-sm text-ink">Video tidak dapat dimuat.</p>
                  <p className="mt-1 text-xs text-muted">Berkas klip mungkin belum siap. Coba muat ulang.</p>
                  <button type="button" onClick={retryVideo} className={`${BTN_GHOST} mt-4`}>
                    Muat ulang
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={togglePlay}
              disabled={videoError}
              aria-label={playing ? 'Jeda' : 'Putar'}
              className={`${BTN_PRIMARY} w-24 disabled:opacity-50`}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
              <span className="ml-2">{playing ? 'Jeda' : 'Putar'}</span>
            </button>
            <div className="font-mono text-xs">
              <span className="text-ink">{formatTime(currentTime)}</span>
              <span className="text-faint"> / {formatTime(duration)}</span>
            </div>
          </div>

          <div className="mt-4">
            <Timeline
              duration={duration}
              start={trim.start}
              end={trim.end}
              currentTime={currentTime}
              onChangeStart={changeStart}
              onChangeEnd={changeEnd}
              onSeek={seekTo}
            />
          </div>
        </div>

        <aside className="rounded-xl border border-line bg-panel/60 p-4 sm:p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Potongan</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <TimeField label="Awal" value={trim.start} />
            <TimeField label="Akhir" value={trim.end} />
          </div>

          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-faint">Durasi potongan</span>
            <span className="font-mono text-ink">{formatTime(trim.end - trim.start)}</span>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button type="button" onClick={handleSave} disabled={saveState === 'saving'} className={BTN_PRIMARY}>
              {saveState === 'saving' ? 'Menyimpan…' : 'Simpan trim'}
            </button>
            <button type="button" onClick={resetRange} className={BTN_GHOST}>
              Atur ulang ke durasi penuh
            </button>
          </div>

          {saveState === 'error' && saveError && (
            <p role="alert" className="mt-3 text-xs leading-relaxed text-fail">
              {saveError}
            </p>
          )}

          <p className="mt-4 text-xs leading-relaxed text-faint">
            Geser pegangan di timeline atau pakai tombol panah. Shift + panah untuk langkah 1 detik.
          </p>
        </aside>
      </div>
    </div>
  )
}
