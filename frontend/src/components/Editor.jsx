import { useEffect, useMemo, useRef, useState } from 'react'
import { getRenderJob, patchClipConfig, renderClip } from '../api'

const HOOK = {
  contrarian: 'Kontrarian',
  story: 'Cerita',
  actionable_tip: 'Tips praktis',
  emotional: 'Emosional',
  debate: 'Debat',
}

const MIN_GAP = 0.5

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
    else if (e > duration + 1.0) errors[r.id] = 'Waktu akhir melebihi durasi klip.'
    else if (!String(r.text).trim()) errors[r.id] = 'Teks subtitle kosong.'
  }
  return errors
}

const BTN =
  'inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const BTN_PRIMARY = `${BTN} bg-accent text-void hover:bg-accent-2`
const BTN_GHOST = `${BTN} border border-line text-ink hover:border-line-2 hover:bg-panel-2`

export default function Editor({ clip, onBack }) {
  const duration = useMemo(() => {
    const raw = Number(clip.end_sec) - Number(clip.start_sec)
    return Number.isFinite(raw) && raw > 0 ? round3(raw) : 1
  }, [clip.start_sec, clip.end_sec])

  // Active Tab: 'style' | 'subtitle' | 'export'
  const [activeTab, setActiveTab] = useState('style')

  // Timeline Multi-Cut Segments
  const [cuts, setCuts] = useState(() => {
    const c = clip.edit_config_json?.cuts
    if (Array.isArray(c) && c.length > 0) {
      return c
        .map((cut) => ({
          id: nextRowId(),
          start: clamp(round3(Number(cut.start ?? 0)), 0, duration - 0.2),
          end: clamp(round3(Number(cut.end ?? duration)), 0.2, duration),
        }))
        .filter((cut) => cut.end > cut.start)
    }
    return [{ id: nextRowId(), start: 0, end: duration }]
  })

  // History for Undo
  const [history, setHistory] = useState([])

  const pushHistory = (newCuts) => {
    setHistory((prev) => [...prev.slice(-10), cuts])
    setCuts(newCuts)
    setSaveState('idle')
  }

  const handleUndo = () => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setCuts(prev)
    setSaveState('idle')
  }

  const [currentTime, setCurrentTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState(null)

  const [aspectRatio, setAspectRatio] = useState(
    clip.edit_config_json?.aspect_ratio === '16:9' ? '16:9' : '9:16',
  )
  const [cropX, setCropX] = useState(() => {
    const c = clip.edit_config_json?.crop_x
    return typeof c === 'number' ? clamp(round3(c), 0, 1) : 0.5
  })
  const [layoutMode, setLayoutMode] = useState(
    clip.edit_config_json?.layout_mode === 'blur' ? 'blur' : 'crop',
  )
  const [hookBanner, setHookBanner] = useState(() => {
    const h = clip.edit_config_json?.hook_banner || {}
    return {
      enabled: typeof h.enabled === 'boolean' ? h.enabled : true,
      text: typeof h.text === 'string' ? h.text : (clip.title || '').toUpperCase(),
    }
  })
  const [subtitle, setSubtitle] = useState(() => {
    const s = clip.edit_config_json?.subtitle || {}
    return {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      position: s.position === 'top' || s.position === 'middle' || s.position === 'bottom' ? s.position : 'bottom',
      font_size: typeof s.font_size === 'number' ? Math.round(s.font_size) : 42,
      color: typeof s.color === 'string' && HEX.test(s.color) ? s.color.toUpperCase() : '#FFFFFF',
      highlight_color: typeof s.highlight_color === 'string' && HEX.test(s.highlight_color) ? s.highlight_color.toUpperCase() : '#FFE600',
      highlight_keywords: Array.isArray(s.highlight_keywords) ? s.highlight_keywords : [],
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
  const isDraggingCrop = useRef(false)
  const dragStartCrop = useRef({ startX: 0, initialCrop: 0 })

  // 1-Click Presets
  const applyPreset = (presetName) => {
    setSaveState('idle')
    if (presetName === 'hormozi') {
      setLayoutMode('crop')
      setHookBanner({ enabled: true, text: (hookBanner.text || clip.title || '').toUpperCase() })
      setSubtitle({
        enabled: true,
        position: 'middle',
        font_size: 54,
        color: '#FFFFFF',
        highlight_color: '#FFE600',
        highlight_keywords: subtitle.highlight_keywords.length > 0 ? subtitle.highlight_keywords : ['RAHASIA', 'PENTING', 'VIRAL'],
      })
    } else if (presetName === 'podcast') {
      setLayoutMode('blur')
      setHookBanner({ enabled: true, text: (hookBanner.text || clip.title || '').toUpperCase() })
      setSubtitle({
        enabled: true,
        position: 'bottom',
        font_size: 42,
        color: '#FFFFFF',
        highlight_color: '#4ADE80',
        highlight_keywords: subtitle.highlight_keywords,
      })
    } else if (presetName === 'breaking') {
      setLayoutMode('crop')
      setHookBanner({ enabled: true, text: `BREAKING: ${(hookBanner.text || clip.title || '').toUpperCase()}` })
      setSubtitle({
        enabled: true,
        position: 'bottom',
        font_size: 46,
        color: '#FACC15',
        highlight_color: '#EF4444',
        highlight_keywords: subtitle.highlight_keywords,
      })
    }
  }

  const seekTo = (t) => {
    const v = videoRef.current
    if (!v) return
    const clamped = clamp(t, 0, duration)
    try {
      v.currentTime = clamped
    } catch { /* ignore */ }
    setCurrentTime(clamped)
  }

  // Auto-skip inactive dead air during playback
  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)

    // Periksa apakah waktu saat ini ada di dalam salah satu segmen cuts
    const activeCut = cuts.find((c) => t >= c.start && t < c.end)
    if (!activeCut && cuts.length > 0) {
      // Sedang di area nonaktif/terhapus, otomatis loncat ke segmen aktif berikutnya
      const nextCut = cuts.find((c) => c.start > t)
      if (nextCut) {
        v.currentTime = nextCut.start
        setCurrentTime(nextCut.start)
      } else {
        // Lewat akhir segmen terakhir, loop ke awal segmen pertama
        v.currentTime = cuts[0].start
        setCurrentTime(cuts[0].start)
      }
    }
  }

  const togglePlay = async () => {
    const v = videoRef.current
    if (!v || videoError) return
    if (!v.paused) {
      v.pause()
      return
    }
    // Jika di luar cuts, posisikan ke segmen pertama
    const inCut = cuts.some((c) => v.currentTime >= c.start && v.currentTime < c.end)
    if (!inCut && cuts.length > 0) {
      v.currentTime = cuts[0].start
      setCurrentTime(cuts[0].start)
    }
    try {
      await v.play()
    } catch { /* ignore */ }
  }

  // Split segmen di playhead
  const splitAtPlayhead = () => {
    const t = round3(currentTime)
    const targetIdx = cuts.findIndex((c) => t > c.start + 0.3 && t < c.end - 0.3)
    if (targetIdx === -1) return

    const target = cuts[targetIdx]
    const seg1 = { id: nextRowId(), start: target.start, end: t }
    const seg2 = { id: nextRowId(), start: t, end: target.end }

    const nextCuts = [...cuts.slice(0, targetIdx), seg1, seg2, ...cuts.slice(targetIdx + 1)]
    pushHistory(nextCuts)
  }

  // Hapus satu segmen
  const deleteCut = (id) => {
    if (cuts.length <= 1) return
    const nextCuts = cuts.filter((c) => c.id !== id)
    pushHistory(nextCuts)
  }

  // Keyboard Shortcuts: Space (Play/Pause), S (Split)
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'KeyS') {
        e.preventDefault()
        splitAtPlayhead()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cuts, currentTime, playing])

  // Geometri Canvas Stage
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      setStageSize({ w: rect.width, h: rect.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geom = useMemo(() => {
    const sw = stageSize.w
    const sh = stageSize.h
    const vw = videoSize.w
    const vh = videoSize.h
    if (!sw || !sh || !vw || !vh) return null

    const videoAspect = vw / vh
    const stageAspect = sw / sh
    let dispW, dispH, offsetX, offsetY

    if (stageAspect > videoAspect) {
      dispH = sh
      dispW = sh * videoAspect
      offsetX = (sw - dispW) / 2
      offsetY = 0
    } else {
      dispW = sw
      dispH = sw / videoAspect
      offsetX = 0
      offsetY = (sh - dispH) / 2
    }

    const frameW = dispH * (9 / 16)
    const frameH = dispH
    const range = Math.max(0, dispW - frameW)

    return { dispW, dispH, offsetX, offsetY, frameW, frameH, range }
  }, [stageSize, videoSize])

  // Canvas Drag-to-Pan Crop
  const handlePointerDownCanvas = (e) => {
    if (aspectRatio !== '9:16' || layoutMode === 'blur' || !geom || !geom.range) return
    isDraggingCrop.current = true
    dragStartCrop.current = { startX: e.clientX, initialCrop: cropX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMoveCanvas = (e) => {
    if (!isDraggingCrop.current || !geom?.range) return
    const deltaX = e.clientX - dragStartCrop.current.startX
    // Geser video atau frame: geser mouse ke kiri menaikkan cropX
    const newCrop = clamp(dragStartCrop.current.initialCrop - deltaX / geom.range, 0, 1)
    setCropX(round3(newCrop))
    setSaveState('idle')
  }

  const handlePointerUpCanvas = (e) => {
    isDraggingCrop.current = false
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  }

  // Auto-Save Effect (Debounce 1.2s setelah perubahan selesai)
  useEffect(() => {
    if (saveState !== 'idle') return

    const timer = setTimeout(() => {
      handleSave()
    }, 1200)

    return () => clearTimeout(timer)
  }, [cuts, cropX, layoutMode, hookBanner, subtitle, rows, aspectRatio, saveState])

  const handleSave = async () => {
    const errors = validateRows(rows, duration)
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors)
      setSaveError('Periksa baris subtitle yang ditandai.')
      setSaveState('error')
      return
    }

    const sortedSubs = rows
      .map((r) => ({ start: round3(Number(r.start)), end: round3(Number(r.end)), text: String(r.text).trim() }))
      .sort((a, b) => a.start - b.start)

    const sortedCuts = cuts
      .map((c) => ({ start: round3(c.start), end: round3(c.end) }))
      .sort((a, b) => a.start - b.start)

    setSaveState('saving')
    setSaveError(null)

    try {
      await patchClipConfig(clip.id, {
        edit_config: {
          aspect_ratio: aspectRatio,
          crop_x: round3(cropX),
          layout_mode: layoutMode,
          hook_banner: {
            enabled: hookBanner.enabled,
            text: hookBanner.text.trim(),
          },
          cuts: sortedCuts,
          subtitle: {
            enabled: subtitle.enabled,
            position: subtitle.position,
            font_size: clamp(Math.round(subtitle.font_size) || 42, 8, 200),
            color: HEX.test(subtitle.color) ? subtitle.color.toUpperCase() : '#FFFFFF',
            highlight_color: HEX.test(subtitle.highlight_color) ? subtitle.highlight_color.toUpperCase() : '#FFE600',
            highlight_keywords: subtitle.highlight_keywords,
          },
        },
        subtitles: sortedSubs,
      })
      setSaveState('saved')
    } catch (err) {
      setSaveError(err?.message || 'Gagal menyimpan.')
      setSaveState('error')
    }
  }

  const handleRender = async () => {
    if (renderBusy) return
    setRenderBusy(true)
    setRenderError(null)
    try {
      const res = await renderClip(clip.id)
      setRenderJob(res?.data)
    } catch (err) {
      setRenderError(err?.message || 'Gagal memulai render.')
    } finally {
      setRenderBusy(false)
    }
  }

  // Render Polling
  useEffect(() => {
    if (!renderJob || (renderJob.status !== 'queued' && renderJob.status !== 'rendering')) return
    let cancelled = false
    let timer

    const poll = async () => {
      try {
        const data = await getRenderJob(renderJob.id)
        if (cancelled) return
        setRenderJob(data)
        if (data.status === 'queued' || data.status === 'rendering') {
          timer = setTimeout(poll, 1500)
        }
      } catch (err) {
        if (!cancelled) setRenderError(err?.message || 'Polling gagal.')
      }
    }

    timer = setTimeout(poll, 1500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [renderJob?.id, renderJob?.status, pollNonce])

  const activeSub = subtitle.enabled
    ? rows.find((r) => {
        const s = Number(r.start)
        const e = Number(r.end)
        return currentTime >= s && currentTime < e && String(r.text).trim().length > 0
      })
    : null

  const totalOutputDuration = cuts.reduce((acc, c) => acc + Math.max(0, c.end - c.start), 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Studio Topbar */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-panel/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className={BTN_GHOST}>
            ← Kembali
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink" title={clip.title}>
              {clip.title}
            </h2>
            <div className="flex items-center gap-2 font-mono text-[10px] text-faint">
              <span>Viral Score: {clip.viral_score}</span>
              <span>·</span>
              <span>Durasi Asli: {formatTime(duration)}</span>
              <span>·</span>
              <span className="text-accent">Output: {formatTime(totalOutputDuration)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Auto-Save */}
          <span className={`font-mono text-[11px] ${saveState === 'saved' ? 'text-ok' : saveState === 'saving' ? 'text-accent' : saveState === 'error' ? 'text-fail' : 'text-faint'}`}>
            {saveState === 'saved' ? '● Tersimpan' : saveState === 'saving' ? '● Menyimpan…' : saveState === 'error' ? '● Gagal' : '● Belum simpan'}
          </span>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`${BTN_PRIMARY} px-4`}
          >
            Export Video
          </button>
        </div>
      </div>

      {/* Studio Workspace: 2-Kolom Desktop (Kiri: Canvas + Timeline Bawah, Kanan: Tab Panel) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Kolom Kiri: Preview Canvas & Timeline (lg:col-span-8) */}
        <div className="flex flex-col gap-4 lg:col-span-8">
          {/* Canvas Preview Stage (Aspect 9:16 Center Focus) */}
          <div
            ref={stageRef}
            className="relative flex aspect-[9/14] sm:aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-void/90 shadow-2xl"
          >
            <video
              ref={videoRef}
              src={`/api/clips/${clip.id}/video`}
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
                setReady(true)
              }}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onError={() => setVideoError(true)}
              className="h-full w-full object-contain"
            />

            {/* Drag-to-pan crop overlay container */}
            {aspectRatio === '9:16' && layoutMode === 'crop' && geom && (
              <div
                onPointerDown={handlePointerDownCanvas}
                onPointerMove={handlePointerMoveCanvas}
                onPointerUp={handlePointerUpCanvas}
                onPointerCancel={handlePointerUpCanvas}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
              >
                {/* Dim background kiri/kanan */}
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: geom.offsetX,
                    top: geom.offsetY,
                    width: Math.max(0, cropX * geom.range),
                    height: geom.dispH,
                    backgroundColor: 'rgba(10,11,13,0.72)',
                  }}
                />
                <div
                  className="pointer-events-none absolute"
                  style={{
                    left: geom.offsetX + cropX * geom.range + geom.frameW,
                    top: geom.offsetY,
                    width: Math.max(0, (1 - cropX) * geom.range),
                    height: geom.dispH,
                    backgroundColor: 'rgba(10,11,13,0.72)',
                  }}
                />
                {/* Frame Garis Vertikal 9:16 */}
                <div
                  className="pointer-events-none absolute border border-accent/80 shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
                  style={{
                    left: geom.offsetX + cropX * geom.range,
                    top: geom.offsetY,
                    width: geom.frameW,
                    height: geom.frameH,
                  }}
                >
                  <span className="absolute left-2 top-2 rounded bg-accent/90 px-1.5 py-0.5 font-mono text-[9px] font-bold text-void">
                    9:16 CROP
                  </span>
                </div>
              </div>
            )}

            {/* Hook Banner Live Preview */}
            {hookBanner.enabled && hookBanner.text && geom && (
              <div
                className="pointer-events-none absolute inset-x-0 top-6 z-20 flex justify-center px-6"
                style={{
                  left: aspectRatio === '9:16' && layoutMode !== 'blur' ? geom.offsetX + cropX * geom.range : geom.offsetX,
                  width: aspectRatio === '9:16' && layoutMode !== 'blur' ? geom.frameW : geom.dispW,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 900,
                    fontSize: clamp(geom.dispH * 0.038, 14, 28),
                    color: '#FFFFFF',
                    textTransform: 'uppercase',
                    textAlign: 'center',
                    lineHeight: 1.15,
                    textShadow: '0 0 6px #000, 0 2px 8px rgba(0,0,0,0.95)',
                  }}
                >
                  {hookBanner.text}
                </span>
              </div>
            )}

            {/* Viral Subtitle Live Preview (Word Highlight) */}
            {activeSub && geom && (
              <div
                className="pointer-events-none absolute inset-x-0 bottom-12 z-20 flex justify-center px-6"
                style={{
                  left: aspectRatio === '9:16' && layoutMode !== 'blur' ? geom.offsetX + cropX * geom.range : geom.offsetX,
                  width: aspectRatio === '9:16' && layoutMode !== 'blur' ? geom.frameW : geom.dispW,
                }}
              >
                <div
                  style={{
                    fontFamily: "'Montserrat', sans-serif",
                    fontWeight: 800,
                    fontSize: clamp(subtitle.font_size * (geom.dispH / 1920) * 1.5, 16, 36),
                    textAlign: 'center',
                    lineHeight: 1.2,
                    textTransform: 'uppercase',
                    textShadow: '0 0 5px #000, 0 3px 6px rgba(0,0,0,0.95)',
                  }}
                >
                  {activeSub.text.split(/\s+/).map((word, wIdx) => {
                    const clean = word.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                    const isKeyword = (subtitle.highlight_keywords || []).map((k) => k.toUpperCase()).includes(clean)
                    return (
                      <span
                        key={wIdx}
                        style={{
                          color: isKeyword ? subtitle.highlight_color : subtitle.color,
                          marginRight: '0.25em',
                        }}
                      >
                        {word}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Player Transport & Shortcut Info */}
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel/60 p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                className={`${BTN_PRIMARY} h-8 w-20`}
              >
                {playing ? 'Jeda' : 'Putar'}
              </button>
              <button
                type="button"
                onClick={splitAtPlayhead}
                className={`${BTN_GHOST} h-8 text-accent`}
                title="Tekan tombol 'S' untuk split di posisi ini"
              >
                ✂ Split (S)
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={history.length === 0}
                className={`${BTN_GHOST} h-8`}
                title="Undo (Ctrl+Z)"
              >
                ↶ Undo
              </button>
            </div>

            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="text-ink">{formatTime(currentTime)}</span>
              <span className="text-faint">/ {formatTime(duration)}</span>
              <span className="hidden sm:inline text-faint">| Space: Play/Pause · S: Split</span>
            </div>
          </div>

          {/* Timeline Multi-Segmen Cuts Visual */}
          <div className="rounded-xl border border-line bg-panel/70 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-faint">
                Visual Jump-Cut Timeline ({cuts.length} Segmen Aktif)
              </span>
              <span className="font-mono text-[11px] text-accent">
                Klik area untuk seek · Drag slider untuk pan crop
              </span>
            </div>

            {/* Multi-cut Bar */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const clickPct = (e.clientX - rect.left) / rect.width
                seekTo(clickPct * duration)
              }}
              className="relative h-14 w-full cursor-pointer rounded-lg bg-void border border-line/80 overflow-hidden"
            >
              {/* Blok Segmen Aktif */}
              {cuts.map((c, i) => {
                const leftPct = (c.start / duration) * 100
                const widthPct = ((c.end - c.start) / duration) * 100
                return (
                  <div
                    key={c.id}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className="group absolute inset-y-1 rounded bg-accent/20 border border-accent/60 flex items-center justify-between px-2 overflow-hidden hover:bg-accent/30 transition"
                  >
                    <span className="font-mono text-[10px] text-accent font-bold truncate">
                      #{i + 1} ({formatTime(c.end - c.start)})
                    </span>
                    {cuts.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteCut(c.id)
                        }}
                        className="rounded p-0.5 text-fail hover:bg-fail/20 text-xs font-mono"
                        title="Hapus segmen ini"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Playhead Indicator */}
              <div
                style={{ left: `${(currentTime / duration) * 100}%` }}
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_white]"
              />
            </div>
          </div>
        </div>

        {/* Kolom Kanan: 3 Tab Panel (Gaya & Hook, Subtitle, Export) (lg:col-span-4) */}
        <div className="flex flex-col gap-4 lg:col-span-4">
          {/* Tab Navigation */}
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel/70 p-1">
            {[
              ['style', 'Gaya & Hook'],
              ['subtitle', 'Subtitle'],
              ['export', 'Export'],
            ].map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`rounded-lg py-2 text-xs font-medium transition ${
                  activeTab === tabId
                    ? 'bg-accent text-void font-bold shadow-sm'
                    : 'text-muted hover:text-ink hover:bg-panel-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab 1: Gaya & Hook */}
          {activeTab === 'style' && (
            <div className="space-y-4 rounded-xl border border-line bg-panel/60 p-4">
              {/* 3 Preset 1-Klik */}
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                  Preset Cepat 1-Klik
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('hormozi')}
                    className="rounded-lg border border-line p-2 text-center hover:border-accent hover:bg-panel-2 transition"
                  >
                    <span className="block text-xs font-bold text-accent">Hormozi</span>
                    <span className="text-[10px] text-faint">Full Crop + Bold</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('podcast')}
                    className="rounded-lg border border-line p-2 text-center hover:border-accent hover:bg-panel-2 transition"
                  >
                    <span className="block text-xs font-bold text-ok">Podcast</span>
                    <span className="text-[10px] text-faint">Blur BG + Clean</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('breaking')}
                    className="rounded-lg border border-line p-2 text-center hover:border-accent hover:bg-panel-2 transition"
                  >
                    <span className="block text-xs font-bold text-fail">Breaking</span>
                    <span className="text-[10px] text-faint">News Punch</span>
                  </button>
                </div>
              </div>

              {/* Layout Mode */}
              <div className="border-t border-line pt-3">
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                  Mode Layout 9:16
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setLayoutMode('crop'); setSaveState('idle'); }}
                    className={`rounded-lg border p-2 text-xs font-medium transition ${
                      layoutMode === 'crop'
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-line text-muted hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    Full Crop (Zoom)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLayoutMode('blur'); setSaveState('idle'); }}
                    className={`rounded-lg border p-2 text-xs font-medium transition ${
                      layoutMode === 'blur'
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-line text-muted hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    Blur Background
                  </button>
                </div>
              </div>

              {/* Hook Banner Input */}
              <div className="border-t border-line pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
                    Hook Banner Teks
                  </p>
                  <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hookBanner.enabled}
                      onChange={(e) => {
                        setHookBanner((prev) => ({ ...prev, enabled: e.target.checked }))
                        setSaveState('idle')
                      }}
                      className="rounded border-line"
                      style={{ accentColor: '#eaa33c' }}
                    />
                    Tampilkan
                  </label>
                </div>
                {hookBanner.enabled && (
                  <input
                    type="text"
                    value={hookBanner.text}
                    onChange={(e) => {
                      setHookBanner((prev) => ({ ...prev, text: e.target.value.toUpperCase() }))
                      setSaveState('idle')
                    }}
                    placeholder="BANNER HOOK ATAS..."
                    className="w-full rounded-lg border border-line bg-void px-3 py-2 text-xs font-bold font-sans text-ink focus:border-accent focus:outline-none"
                  />
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Subtitle */}
          {activeTab === 'subtitle' && (
            <div className="space-y-4 rounded-xl border border-line bg-panel/60 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint">
                  Pengaturan Subtitle
                </p>
                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subtitle.enabled}
                    onChange={(e) => {
                      setSubtitle((prev) => ({ ...prev, enabled: e.target.checked }))
                      setSaveState('idle')
                    }}
                    className="rounded border-line"
                    style={{ accentColor: '#eaa33c' }}
                  />
                  Aktif
                </label>
              </div>

              {subtitle.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block font-mono text-[10px] text-faint mb-1">Warna Teks</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={subtitle.color}
                          onChange={(e) => {
                            setSubtitle((p) => ({ ...p, color: e.target.value.toUpperCase() }))
                            setSaveState('idle')
                          }}
                          className="h-7 w-9 rounded cursor-pointer border border-line bg-void"
                        />
                        <span className="font-mono text-xs text-muted">{subtitle.color}</span>
                      </div>
                    </div>
                    <div>
                      <span className="block font-mono text-[10px] text-faint mb-1">Warna Highlight</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={subtitle.highlight_color}
                          onChange={(e) => {
                            setSubtitle((p) => ({ ...p, highlight_color: e.target.value.toUpperCase() }))
                            setSaveState('idle')
                          }}
                          className="h-7 w-9 rounded cursor-pointer border border-line bg-void"
                        />
                        <span className="font-mono text-xs text-muted">{subtitle.highlight_color}</span>
                      </div>
                    </div>
                  </div>

                  {/* Daftar Baris Subtitle (Klik to Seek) */}
                  <div className="border-t border-line pt-3">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                      Baris Subtitle (Klik untuk Lompat)
                    </p>
                    <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {rows.map((r) => {
                        const isActiveRow = currentTime >= Number(r.start) && currentTime < Number(r.end)
                        return (
                          <div
                            key={r.id}
                            onClick={() => seekTo(Number(r.start))}
                            className={`flex cursor-pointer items-center justify-between rounded-md border p-2 text-xs transition ${
                              isActiveRow
                                ? 'border-accent bg-accent/15 text-accent font-semibold'
                                : 'border-line/70 bg-void/50 text-muted hover:border-accent/40 hover:text-ink'
                            }`}
                          >
                            <span className="truncate pr-2">{r.text}</span>
                            <span className="shrink-0 font-mono text-[10px] text-faint">
                              {formatTime(Number(r.start))}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tab 3: Export */}
          {activeTab === 'export' && (
            <div className="space-y-4 rounded-xl border border-line bg-panel/60 p-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                  Ringkasan Render Final
                </p>
                <div className="space-y-1.5 text-xs text-muted font-mono">
                  <div className="flex justify-between">
                    <span>Format</span>
                    <span className="text-ink">MP4 (H.264 + AAC)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Resolusi</span>
                    <span className="text-ink">1080x1920 (9:16)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Audio Target</span>
                    <span className="text-ink">-14 LUFS Broadcast</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Durasi</span>
                    <span className="text-accent font-bold">{formatTime(totalOutputDuration)}</span>
                  </div>
                </div>
              </div>

              {renderJob && (renderJob.status === 'queued' || renderJob.status === 'rendering') ? (
                <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-accent font-medium">
                      {renderJob.status === 'queued' ? 'Menunggu antrean...' : 'Sedang merender video...'}
                    </span>
                    <span className="font-mono text-ink font-bold">{renderJob.progress_percent}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-void">
                    <div
                      className="h-full bg-accent transition-[width] duration-300"
                      style={{ width: `${renderJob.progress_percent}%` }}
                    />
                  </div>
                </div>
              ) : renderJob?.status === 'done' ? (
                <div className="space-y-2">
                  <a
                    href={`/api/render-jobs/${renderJob.id}/download`}
                    download
                    className={`${BTN_PRIMARY} w-full py-2.5 text-center text-sm font-bold`}
                  >
                    Unduh Video Final (.MP4)
                  </a>
                  <button
                    type="button"
                    onClick={handleRender}
                    className={`${BTN_GHOST} w-full`}
                  >
                    Render Ulang
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={renderBusy}
                  className={`${BTN_PRIMARY} w-full py-2.5 text-sm font-bold`}
                >
                  {renderBusy ? 'Memulai Render…' : 'Mulai Render Video Final'}
                </button>
              )}

              {renderError && (
                <p role="alert" className="text-xs text-fail">
                  {renderError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
