import { useEffect, useMemo, useRef, useState } from 'react'
import { getProject, getRenderJob, patchClipConfig, prepareClip, renderClip } from '../api'

const round1 = (n) => Math.round(n * 10) / 10
const round2 = (n) => Math.round(n * 100) / 100
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
  'inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
const BTN_PRIMARY = `${BTN} bg-accent text-void hover:bg-accent-2 font-bold`
const BTN_GHOST = `${BTN} border border-line text-ink hover:border-line-2 hover:bg-panel-2`

export default function Editor({ clip, onBack }) {
  const duration = useMemo(() => {
    const raw = Number(clip.end_sec) - Number(clip.start_sec)
    return Number.isFinite(raw) && raw > 0 ? round3(raw) : 1
  }, [clip.start_sec, clip.end_sec])

  // Active Right Tab: 'style' | 'subtitle' | 'export'
  const [activeTab, setActiveTab] = useState('style')

  // Timeline Segments (Cuts): [{ id, start, end, active: true|false }]
  const [cuts, setCuts] = useState(() => {
    const c = clip.edit_config_json?.cuts
    if (Array.isArray(c) && c.length > 0) {
      return c
        .map((cut) => ({
          id: nextRowId(),
          start: clamp(round3(Number(cut.start ?? 0)), 0, duration - 0.1),
          end: clamp(round3(Number(cut.end ?? duration)), 0.1, duration),
          active: cut.active !== false,
        }))
        .filter((cut) => cut.end > cut.start)
    }
    return [{ id: nextRowId(), start: 0, end: duration, active: true }]
  })

  // Selected Segment ID
  const [selectedCutId, setSelectedCutId] = useState(null)

  // History for Undo
  const [history, setHistory] = useState([])

  const pushHistory = (newCuts) => {
    setHistory((prev) => [...prev.slice(-15), cuts])
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

  // Aspect Ratio: 9:16 | 1:1 | 4:3 | 16:9
  const [aspectRatio, setAspectRatio] = useState(() => {
    const ar = clip.edit_config_json?.aspect_ratio
    return ['9:16', '1:1', '4:3', '16:9'].includes(ar) ? ar : '9:16'
  })

  const [cropX, setCropX] = useState(() => {
    const c = clip.edit_config_json?.crop_x
    return typeof c === 'number' ? clamp(round3(c), 0, 1) : 0.5
  })

  const [layoutMode, setLayoutMode] = useState(() => {
    const lm = clip.edit_config_json?.layout_mode
    return lm === 'blur' || lm === 'blur_bg' ? 'blur_bg' : 'full_crop'
  })

  const [hookBanner, setHookBanner] = useState(() => {
    const h = clip.edit_config_json?.hook_banner || {}
    return {
      enabled: typeof h.enabled === 'boolean' ? h.enabled : true,
      text: typeof h.text === 'string' ? h.text : (clip.title || '').toUpperCase(),
    }
  })

  const [subtitleFontSize, setSubtitleFontSize] = useState(() => {
    const fs = clip.edit_config_json?.subtitle_font_size ?? clip.edit_config_json?.subtitle?.font_size
    return typeof fs === 'number' ? clamp(Math.round(fs), 32, 96) : 64
  })

  const [subtitle, setSubtitle] = useState(() => {
    const s = clip.edit_config_json?.subtitle || {}
    const cfgPos = clip.edit_config_json?.subtitle_position
    return {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
      position: cfgPos === 'top' || cfgPos === 'middle' || cfgPos === 'bottom'
        ? cfgPos
        : s.position === 'top' || s.position === 'middle' || s.position === 'bottom'
          ? s.position
          : 'bottom',
      color: typeof s.color === 'string' && HEX.test(s.color) ? s.color.toUpperCase() : '#FFFFFF',
      highlight_color: typeof s.highlight_color === 'string' && HEX.test(s.highlight_color) ? s.highlight_color.toUpperCase() : '#FFE600',
      highlight_keywords: Array.isArray(s.highlight_keywords) ? s.highlight_keywords : [],
      offset_sec: typeof clip.edit_config_json?.subtitle_offset_sec === 'number'
        ? clamp(round2(clip.edit_config_json.subtitle_offset_sec), -2, 2)
        : typeof s.offset_sec === 'number'
          ? clamp(round2(s.offset_sec), -2, 2)
          : 0,
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

  const updateRowText = (id, newText) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, text: newText } : r)))
    setSaveState('idle')
  }

  const [rowErrors, setRowErrors] = useState({})
  const [renderJob, setRenderJob] = useState(null)
  const [renderBusy, setRenderBusy] = useState(false)
  const [renderError, setRenderError] = useState(null)
  const [pollNonce, setPollNonce] = useState(0)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 })

  const [autoEditing, setAutoEditing] = useState(false)
  const [currentClip, setCurrentClip] = useState(clip)

  const videoRef = useRef(null)
  const bgVideoRef = useRef(null)
  const stageRef = useRef(null)
  const timelineTrackRef = useRef(null)
  const isDraggingPlayhead = useRef(false)
  const isDraggingCrop = useRef(false)
  const dragStartCrop = useRef({ startX: 0, initialCrop: 0 })

  const isBlur = layoutMode === 'blur' || layoutMode === 'blur_bg'

  // Trigger Run Auto-Editor Agent (force: true)
  const handleRunAutoEditor = async () => {
    if (autoEditing) return
    setAutoEditing(true)
    try {
      await prepareClip(currentClip.id, { force: true })

      let attempts = 0
      const pollTimer = setInterval(async () => {
        attempts++
        try {
          const projectData = await getProject(currentClip.project_id)
          const updated = projectData?.clips?.find((c) => c.id === currentClip.id)
          if (updated && updated.prepare_status === 'ready') {
            clearInterval(pollTimer)
            setAutoEditing(false)
            setCurrentClip(updated)

            const cfg = updated.edit_config_json || {}
            if (cfg.aspect_ratio && ['9:16', '1:1', '4:3', '16:9'].includes(cfg.aspect_ratio)) {
              setAspectRatio(cfg.aspect_ratio)
            }
            if (cfg.crop_x != null) setCropX(round3(cfg.crop_x))
            if (cfg.layout_mode) setLayoutMode(cfg.layout_mode === 'blur' ? 'blur_bg' : cfg.layout_mode)
            if (cfg.hook_banner) setHookBanner(cfg.hook_banner)
            if (cfg.subtitle_font_size) setSubtitleFontSize(clamp(cfg.subtitle_font_size, 32, 96))
            if (cfg.subtitle) setSubtitle((prev) => ({ ...prev, ...cfg.subtitle }))
            if (Array.isArray(cfg.cuts) && cfg.cuts.length > 0) {
              setCuts(
                cfg.cuts.map((cut) => ({
                  id: nextRowId(),
                  start: clamp(round3(Number(cut.start ?? 0)), 0, duration - 0.1),
                  end: clamp(round3(Number(cut.end ?? duration)), 0.1, duration),
                  active: cut.active !== false,
                })),
              )
            }
            setSaveState('saved')
          }
        } catch { /* continue polling */ }
        if (attempts > 30) {
          clearInterval(pollTimer)
          setAutoEditing(false)
        }
      }, 1500)
    } catch (err) {
      alert(`Gagal menjalankan Auto-Editor: ${err.message}`)
      setAutoEditing(false)
    }
  }

  // 1-Click Presets
  const applyPreset = (presetName) => {
    setSaveState('idle')
    if (presetName === 'hormozi') {
      setLayoutMode('full_crop')
      setHookBanner({ enabled: true, text: (hookBanner.text || clip.title || '').toUpperCase() })
      setSubtitleFontSize(78)
      setSubtitle({
        enabled: true,
        position: 'middle',
        color: '#FFFFFF',
        highlight_color: '#FFE600',
        highlight_keywords: subtitle.highlight_keywords.length > 0 ? subtitle.highlight_keywords : ['RAHASIA', 'PENTING', 'VIRAL'],
        offset_sec: subtitle.offset_sec,
      })
    } else if (presetName === 'podcast') {
      setLayoutMode('blur_bg')
      setHookBanner({ enabled: true, text: (hookBanner.text || clip.title || '').toUpperCase() })
      setSubtitleFontSize(64)
      setSubtitle({
        enabled: true,
        position: 'bottom',
        color: '#FFFFFF',
        highlight_color: '#4ADE80',
        highlight_keywords: subtitle.highlight_keywords,
        offset_sec: subtitle.offset_sec,
      })
    } else if (presetName === 'breaking') {
      setLayoutMode('full_crop')
      setHookBanner({ enabled: true, text: `BREAKING: ${(hookBanner.text || clip.title || '').toUpperCase()}` })
      setSubtitleFontSize(64)
      setSubtitle({
        enabled: true,
        position: 'bottom',
        color: '#FACC15',
        highlight_color: '#EF4444',
        highlight_keywords: subtitle.highlight_keywords,
        offset_sec: subtitle.offset_sec,
      })
    }
  }

  const seekTo = (t) => {
    const v = videoRef.current
    if (!v) return
    const clamped = clamp(t, 0, duration)
    try {
      v.currentTime = clamped
      if (bgVideoRef.current) bgVideoRef.current.currentTime = clamped
    } catch { /* ignore */ }
    setCurrentTime(clamped)
  }

  // Auto-skip inactive segments during playback
  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)

    // Sync background video if blur mode
    if (bgVideoRef.current) {
      if (Math.abs(bgVideoRef.current.currentTime - t) > 0.15) {
        bgVideoRef.current.currentTime = t
      }
      if (bgVideoRef.current.paused !== v.paused) {
        if (v.paused) bgVideoRef.current.pause()
        else bgVideoRef.current.play().catch(() => {})
      }
    }

    const activeCuts = cuts.filter((c) => c.active)
    const inActiveCut = activeCuts.some((c) => t >= c.start && t < c.end)

    if (!inActiveCut && activeCuts.length > 0) {
      const nextCut = activeCuts.find((c) => c.start > t)
      if (nextCut) {
        v.currentTime = nextCut.start
        if (bgVideoRef.current) bgVideoRef.current.currentTime = nextCut.start
        setCurrentTime(nextCut.start)
      } else {
        v.currentTime = activeCuts[0].start
        if (bgVideoRef.current) bgVideoRef.current.currentTime = activeCuts[0].start
        setCurrentTime(activeCuts[0].start)
      }
    }
  }

  const togglePlay = async () => {
    const v = videoRef.current
    if (!v || videoError) return
    if (!v.paused) {
      v.pause()
      if (bgVideoRef.current) bgVideoRef.current.pause()
      return
    }
    const activeCuts = cuts.filter((c) => c.active)
    const inCut = activeCuts.some((c) => v.currentTime >= c.start && v.currentTime < c.end)
    if (!inCut && activeCuts.length > 0) {
      v.currentTime = activeCuts[0].start
      if (bgVideoRef.current) bgVideoRef.current.currentTime = activeCuts[0].start
      setCurrentTime(activeCuts[0].start)
    }
    try {
      await v.play()
      if (bgVideoRef.current) bgVideoRef.current.play().catch(() => {})
    } catch { /* ignore */ }
  }

  // Split segmen di posisi playhead
  const splitAtPlayhead = () => {
    const t = round3(currentTime)
    const targetIdx = cuts.findIndex((c) => t > c.start + 0.25 && t < c.end - 0.25)
    if (targetIdx === -1) return

    const target = cuts[targetIdx]
    const seg1 = { id: nextRowId(), start: target.start, end: t, active: target.active }
    const seg2 = { id: nextRowId(), start: t, end: target.end, active: target.active }

    const nextCuts = [...cuts.slice(0, targetIdx), seg1, seg2, ...cuts.slice(targetIdx + 1)]
    setSelectedCutId(seg2.id)
    pushHistory(nextCuts)
  }

  // Toggle Aktif Segmen
  const toggleCutActive = (id) => {
    const nextCuts = cuts.map((c) => (c.id === id ? { ...c, active: !c.active } : c))
    pushHistory(nextCuts)
  }

  const deleteSelectedCut = () => {
    if (!selectedCutId) return
    toggleCutActive(selectedCutId)
  }

  // Trim handle drag (left / right)
  const handleTrimDrag = (e, cutId, edge) => {
    e.stopPropagation()
    const track = timelineTrackRef.current
    if (!track) return

    const rect = track.getBoundingClientRect()
    const onMove = (moveEvent) => {
      const x = clamp(moveEvent.clientX - rect.left, 0, rect.width)
      const t = round2((x / rect.width) * duration)

      setCuts((prev) =>
        prev.map((c) => {
          if (c.id !== cutId) return c
          if (edge === 'left') {
            const newStart = clamp(t, 0, c.end - 0.2)
            return { ...c, start: newStart }
          } else {
            const newEnd = clamp(t, c.start + 0.2, duration)
            return { ...c, end: newEnd }
          }
        }),
      )
      setSaveState('idle')
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Timeline scrub / click to seek
  const handleTimelineScrub = (e) => {
    const track = timelineTrackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const x = clamp(e.clientX - rect.left, 0, rect.width)
    seekTo((x / rect.width) * duration)
  }

  const handleTimelinePointerDown = (e) => {
    isDraggingPlayhead.current = true
    handleTimelineScrub(e)
    const onMove = (moveEvent) => {
      if (isDraggingPlayhead.current) handleTimelineScrub(moveEvent)
    }
    const onUp = () => {
      isDraggingPlayhead.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Keyboard Shortcuts: Space, S, Delete/Backspace, Ctrl+Z
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      } else if (e.code === 'KeyS') {
        e.preventDefault()
        splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelectedCut()
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cuts, selectedCutId, currentTime, playing])

  // Canvas Resize Observer
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
  }, [aspectRatio])

  // Geometri Canvas Stage berdasarkan aspectRatio dinamis
  const geom = useMemo(() => {
    const sw = stageSize.w
    const sh = stageSize.h
    const vw = videoSize.w || 1920
    const vh = videoSize.h || 1080
    if (!sw || !sh) return null

    const videoAspect = vw / vh
    const stageAspect = sw / sh

    let dispW, dispH, range
    if (videoAspect >= stageAspect) {
      dispH = sh
      dispW = sh * videoAspect
      range = Math.max(0, dispW - sw)
    } else {
      dispW = sw
      dispH = sw / videoAspect
      range = 0
    }

    const frameW = sw
    const frameH = sh

    return { dispW, dispH, frameW, frameH, range, videoAspect, stageAspect }
  }, [stageSize, videoSize, aspectRatio])

  // Drag-to-Pan Crop
  const handlePointerDownCanvas = (e) => {
    if (isBlur || !geom || geom.range <= 0) return
    isDraggingCrop.current = true
    dragStartCrop.current = { startX: e.clientX, initialCrop: cropX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMoveCanvas = (e) => {
    if (!isDraggingCrop.current || !geom?.range) return
    const deltaX = e.clientX - dragStartCrop.current.startX
    const newCrop = clamp(dragStartCrop.current.initialCrop - deltaX / geom.range, 0, 1)
    setCropX(round3(newCrop))
    setSaveState('idle')
  }

  const handlePointerUpCanvas = (e) => {
    isDraggingCrop.current = false
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  }

  // Debounced Auto-Save
  useEffect(() => {
    if (saveState !== 'idle') return
    const timer = setTimeout(() => {
      handleSave()
    }, 1200)
    return () => clearTimeout(timer)
  }, [cuts, cropX, layoutMode, hookBanner, subtitle, subtitleFontSize, rows, aspectRatio, saveState])

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
      .map((c) => ({ start: round3(c.start), end: round3(c.end), active: c.active !== false }))
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
          subtitle_position: subtitle.position,
          subtitle_offset_sec: round2(subtitle.offset_sec ?? 0),
          subtitle_font_size: subtitleFontSize,
          subtitle: {
            enabled: subtitle.enabled,
            position: subtitle.position,
            font_size: subtitleFontSize,
            color: HEX.test(subtitle.color) ? subtitle.color.toUpperCase() : '#FFFFFF',
            highlight_color: HEX.test(subtitle.highlight_color) ? subtitle.highlight_color.toUpperCase() : '#FFE600',
            highlight_keywords: subtitle.highlight_keywords,
            offset_sec: round2(subtitle.offset_sec ?? 0),
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
        const effectiveTime = currentTime - (Number(subtitle.offset_sec) || 0)
        return effectiveTime >= s && effectiveTime < e && String(r.text).trim().length > 0
      })
    : null

  const totalOutputDuration = cuts
    .filter((c) => c.active)
    .reduce((acc, c) => acc + Math.max(0, c.end - c.start), 0)

  const rulerTicks = useMemo(() => {
    const ticks = []
    const step = duration > 60 ? 10 : 5
    for (let t = 0; t <= duration; t += step) {
      ticks.push(t)
    }
    return ticks
  }, [duration])

  // Aspect ratio container styling untuk Canvas Preview
  const stageAspectStyle = useMemo(() => {
    switch (aspectRatio) {
      case '1:1':
        return { aspectRatio: '1 / 1', maxHeight: '500px' }
      case '4:3':
        return { aspectRatio: '4 / 3', maxHeight: '460px' }
      case '16:9':
        return { aspectRatio: '16 / 9', maxHeight: '400px' }
      case '9:16':
      default:
        return { aspectRatio: '9 / 16', maxHeight: '550px' }
    }
  }, [aspectRatio])

  // Proporsional font size preview (lebar frame / 1080 * subtitle_font_size)
  const previewFontPx = useMemo(() => {
    const baseW = stageSize.w || 360
    return clamp(Math.round((baseW / 1080) * subtitleFontSize), 14, 48)
  }, [stageSize.w, subtitleFontSize])

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
              <span>Durasi Asli: {formatTime(duration)}</span>
              <span>·</span>
              <span className="text-accent font-bold">
                Output: {formatTime(totalOutputDuration)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRunAutoEditor}
            disabled={autoEditing}
            className={`${BTN_GHOST} text-accent border-accent/40 hover:bg-accent/10 px-3`}
            title="Jalankan ulang Auto-Editor Agent untuk mencari framing & pacing baru"
          >
            {autoEditing ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                <span>Menganalisis…</span>
              </span>
            ) : (
              '✨ Auto-Edit AI'
            )}
          </button>

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

      {/* Studio Workspace: 2 Kolom (Kiri: Canvas + Timeline CapCut Style, Kanan: Tab Panel) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Kolom Kiri: Canvas + Timeline (lg:col-span-8) */}
        <div className="flex flex-col gap-3 lg:col-span-8">
          {/* Canvas Preview Stage (Dinamis sesuai Aspect Ratio) */}
          <div className="flex w-full items-center justify-center bg-void/60 rounded-2xl border border-line/50 p-2">
            <div
              ref={stageRef}
              style={stageAspectStyle}
              onPointerDown={handlePointerDownCanvas}
              onPointerMove={handlePointerMoveCanvas}
              onPointerUp={handlePointerUpCanvas}
              onPointerCancel={handlePointerUpCanvas}
              className={`relative mx-auto flex w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-void shadow-2xl transition-[aspect-ratio] duration-300 ${
                !isBlur && geom?.range > 0 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              {/* Blur Background Layer */}
              {isBlur && (
                <video
                  ref={bgVideoRef}
                  src={`/api/clips/${clip.id}/video`}
                  playsInline
                  muted
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover scale-110 blur-xl brightness-75"
                />
              )}

              {/* Main Video Layer */}
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
                style={
                  geom && !isBlur && geom.range > 0
                    ? {
                        position: 'absolute',
                        height: '100%',
                        width: 'auto',
                        maxWidth: 'none',
                        left: `${-cropX * geom.range}px`,
                        top: 0,
                      }
                    : {
                        width: '100%',
                        height: '100%',
                        objectFit: isBlur ? 'contain' : 'cover',
                      }
                }
                className={isBlur ? 'relative z-10' : 'relative'}
              />

              {/* Hook Banner Live Preview */}
              {hookBanner.enabled && hookBanner.text && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
                  <span
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 900,
                      fontSize: clamp(Math.round((stageSize.w / 1080) * 54), 13, 26),
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

              {/* Viral Subtitle Live Preview */}
              {activeSub && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4"
                  style={{
                    top: subtitle.position === 'top'
                      ? (hookBanner.enabled ? '22%' : '8%')
                      : subtitle.position === 'middle'
                        ? '50%'
                        : 'auto',
                    bottom: subtitle.position === 'bottom' ? '12%' : 'auto',
                    transform: subtitle.position === 'middle' ? 'translateY(-50%)' : 'none',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'Montserrat', sans-serif",
                      fontWeight: 800,
                      fontSize: `${previewFontPx}px`,
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
          </div>

          {/* Timeline CapCut-Style Container */}
          <div className="rounded-xl border border-line bg-panel/75 p-3.5 shadow-md flex flex-col gap-2.5">
            {/* 1. Toolbar Ringkas Atas Timeline */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={togglePlay}
                  className={`${BTN_PRIMARY} h-7 w-16 text-[11px]`}
                >
                  {playing ? 'Jeda' : 'Putar'}
                </button>
                <button
                  type="button"
                  onClick={splitAtPlayhead}
                  className={`${BTN_GHOST} h-7 text-accent`}
                  title="Bagi video di posisi garis waktu (Shortcut: S)"
                >
                  ✂ Split (S)
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedCut}
                  disabled={!selectedCutId}
                  className={`${BTN_GHOST} h-7 text-fail`}
                  title="Hapus atau pulihkan segmen yang dipilih (Shortcut: Del)"
                >
                  {cuts.find((c) => c.id === selectedCutId)?.active === false ? 'Pulihkan' : 'Hapus'}
                </button>
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={history.length === 0}
                  className={`${BTN_GHOST} h-7`}
                  title="Batalkan perubahan terakhir (Shortcut: Ctrl+Z)"
                >
                  ↶ Undo
                </button>
              </div>

              {/* Time Indicators */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-ink font-semibold">{formatTime(currentTime)}</span>
                <span className="text-faint">/</span>
                <span className="text-faint">{formatTime(duration)}</span>
                <span
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-accent/15 text-accent border border-accent/40"
                  title="Total durasi yang akan diekspor"
                >
                  Durasi: {formatTime(totalOutputDuration)}
                </span>
              </div>
            </div>

            {/* 2. Interactive Timeline Tracks (Ruler, Video Segments with Trim Handles, Subtitle Track) */}
            <div
              ref={timelineTrackRef}
              onPointerDown={handleTimelinePointerDown}
              className="relative select-none cursor-pointer rounded-lg border border-line/80 bg-void/90 py-2 px-1 flex flex-col gap-1.5 overflow-hidden"
              style={{ minHeight: '120px' }}
            >
              {/* Ruler Bar */}
              <div className="relative h-4 w-full border-b border-line/40 text-[9px] font-mono text-faint">
                {rulerTicks.map((t) => (
                  <div
                    key={t}
                    style={{ left: `${(t / duration) * 100}%` }}
                    className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                  >
                    <span>{t}s</span>
                    <span className="h-1 w-px bg-line/80 mt-0.5" />
                  </div>
                ))}
              </div>

              {/* Video Track with Drag-to-Trim & Segment Selection */}
              <div className="relative h-14 w-full bg-panel-2/40 rounded flex items-center">
                {cuts.map((c) => {
                  const leftPct = (c.start / duration) * 100
                  const widthPct = ((c.end - c.start) / duration) * 100
                  const isSelected = selectedCutId === c.id
                  const isCutActive = c.active !== false

                  return (
                    <div
                      key={c.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedCutId(c.id)
                        seekTo(c.start)
                      }}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      className={`group absolute inset-y-1 rounded border flex items-center justify-between transition-colors overflow-hidden ${
                        !isCutActive
                          ? 'border-dashed border-fail/40 bg-fail/10 opacity-60'
                          : isSelected
                            ? 'border-accent bg-accent/30 shadow-[0_0_0_1.5px_#eaa33c]'
                            : 'border-accent/60 bg-accent/20 hover:bg-accent/25'
                      }`}
                    >
                      {/* Left Trim Handle */}
                      {isCutActive && (
                        <div
                          onPointerDown={(e) => handleTrimDrag(e, c.id, 'left')}
                          className="h-full w-2.5 cursor-ew-resize bg-accent/40 hover:bg-accent flex items-center justify-center shrink-0 z-10"
                          title="Tarik untuk trim awal"
                        >
                          <span className="h-3 w-0.5 bg-ink/70 rounded-full" />
                        </div>
                      )}

                      {/* Label Durasi & Status */}
                      <div className="flex-1 min-w-0 px-1.5 text-center font-mono text-[10px] font-bold truncate">
                        <span className={isCutActive ? 'text-accent' : 'text-fail line-through'}>
                          {formatTime(c.end - c.start)}
                        </span>
                        {!isCutActive && (
                          <span className="block text-[8px] text-fail uppercase">Dilewati</span>
                        )}
                      </div>

                      {/* Right Trim Handle */}
                      {isCutActive && (
                        <div
                          onPointerDown={(e) => handleTrimDrag(e, c.id, 'right')}
                          className="h-full w-2.5 cursor-ew-resize bg-accent/40 hover:bg-accent flex items-center justify-center shrink-0 z-10"
                          title="Tarik untuk trim akhir"
                        >
                          <span className="h-3 w-0.5 bg-ink/70 rounded-full" />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Subtitle Mini Track */}
              <div className="relative h-4 w-full bg-panel/30 rounded overflow-hidden">
                {rows.map((r) => {
                  const s = Number(r.start)
                  const e = Number(r.end)
                  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
                  const leftPct = (s / duration) * 100
                  const widthPct = ((e - s) / duration) * 100

                  return (
                    <div
                      key={r.id}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className="absolute inset-y-0.5 rounded-sm bg-accent/50 hover:bg-accent/80 transition"
                      title={r.text}
                    />
                  )
                })}
              </div>

              {/* Draggable Playhead Line with Tooltip */}
              <div
                style={{ left: `${(currentTime / duration) * 100}%` }}
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_white] z-30"
              >
                <div className="absolute -top-1 -left-1.5 h-3 w-3 bg-white rotate-45 rounded-xs" />
              </div>
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
              {/* Agent Notes Banner */}
              {currentClip.edit_config_json?.agent_notes && (() => {
                const notes = currentClip.edit_config_json.agent_notes
                const isFallback = String(notes.framing_reason || '').toLowerCase().includes('fallback')

                return (
                  <div
                    className={`rounded-lg border p-3 text-xs leading-relaxed ${
                      isFallback
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                        : 'border-accent/30 bg-accent/5 text-ink'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider font-bold mb-1.5">
                      <span className={isFallback ? 'text-amber-400' : 'text-accent'}>
                        {isFallback ? '⚠️ Auto-Editor (Fallback Active)' : '✨ Auto-Editor Agent Decision'}
                      </span>
                      <button
                        type="button"
                        onClick={handleRunAutoEditor}
                        disabled={autoEditing}
                        className="underline text-[10px] hover:text-white"
                      >
                        {autoEditing ? 'Analisis…' : 'Coba Ulang'}
                      </button>
                    </div>
                    <p className="text-[11px] leading-snug">
                      <strong>Framing:</strong> {notes.framing_reason}
                    </p>
                    <p className="text-[11px] mt-1 leading-snug opacity-80">
                      <strong>Pacing:</strong> {notes.pacing_reason}
                    </p>
                  </div>
                )
              })()}

              {/* Pilihan Rasio Aspek */}
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                  Rasio Aspek Video
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    ['9:16', '9:16'],
                    ['1:1', '1:1'],
                    ['4:3', '4:3'],
                    ['16:9', '16:9'],
                  ].map(([val, label]) => {
                    const active = aspectRatio === val
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          setAspectRatio(val)
                          setSaveState('idle')
                        }}
                        className={`rounded-lg py-2 text-center text-xs font-mono font-bold transition ${
                          active
                            ? 'border border-accent bg-accent/20 text-accent'
                            : 'border border-line bg-void/50 text-muted hover:border-line-2 hover:bg-panel-2'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Mode Layout (Full Crop vs Blur Background) */}
              <div className="border-t border-line pt-3">
                <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                  Mode Tata Letak
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setLayoutMode('full_crop'); setSaveState('idle'); }}
                    className={`rounded-lg border p-2 text-xs font-medium transition ${
                      layoutMode === 'full_crop'
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-line text-muted hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    Full Crop (Zoom)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLayoutMode('blur_bg'); setSaveState('idle'); }}
                    className={`rounded-lg border p-2 text-xs font-medium transition ${
                      layoutMode === 'blur_bg'
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-line text-muted hover:border-line-2 hover:bg-panel-2'
                    }`}
                  >
                    Blur Background
                  </button>
                </div>
              </div>

              {/* 3 Preset 1-Klik */}
              <div className="border-t border-line pt-3">
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
                  {/* Posisi Subtitle (Atas, Tengah, Bawah) */}
                  <div>
                    <span className="block font-mono text-[10px] text-faint mb-1.5 uppercase tracking-wider">
                      Posisi Subtitle
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        ['top', 'Atas'],
                        ['middle', 'Tengah'],
                        ['bottom', 'Bawah'],
                      ].map(([val, label]) => {
                        const active = subtitle.position === val
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setSubtitle((p) => ({ ...p, position: val }))
                              setSaveState('idle')
                            }}
                            className={`rounded-md py-1.5 text-xs font-medium transition ${
                              active
                                ? 'border border-accent bg-accent/15 text-accent font-bold'
                                : 'border border-line text-muted hover:border-line-2 hover:bg-panel-2'
                            }`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Ukuran Font Subtitle (Presets + Slider 32..96) */}
                  <div className="border-t border-line/60 pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[10px] text-faint uppercase tracking-wider">
                        Ukuran Font ({subtitleFontSize}px)
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mb-2">
                      {[
                        [44, 'Kecil (44)'],
                        [64, 'Sedang (64)'],
                        [78, 'Besar (78)'],
                        [92, 'Jumbo (92)'],
                      ].map(([size, label]) => {
                        const active = subtitleFontSize === size
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => {
                              setSubtitleFontSize(size)
                              setSaveState('idle')
                            }}
                            className={`rounded py-1 text-[11px] font-mono transition ${
                              active
                                ? 'border border-accent bg-accent/20 text-accent font-bold'
                                : 'border border-line bg-void text-muted hover:text-ink'
                            }`}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                    <input
                      type="range"
                      min="32"
                      max="96"
                      step="2"
                      value={subtitleFontSize}
                      onChange={(e) => {
                        setSubtitleFontSize(Number(e.target.value))
                        setSaveState('idle')
                      }}
                      className="w-full accent-accent"
                    />
                  </div>

                  {/* Sync Subtitle Offset (-2.0s s/d +2.0s) */}
                  <div className="border-t border-line/60 pt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[10px] text-faint uppercase tracking-wider">
                        Sync Subtitle (Offset)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSubtitle((p) => ({ ...p, offset_sec: 0 }))
                          setSaveState('idle')
                        }}
                        className="text-[10px] font-mono text-accent hover:underline"
                      >
                        Reset (0.0s)
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="-2"
                        max="2"
                        step="0.05"
                        value={subtitle.offset_sec ?? 0}
                        onChange={(e) => {
                          const val = round2(Number(e.target.value))
                          setSubtitle((p) => ({ ...p, offset_sec: val }))
                          setSaveState('idle')
                        }}
                        className="flex-1 accent-accent"
                      />
                      <span className="font-mono text-xs text-ink w-14 text-right">
                        {(subtitle.offset_sec ?? 0) > 0 ? `+${(subtitle.offset_sec ?? 0).toFixed(2)}s` : `${(subtitle.offset_sec ?? 0).toFixed(2)}s`}
                      </span>
                    </div>
                  </div>

                  {/* Warna Subtitle */}
                  <div className="grid grid-cols-2 gap-2 border-t border-line/60 pt-3">
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

                  {/* Daftar Baris Subtitle Editable (Klik to Seek & Edit Teks) */}
                  <div className="border-t border-line pt-3">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-faint mb-2">
                      Edit Teks Subtitle per Baris Cue ({rows.length} Baris)
                    </p>
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {rows.map((r) => {
                        const s = Number(r.start)
                        const e = Number(r.end)
                        const effectiveTime = currentTime - (Number(subtitle.offset_sec) || 0)
                        const isActiveRow = effectiveTime >= s && effectiveTime < e

                        return (
                          <div
                            key={r.id}
                            className={`flex items-center gap-2 rounded-lg border p-1.5 transition ${
                              isActiveRow
                                ? 'border-accent bg-accent/15'
                                : 'border-line/70 bg-void/50 hover:border-line'
                            }`}
                          >
                            {/* Tombol Waktu (Klik to Seek) */}
                            <button
                              type="button"
                              onClick={() => seekTo(s)}
                              className="shrink-0 rounded bg-panel px-1.5 py-1 font-mono text-[10px] text-accent hover:bg-accent hover:text-void font-bold transition"
                              title="Lompat ke detik ini"
                            >
                              {formatTime(s)}
                            </button>

                            {/* Input Teks Langsung */}
                            <input
                              type="text"
                              value={r.text}
                              onChange={(e) => updateRowText(r.id, e.target.value)}
                              placeholder="Teks subtitle..."
                              className="flex-1 min-w-0 bg-transparent text-xs text-ink outline-none border-b border-transparent focus:border-accent font-sans"
                            />
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
                    <span>Rasio Aspek</span>
                    <span className="text-accent font-bold">{aspectRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tata Letak</span>
                    <span className="text-ink">{isBlur ? 'Blur Background' : 'Full Crop'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Audio Target</span>
                    <span className="text-ink">-14 LUFS Broadcast</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Durasi</span>
                    <span className="text-accent font-bold">
                      {formatTime(totalOutputDuration)}
                    </span>
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
                    className={`${BTN_PRIMARY} w-full py-2 text-center text-sm font-bold`}
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
