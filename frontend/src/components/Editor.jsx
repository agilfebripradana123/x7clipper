import { useEffect, useMemo, useRef, useState } from 'react'
import { getRenderJob, patchClipConfig, renderClip } from '../api'

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

let rowSeq = 0
const nextRowId = () => ++rowSeq
const secStr = (n) => {
  const v = Number(n)
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0'
}
const HEX = /^#[0-9a-fA-F]{6}$/

function validateRows(rows, duration) {
  const errors = {}
  for (const r of rows) {
    const s = Number(r.start)
    const e = Number(r.end)
    if (!Number.isFinite(s) || s < 0) errors[r.id] = 'Waktu awal tidak valid.'
    else if (!Number.isFinite(e) || e <= s) errors[r.id] = 'Waktu akhir harus setelah awal.'
    else if (e > duration + 0.5) errors[r.id] = 'Waktu akhir melebihi durasi klip.'
    else if (!String(r.text).trim()) errors[r.id] = 'Teks subtitle kosong.'
  }
  return errors
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
  const [aspectRatio, setAspectRatio] = useState(
    clip.edit_config_json?.aspect_ratio === '9:16' ? '9:16' : '16:9',
  )
  const [cropX, setCropX] = useState(() => {
    const c = clip.edit_config_json?.crop_x
    return typeof c === 'number' ? clamp(round3(c), 0, 1) : 0.5
  })
  const [subtitle, setSubtitle] = useState(() => {
    const s = clip.edit_config_json?.subtitle || {}
    return {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      position: s.position === 'top' || s.position === 'middle' || s.position === 'bottom' ? s.position : 'bottom',
      font_size: typeof s.font_size === 'number' ? Math.round(s.font_size) : 42,
      color: typeof s.color === 'string' && HEX.test(s.color) ? s.color.toUpperCase() : '#FFFFFF',
    }
  })
  const [rows, setRows] = useState(() =>
    (clip.subtitle_json || []).map((s) => ({
      id: nextRowId(),
      start: secStr(s.start),
      end: secStr(s.end),
      text: s.text ?? '',
    })),
  )
  const [rowErrors, setRowErrors] = useState({})
  const [renderJob, setRenderJob] = useState(null)
  const [renderBusy, setRenderBusy] = useState(false)
  const [renderError, setRenderError] = useState(null)
  const [pollNonce, setPollNonce] = useState(0)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 })

  const videoRef = useRef(null)
  const stageRef = useRef(null)
  const dragRef = useRef(null)

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

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setStageSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    setStageSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!renderJob) return
    if (renderJob.status === 'done' || renderJob.status === 'failed') return

    let cancelled = false
    let timer
    const jobId = renderJob.id

    const tick = async () => {
      try {
        const data = await getRenderJob(jobId)
        if (cancelled) return
        setRenderJob((prev) =>
          prev &&
          data.id === prev.id &&
          typeof data.progress_percent === 'number' &&
          data.progress_percent < prev.progress_percent
            ? { ...data, progress_percent: prev.progress_percent }
            : data,
        )
        if (data.status !== 'done' && data.status !== 'failed') {
          timer = setTimeout(tick, 1500)
        }
      } catch (err) {
        if (!cancelled) setRenderError(err?.message || 'Gagal memuat status render.')
      }
    }

    timer = setTimeout(tick, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [renderJob?.id, renderJob?.status, pollNonce])

  const geom = useMemo(() => {
    if (!stageSize.w || !stageSize.h || !videoSize.w || !videoSize.h) return null
    const scale = Math.min(stageSize.w / videoSize.w, stageSize.h / videoSize.h)
    const dispW = videoSize.w * scale
    const dispH = videoSize.h * scale
    const offsetX = (stageSize.w - dispW) / 2
    const offsetY = (stageSize.h - dispH) / 2
    const frameH = dispH
    const frameW = Math.min(dispW, (dispH * 9) / 16)
    const range = Math.max(0, dispW - frameW)
    return { dispW, dispH, offsetX, offsetY, frameH, frameW, range }
  }, [stageSize, videoSize])

  const changeAspect = (value) => {
    setAspectRatio(value)
    setSaveState('idle')
    setSaveError(null)
  }

  const changeCrop = (value) => {
    setCropX(clamp(value, 0, 1))
    setSaveState('idle')
    setSaveError(null)
  }

  const resetCrop = () => {
    setCropX(0.5)
    setSaveState('idle')
    setSaveError(null)
  }

  const markDirty = () => {
    setSaveState('idle')
    setSaveError(null)
  }

  const updateSubtitle = (patch) => {
    setSubtitle((prev) => ({ ...prev, ...patch }))
    markDirty()
  }

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setRowErrors((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    markDirty()
  }

  const removeRow = (id) => {
    setRows((prev) => prev.filter((r) => r.id !== id))
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    markDirty()
  }

  const addRow = () => {
    setRows((prev) => {
      const last = prev[prev.length - 1]
      let start = last ? Number(last.end) : 0
      if (!Number.isFinite(start)) start = 0
      start = clamp(start, 0, Math.max(0, duration - 2))
      const end = clamp(start + 2, start + 0.1, duration)
      return [...prev, { id: nextRowId(), start: secStr(start), end: secStr(end), text: '' }]
    })
    markDirty()
  }

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
    const errors = validateRows(rows, duration)
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors)
      setSaveError('Periksa baris subtitle yang ditandai.')
      setSaveState('idle')
      return
    }

    const sorted = rows
      .map((r) => ({ start: round3(Number(r.start)), end: round3(Number(r.end)), text: String(r.text).trim() }))
      .sort((a, b) => a.start - b.start)

    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await patchClipConfig(clip.id, {
        edit_config: {
          trim_start: round3(trim.start),
          trim_end: round3(trim.end),
          aspect_ratio: aspectRatio,
          crop_x: round3(cropX),
          subtitle: {
            enabled: subtitle.enabled,
            position: subtitle.position,
            font_size: clamp(Math.round(subtitle.font_size) || 42, 8, 200),
            color: HEX.test(subtitle.color) ? subtitle.color.toUpperCase() : '#FFFFFF',
          },
        },
        subtitles: sorted,
      })

      const saved = res?.data?.edit_config_json
      if (saved) {
        setTrim((prev) => ({
          start: typeof saved.trim_start === 'number' ? round1(saved.trim_start) : prev.start,
          end: typeof saved.trim_end === 'number' ? round1(saved.trim_end) : prev.end,
        }))
        if (saved.aspect_ratio === '16:9' || saved.aspect_ratio === '9:16') {
          setAspectRatio(saved.aspect_ratio)
        }
        if (typeof saved.crop_x === 'number') {
          setCropX(clamp(round3(saved.crop_x), 0, 1))
        }
        if (saved.subtitle) {
          const s = saved.subtitle
          setSubtitle((prev) => ({
            enabled: typeof s.enabled === 'boolean' ? s.enabled : prev.enabled,
            position:
              s.position === 'top' || s.position === 'middle' || s.position === 'bottom'
                ? s.position
                : prev.position,
            font_size: typeof s.font_size === 'number' ? Math.round(s.font_size) : prev.font_size,
            color: typeof s.color === 'string' && HEX.test(s.color) ? s.color.toUpperCase() : prev.color,
          }))
        }
      }

      const savedSubs = res?.data?.subtitle_json
      if (Array.isArray(savedSubs)) {
        setRows(
          savedSubs.map((s) => ({
            id: nextRowId(),
            start: secStr(s.start),
            end: secStr(s.end),
            text: s.text ?? '',
          })),
        )
      }

      setRowErrors({})
      setSaveState('saved')
    } catch (err) {
      const first = err?.body?.errors ? Object.values(err.body.errors).flat()[0] : null
      setSaveError(first || err?.body?.message || err?.message || 'Gagal menyimpan perubahan.')
      setSaveState('error')
    }
  }

  const handleRender = async () => {
    if (saveState !== 'saved') return
    if (renderBusy) return
    if (renderJob && (renderJob.status === 'queued' || renderJob.status === 'rendering')) return

    setRenderBusy(true)
    setRenderError(null)
    try {
      const res = await renderClip(clip.id)
      const job = res?.data
      if (job) {
        setRenderJob(job)
      } else {
        setRenderError('Gagal memulai render.')
      }
    } catch (err) {
      const first = err?.body?.errors ? Object.values(err.body.errors).flat()[0] : null
      setRenderError(first || err?.body?.message || err?.message || 'Gagal memulai render.')
    } finally {
      setRenderBusy(false)
    }
  }

  const retryPoll = () => {
    setRenderError(null)
    setPollNonce((n) => n + 1)
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

  const activeSub = subtitle.enabled
    ? rows.find((r) => {
        const s = Number(r.start)
        const e = Number(r.end)
        return (
          Number.isFinite(s) &&
          Number.isFinite(e) &&
          currentTime >= s &&
          currentTime < e &&
          String(r.text).trim().length > 0
        )
      })
    : null

  const renderStatusLabel = !renderJob
    ? ''
    : renderJob.status === 'queued'
      ? 'Menunggu antrean'
      : renderJob.status === 'rendering'
        ? 'Merender…'
        : renderJob.status === 'done'
          ? 'Render selesai'
          : 'Render gagal'
  const renderPct = clamp(Math.round(renderJob?.progress_percent ?? 0), 0, 100)

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
          <div
            ref={stageRef}
            className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black"
          >
            <video
              ref={videoRef}
              src={`/api/clips/${clip.id}/video`}
              preload="metadata"
              playsInline
              className="h-full w-full bg-black object-contain"
              onLoadedMetadata={(e) => {
                setReady(true)
                setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
              }}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => {
                setVideoError(true)
                setReady(false)
              }}
            />

            {aspectRatio === '9:16' && geom && (
              <>
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: geom.offsetX,
                    top: geom.offsetY,
                    width: Math.max(0, cropX * geom.range),
                    height: geom.dispH,
                    backgroundColor: 'rgba(10,11,13,0.62)',
                    backgroundImage:
                      'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 7px)',
                  }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: geom.offsetX + cropX * geom.range + geom.frameW,
                    top: geom.offsetY,
                    width: Math.max(0, (1 - cropX) * geom.range),
                    height: geom.dispH,
                    backgroundColor: 'rgba(10,11,13,0.62)',
                    backgroundImage:
                      'repeating-linear-gradient(135deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 7px)',
                  }}
                  aria-hidden="true"
                />
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label="Posisi crop horizontal"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(cropX * 100)}
                  aria-valuetext={`Posisi ${Math.round(cropX * 100)} persen`}
                  aria-orientation="horizontal"
                  style={{
                    left: geom.offsetX + cropX * geom.range,
                    top: geom.offsetY,
                    width: geom.frameW,
                    height: geom.frameH,
                  }}
                  className="absolute cursor-ew-resize touch-none border border-accent/90 shadow-[0_0_0_1px_rgba(10,11,13,0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.currentTarget.setPointerCapture?.(e.pointerId)
                    dragRef.current = { startX: e.clientX, startCrop: cropX }
                  }}
                  onPointerMove={(e) => {
                    const d = dragRef.current
                    if (!d || !geom.range) return
                    changeCrop(d.startCrop + (e.clientX - d.startX) / geom.range)
                  }}
                  onPointerUp={(e) => {
                    dragRef.current = null
                    e.currentTarget.releasePointerCapture?.(e.pointerId)
                  }}
                  onPointerCancel={(e) => {
                    dragRef.current = null
                    e.currentTarget.releasePointerCapture?.(e.pointerId)
                  }}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 0.1 : 0.01
                    if (e.key === 'ArrowLeft') {
                      e.preventDefault()
                      changeCrop(cropX - step)
                    } else if (e.key === 'ArrowRight') {
                      e.preventDefault()
                      changeCrop(cropX + step)
                    } else if (e.key === 'Home') {
                      e.preventDefault()
                      changeCrop(0)
                    } else if (e.key === 'End') {
                      e.preventDefault()
                      changeCrop(1)
                    }
                  }}
                >
                  <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-medium text-void">
                    9:16
                  </span>
                  <span
                    className="absolute left-1/2 top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/70"
                    aria-hidden="true"
                  />
                </div>
              </>
            )}

            {activeSub && geom && (
              <div
                className="pointer-events-none absolute overflow-hidden"
                style={{
                  left: aspectRatio === '9:16' ? geom.offsetX + cropX * geom.range : geom.offsetX,
                  top: geom.offsetY,
                  width: aspectRatio === '9:16' ? geom.frameW : geom.dispW,
                  height: geom.dispH,
                }}
              >
                <div
                  className="flex h-full w-full justify-center"
                  style={{
                    alignItems:
                      subtitle.position === 'top'
                        ? 'flex-start'
                        : subtitle.position === 'middle'
                          ? 'center'
                          : 'flex-end',
                    paddingTop: subtitle.position === 'top' ? geom.dispH * 0.06 : 0,
                    paddingBottom: subtitle.position === 'bottom' ? geom.dispH * 0.06 : 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'Arial, sans-serif',
                      fontSize: clamp(
                        subtitle.font_size * (geom.dispH / (aspectRatio === '9:16' ? 1920 : 1080)),
                        11,
                        geom.dispH * 0.3,
                      ),
                      color: subtitle.color,
                      fontWeight: 700,
                      lineHeight: 1.15,
                      textAlign: 'center',
                      maxWidth: '92%',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      textShadow: '0 0 2px #000, 0 1px 3px rgba(0,0,0,0.85)',
                    }}
                  >
                    {activeSub.text}
                  </span>
                </div>
              </div>
            )}

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
              {saveState === 'saving' ? 'Menyimpan…' : 'Simpan perubahan'}
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

          <div className="mt-5 border-t border-line pt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Rasio &amp; Crop</p>

            <div role="group" aria-label="Rasio aspek" className="mt-3 grid grid-cols-2 gap-2">
              {[
                ['16:9', 'Lanskap'],
                ['9:16', 'Vertikal'],
              ].map(([value, label]) => {
                const active = aspectRatio === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => changeAspect(value)}
                    aria-pressed={active}
                    className={`rounded-lg border px-3 py-2.5 text-left transition ${
                      active
                        ? 'border-accent bg-accent/10'
                        : 'border-line hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    <span className={`block font-mono text-xs ${active ? 'text-accent' : 'text-muted'}`}>
                      {value}
                    </span>
                    <span className={`mt-0.5 block text-[11px] ${active ? 'text-ink' : 'text-faint'}`}>
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>

            {aspectRatio === '9:16' ? (
              <>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-muted">Posisi {Math.round(cropX * 100)}%</span>
                  <button
                    type="button"
                    onClick={resetCrop}
                    className="rounded text-[11px] text-faint underline-offset-2 hover:text-muted hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    Atur ulang crop ke tengah
                  </button>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-faint">
                  Geser bingkai di video, atau fokuskan lalu pakai tombol panah.
                </p>
              </>
            ) : (
              <p className="mt-3 text-xs leading-relaxed text-faint">Mode lanskap memakai frame penuh.</p>
            )}
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Subtitle</p>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={subtitle.enabled}
                  onChange={(e) => updateSubtitle({ enabled: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border border-line bg-void"
                  style={{ accentColor: '#eaa33c' }}
                />
                Aktif
              </label>
            </div>

            <div role="group" aria-label="Posisi subtitle" className="mt-3 grid grid-cols-3 gap-1.5">
              {[
                ['top', 'Atas'],
                ['middle', 'Tengah'],
                ['bottom', 'Bawah'],
              ].map(([value, label]) => {
                const active = subtitle.position === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateSubtitle({ position: value })}
                    aria-pressed={active}
                    className={`rounded-md border py-1.5 text-[11px] transition ${
                      active
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-line text-muted hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <div className="mt-3">
              <label
                htmlFor="sub-size"
                className="block font-mono text-[10px] uppercase tracking-[0.12em] text-faint"
              >
                Ukuran font
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={8}
                  max={200}
                  step={1}
                  value={clamp(Math.round(subtitle.font_size), 8, 200)}
                  onChange={(e) => updateSubtitle({ font_size: Number(e.target.value) })}
                  aria-label="Ukuran font subtitle"
                  className="flex-1"
                  style={{ accentColor: '#eaa33c' }}
                />
                <input
                  id="sub-size"
                  type="number"
                  min={8}
                  max={200}
                  value={subtitle.font_size}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    updateSubtitle({ font_size: Number.isFinite(v) ? v : subtitle.font_size })
                  }}
                  onBlur={() =>
                    updateSubtitle({ font_size: clamp(Math.round(subtitle.font_size) || 42, 8, 200) })
                  }
                  className="h-8 w-16 rounded-md border border-line bg-void/60 px-2 text-center font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="color"
                value={subtitle.color}
                onChange={(e) => updateSubtitle({ color: e.target.value.toUpperCase() })}
                aria-label="Warna subtitle"
                className="h-8 w-10 cursor-pointer rounded border border-line bg-void"
              />
              <span className="font-mono text-xs text-muted">{subtitle.color.toUpperCase()}</span>
            </div>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Ekspor</p>

            {renderJob && (renderJob.status === 'queued' || renderJob.status === 'rendering') ? (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs">
                  <span role="status" aria-live="polite" className="text-muted">
                    {renderStatusLabel}
                  </span>
                  <span className="font-mono text-ink">{renderPct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Progres render"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={renderPct}
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full border border-line bg-void/70"
                >
                  <div
                    className="h-full bg-accent transition-[width] duration-500 ease-out"
                    style={{ width: `${renderPct}%` }}
                  />
                </div>
                {renderError && (
                  <div className="mt-3">
                    <p role="alert" className="text-xs text-fail">
                      {renderError}
                    </p>
                    <button type="button" onClick={retryPoll} className={`${BTN_GHOST} mt-2 w-full`}>
                      Coba lagi
                    </button>
                  </div>
                )}
              </div>
            ) : renderJob?.status === 'done' ? (
              <div className="mt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ok">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />
                  Render selesai
                </div>
                <a
                  href={`/api/render-jobs/${renderJob.id}/download`}
                  download
                  className={`${BTN_PRIMARY} mt-3 w-full`}
                >
                  Unduh video
                </a>
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={renderBusy || saveState !== 'saved'}
                  className={`${BTN_GHOST} mt-2 w-full`}
                >
                  Render ulang
                </button>
              </div>
            ) : renderJob?.status === 'failed' ? (
              <div className="mt-3">
                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-fail">
                  <span className="h-1.5 w-1.5 rounded-full bg-fail" aria-hidden="true" />
                  Render gagal
                </div>
                <p role="alert" className="mt-2 text-xs leading-relaxed text-fail">
                  {renderJob.error_message || 'Render gagal. Coba lagi.'}
                </p>
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={renderBusy || saveState !== 'saved'}
                  className={`${BTN_GHOST} mt-3 w-full`}
                >
                  Coba lagi
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={renderBusy || saveState !== 'saved'}
                  className={`${BTN_PRIMARY} w-full`}
                >
                  {renderBusy ? 'Memulai…' : 'Render final'}
                </button>
                {renderError && (
                  <p role="alert" className="text-xs text-fail">
                    {renderError}
                  </p>
                )}
              </div>
            )}

            {saveState !== 'saved' &&
              (!renderJob || renderJob.status === 'done' || renderJob.status === 'failed') && (
                <div className="mt-3 rounded-md border border-line bg-panel-2/60 p-3">
                  <p className="text-xs leading-relaxed text-muted">
                    Render memakai pengaturan tersimpan. Simpan perubahan dulu.
                  </p>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saveState === 'saving'}
                    className={`${BTN_GHOST} mt-2 w-full`}
                  >
                    {saveState === 'saving' ? 'Menyimpan…' : 'Simpan dulu'}
                  </button>
                </div>
              )}
          </div>
        </aside>
      </div>

      <section className="mt-6" aria-labelledby="subtitle-rows-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Teks subtitle</p>
            <h2 id="subtitle-rows-heading" className="mt-1.5 font-display text-lg font-semibold text-ink">
              Baris subtitle{' '}
              <span className="font-mono text-xs font-normal text-faint">({rows.length})</span>
            </h2>
          </div>
          <button type="button" onClick={addRow} className={BTN_GHOST}>
            Tambah baris
          </button>
        </div>

        {Object.keys(rowErrors).length > 0 && (
          <p role="alert" className="mt-3 text-xs text-fail">
            Periksa baris yang ditandai sebelum menyimpan.
          </p>
        )}

        {rows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-line bg-panel/40 p-6 text-center">
            <p className="text-sm text-muted">Belum ada baris subtitle.</p>
            <button type="button" onClick={addRow} className={`${BTN_GHOST} mt-3`}>
              Tambah baris
            </button>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {rows.map((row, i) => {
              const err = rowErrors[row.id]
              const field = err ? 'border-fail' : 'border-line'
              return (
                <li key={row.id} className="rounded-lg border border-line bg-panel/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-[96px_96px_minmax(0,1fr)_auto] sm:items-center">
                    <label className="flex items-center gap-2 sm:block">
                      <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-faint sm:mb-1 sm:block">
                        Awal
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.start}
                        onChange={(e) => updateRow(row.id, { start: e.target.value })}
                        aria-label={`Waktu awal baris ${i + 1}`}
                        aria-invalid={err ? 'true' : undefined}
                        className={`h-8 w-full rounded-md border bg-void/60 px-2 font-mono text-xs text-ink outline-none focus:border-accent ${field}`}
                      />
                    </label>
                    <label className="flex items-center gap-2 sm:block">
                      <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-faint sm:mb-1 sm:block">
                        Akhir
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.end}
                        onChange={(e) => updateRow(row.id, { end: e.target.value })}
                        aria-label={`Waktu akhir baris ${i + 1}`}
                        aria-invalid={err ? 'true' : undefined}
                        className={`h-8 w-full rounded-md border bg-void/60 px-2 font-mono text-xs text-ink outline-none focus:border-accent ${field}`}
                      />
                    </label>
                    <label className="flex items-center gap-2 sm:block">
                      <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-faint sm:mb-1 sm:block">
                        Teks
                      </span>
                      <input
                        type="text"
                        maxLength={500}
                        value={row.text}
                        onChange={(e) => updateRow(row.id, { text: e.target.value })}
                        placeholder="Tulis subtitle…"
                        aria-label={`Teks baris ${i + 1}`}
                        className="h-8 w-full rounded-md border border-line bg-void/60 px-2 text-xs text-ink outline-none placeholder:text-faint focus:border-accent"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Hapus baris ${i + 1}`}
                      className="justify-self-start rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted transition hover:border-fail/50 hover:text-fail focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:justify-self-end"
                    >
                      Hapus
                    </button>
                  </div>
                  {err && <p className="mt-2 text-xs text-fail">{err}</p>}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
