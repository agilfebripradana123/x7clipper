import { useEffect, useMemo, useRef, useState } from 'react'
import { getProject, getRenderJob, patchClipConfig, prepareClip, renderClip, regenerateCaption } from '../api'

const FONT_OPTIONS = [
  { key: 'montserrat', label: 'Montserrat', family: "'Montserrat ExtraBold', 'Montserrat', sans-serif" },
  { key: 'poppins', label: 'Poppins', family: "'Poppins Black', 'Poppins', sans-serif" },
  { key: 'anton', label: 'Anton', family: "'Anton', sans-serif" },
  { key: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', sans-serif" },
  { key: 'oswald', label: 'Oswald', family: "'Oswald', sans-serif" },
  { key: 'jakarta', label: 'Jakarta Sans', family: "'Plus Jakarta Sans ExtraBold', 'Plus Jakarta Sans', sans-serif" },
]

function getFontFamily(fontKey, fallback = "'Montserrat ExtraBold', sans-serif") {
  const found = FONT_OPTIONS.find((f) => f.key === fontKey)
  return found ? found.family : fallback
}

export function splitViralSubtitlesPreview(subtitles, { maxWordsPerLine = 3 } = {}) {
  if (!Array.isArray(subtitles)) return []
  const maxWords = Math.max(1, Math.min(6, Number(maxWordsPerLine) || 3))
  const result = []

  for (const item of subtitles) {
    const rawText = String(item.text ?? '').trim()
    const duration = item.end - item.start

    if (!rawText || duration <= 0) continue

    const words = rawText.split(/\s+/).filter(Boolean)
    if (words.length <= maxWords) {
      result.push({
        start: round3(item.start),
        end: round3(item.end),
        text: rawText,
      })
      continue
    }

    const chunks = []
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(' '))
    }

    const totalChars = chunks.reduce((acc, c) => acc + c.length, 0)
    let currentStart = item.start

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const isLast = i === chunks.length - 1
      const chunkDur = isLast
        ? item.end - currentStart
        : duration * (chunk.length / totalChars)

      const chunkEnd = isLast ? item.end : round3(currentStart + chunkDur)

      result.push({
        start: round3(currentStart),
        end: round3(chunkEnd),
        text: chunk,
      })

      currentStart = chunkEnd
    }
  }

  return result
}

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
    const text = String(r.text ?? '').trim()
    // Baris dengan teks kosong tidak dianggap error fatal (akan difilter saat save)
    if (!text) continue

    const s = Number(r.start)
    const e = Number(r.end)
    if (!Number.isFinite(s) || s < 0) errors[r.id] = 'Waktu awal tidak valid.'
    else if (!Number.isFinite(e) || e < s) errors[r.id] = 'Waktu akhir harus lebih besar atau sama dengan awal.'
    else if (e > duration + 1.0) errors[r.id] = 'Waktu akhir melebihi durasi klip.'
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

  // Dimensi virtual canvas 1:1 identik dengan FFmpeg PlayRes
  const virtualDims = useMemo(() => {
    switch (aspectRatio) {
      case '1:1':
        return { w: 1080, h: 1080 }
      case '4:3':
        return { w: 1440, h: 1080 }
      case '16:9':
        return { w: 1920, h: 1080 }
      case '9:16':
      default:
        return { w: 1080, h: 1920 }
    }
  }, [aspectRatio])

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

  const [hookFont, setHookFont] = useState(
    clip.edit_config_json?.hook_font || 'anton',
  )
  const [subtitleFont, setSubtitleFont] = useState(
    clip.edit_config_json?.subtitle_font || 'montserrat',
  )

  const [caption, setCaption] = useState(clip.suggested_caption || '')
  const [captionCopied, setCaptionCopied] = useState(false)
  const [regeneratingCaption, setRegeneratingCaption] = useState(false)
  const [captionError, setCaptionError] = useState(null)

  const handleRegenerateCaption = async () => {
    if (regeneratingCaption) return
    setRegeneratingCaption(true)
    setCaptionError(null)
    try {
      const data = await regenerateCaption(currentClip.id)
      if (data?.suggested_caption) {
        setCaption(data.suggested_caption)
        setCurrentClip((prev) => ({ ...prev, suggested_caption: data.suggested_caption }))
        setSaveState('saved')
      }
    } catch (err) {
      setCaptionError(err?.body?.message || err?.message || 'Gagal terhubung ke 9router.')
    } finally {
      setRegeneratingCaption(false)
    }
  }

  const handleCopyCaption = async () => {
    if (!caption) return
    try {
      await navigator.clipboard.writeText(caption)
      setCaptionCopied(true)
      setTimeout(() => setCaptionCopied(false), 2000)
    } catch {
      alert('Gagal menyalin caption.')
    }
  }

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
  const [renderJob, setRenderJob] = useState(clip.latest_render_job || null)
  const [previewMode, setPreviewMode] = useState('live') // 'live' | 'mp4'
  const [renderBusy, setRenderBusy] = useState(false)
  const [renderError, setRenderError] = useState(null)
  const [pollNonce, setPollNonce] = useState(0)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 })
  const [agentNotesOpen, setAgentNotesOpen] = useState(false)

  // Target aspect ratio float: 9/16, 1/1, 4/3, 16/9
  const targetRatio = useMemo(() => {
    switch (aspectRatio) {
      case '1:1':
        return 1
      case '4:3':
        return 4 / 3
      case '16:9':
        return 16 / 9
      case '9:16':
      default:
        return 9 / 16
    }
  }, [aspectRatio])

  // Dimensi piksel bingkai preview presisi terhadap luas stage
  const { boxW, boxH } = useMemo(() => {
    const sw = stageSize.w
    const sh = stageSize.h
    if (!sw || !sh) {
      return { boxW: 300, boxH: Math.round(300 / targetRatio) }
    }
    const availW = Math.max(160, sw - 32)
    const availH = Math.max(160, sh - 32)

    if (availW / availH > targetRatio) {
      const h = availH
      const w = Math.round(h * targetRatio)
      return { boxW: w, boxH: h }
    } else {
      const w = availW
      const h = Math.round(w / targetRatio)
      return { boxW: w, boxH: h }
    }
  }, [stageSize.w, stageSize.h, targetRatio])

  // Scale factor kanvas virtual ke kotak preview
  const stageScale = useMemo(() => {
    if (!boxW || !virtualDims.w) return 1
    return boxW / virtualDims.w
  }, [boxW, virtualDims.w])

  const [autoEditing, setAutoEditing] = useState(false)
  const [currentClip, setCurrentClip] = useState(clip)
  const [isBuffering, setIsBuffering] = useState(false)

  const videoRef = useRef(null)
  const mp4VideoRef = useRef(null)
  const canvasRef = useRef(null)
  const stageRef = useRef(null)
  const timelineTrackRef = useRef(null)
  const isDraggingPlayhead = useRef(false)
  const isDraggingCrop = useRef(false)
  const isSeekingRef = useRef(false)
  const abortControllerRef = useRef(null)
  const dragStartCrop = useRef({ startX: 0, initialCrop: 0 })

  const isBlur = layoutMode === 'blur' || layoutMode === 'blur_bg'

  const drawBlurFrame = () => {
    if (!isBlur || !canvasRef.current || !videoRef.current) return
    const v = videoRef.current
    if (v.readyState < 2) return
    const ctx = canvasRef.current.getContext('2d')
    if (ctx) {
      try {
        ctx.drawImage(v, 0, 0, canvasRef.current.width, canvasRef.current.height)
      } catch {
        /* ignore decode errors */
      }
    }
  }

  // Gambar blur background saat komponen siap atau saat pause / seek / loaded
  useEffect(() => {
    if (!isBlur) return
    drawBlurFrame()
  }, [isBlur, videoSize, currentTime])

  useEffect(() => {
    if (!isBlur || !playing) return
    let animId
    const loop = () => {
      drawBlurFrame()
      animId = requestAnimationFrame(loop)
    }
    animId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animId)
  }, [isBlur, playing])

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
            if (cfg.hook_font) setHookFont(cfg.hook_font)
            if (cfg.subtitle_font) setSubtitleFont(cfg.subtitle_font)
            if (updated.suggested_caption) setCaption(updated.suggested_caption)
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
      setHookFont('anton')
      setSubtitleFont('montserrat')
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
      setHookFont('oswald')
      setSubtitleFont('poppins')
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
      setHookFont('bebas')
      setSubtitleFont('jakarta')
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
    isSeekingRef.current = true
    try {
      v.currentTime = clamped
    } catch { /* ignore */ }
    setCurrentTime(clamped)
  }

  // Auto-skip inactive segments during playback with isSeekingRef guard
  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v) return
    const t = v.currentTime
    setCurrentTime(t)
    drawBlurFrame()

    if (isSeekingRef.current || v.seeking || isBuffering) return

    const activeCuts = cuts.filter((c) => c.active)
    const inActiveCut = activeCuts.some((c) => t >= c.start && t < c.end)

    if (!inActiveCut && activeCuts.length > 0) {
      const nextCut = activeCuts.find((c) => c.start > t)
      const targetSec = nextCut ? nextCut.start : activeCuts[0].start
      isSeekingRef.current = true
      try {
        v.currentTime = targetSec
      } catch { /* ignore */ }
      setCurrentTime(targetSec)
    }
  }

  const togglePlay = async () => {
    const v = videoRef.current
    if (!v || videoError) return
    if (!v.paused) {
      v.pause()
      return
    }
    const activeCuts = cuts.filter((c) => c.active)
    const inCut = activeCuts.some((c) => v.currentTime >= c.start && v.currentTime < c.end)
    if (!inCut && activeCuts.length > 0) {
      isSeekingRef.current = true
      v.currentTime = activeCuts[0].start
      setCurrentTime(activeCuts[0].start)
    }
    try {
      await v.play()
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

  // Geometri Canvas Stage berdasarkan aspectRatio dan virtualDims (1080p target FFmpeg)
  const geom = useMemo(() => {
    const sw = stageSize.w
    const sh = stageSize.h
    const vw = videoSize.w || 1920
    const vh = videoSize.h || 1080
    if (!sw || !sh || !virtualDims.w || !virtualDims.h) return null

    const videoAspect = vw / vh
    const targetAspect = virtualDims.w / virtualDims.h

    // Pada kanvas virtual (virtualDims.w x virtualDims.h):
    let dispW, dispH, range
    if (videoAspect >= targetAspect) {
      dispH = virtualDims.h
      dispW = virtualDims.h * videoAspect
      range = Math.max(0, dispW - virtualDims.w)
    } else {
      dispW = virtualDims.w
      dispH = virtualDims.w / videoAspect
      range = 0
    }

    return { dispW, dispH, range, videoAspect, targetAspect }
  }, [stageSize, videoSize, virtualDims])

  // Drag-to-Pan Crop (diukur terhadap ukuran riil di layar)
  const handlePointerDownCanvas = (e) => {
    if (isBlur || !geom || geom.range <= 0) return
    isDraggingCrop.current = true
    dragStartCrop.current = { startX: e.clientX, initialCrop: cropX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMoveCanvas = (e) => {
    if (!isDraggingCrop.current || !geom?.range || !stageScale) return
    const screenRange = geom.range * stageScale
    if (screenRange <= 0) return
    const deltaX = e.clientX - dragStartCrop.current.startX
    const newCrop = clamp(dragStartCrop.current.initialCrop - deltaX / screenRange, 0, 1)
    setCropX(round3(newCrop))
    setSaveState('idle')
  }

  const handlePointerUpCanvas = (e) => {
    isDraggingCrop.current = false
    try { e.currentTarget.releasePointerCapture?.(e.pointerId) } catch { /* ignore */ }
  }

  // Debounced Auto-Save (800ms)
  useEffect(() => {
    if (saveState !== 'idle') return
    const timer = setTimeout(() => {
      handleSave()
    }, 800)
    return () => clearTimeout(timer)
  }, [cuts, cropX, layoutMode, hookBanner, hookFont, subtitleFont, caption, subtitle, subtitleFontSize, rows, aspectRatio, saveState])

  const handleSave = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    const errors = validateRows(rows, duration)
    if (Object.keys(errors).length > 0) {
      setRowErrors(errors)
      setSaveError('422: Periksa baris subtitle yang ditandai.')
      setSaveState('error')
      return
    }

    const sortedSubs = rows
      .map((cue, idx) => {
        const text = String(cue.text ?? '').trim()
        const rawStart = Number(cue.start)
        const rawEnd = Number(cue.end)
        const s = clamp(round3(Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0), 0, duration)
        let e = clamp(round3(Number.isFinite(rawEnd) ? Math.max(0, rawEnd) : 0), 0, duration + 0.5)

        if (e <= s) {
          e = round3(s + 0.05)
        }

        return {
          id: String(cue.id ?? idx + 1),
          start: s,
          end: e,
          text,
        }
      })
      .filter((r) => r.text.length > 0 && r.end >= r.start)
      .sort((a, b) => a.start - b.start)

    const sortedCuts = cuts
      .map((c) => ({
        start: clamp(round3(Number(c.start ?? 0)), 0, duration),
        end: clamp(round3(Number(c.end ?? duration)), 0, duration),
        active: c.active !== false,
      }))
      .filter((c) => c.end > c.start)
      .sort((a, b) => a.start - b.start)

    const safeCuts = sortedCuts.length > 0 ? sortedCuts : [{ start: 0, end: duration, active: true }]
    const safeCropX = clamp(round3(Number(cropX) || 0.5), 0, 1)
    const safeOffset = clamp(round2(Number(subtitle.offset_sec) || 0), -2, 2)
    const safeFontSize = clamp(Math.round(Number(subtitleFontSize)) || 64, 32, 96)

    setSaveState('saving')
    setSaveError(null)

    try {
      await patchClipConfig(
        clip.id,
        {
          edit_config: {
            aspect_ratio: ['9:16', '1:1', '4:3', '16:9'].includes(aspectRatio) ? aspectRatio : '9:16',
            crop_x: safeCropX,
            layout_mode: layoutMode,
            hook_banner: {
              enabled: Boolean(hookBanner.enabled),
              text: String(hookBanner.text || '').trim(),
            },
            hook_font: hookFont,
            subtitle_font: subtitleFont,
            cuts: safeCuts,
            subtitle_position: subtitle.position,
            subtitle_offset_sec: safeOffset,
            subtitle_font_size: safeFontSize,
            subtitle: {
              enabled: Boolean(subtitle.enabled),
              position: subtitle.position,
              font_size: safeFontSize,
              color: HEX.test(subtitle.color) ? subtitle.color.toUpperCase() : '#FFFFFF',
              highlight_color: HEX.test(subtitle.highlight_color) ? subtitle.highlight_color.toUpperCase() : '#FFE600',
              highlight_keywords: subtitle.highlight_keywords,
              offset_sec: safeOffset,
            },
          },
          suggested_caption: caption,
          subtitles: sortedSubs,
        },
        { signal: controller.signal },
      )
      setSaveState('saved')
    } catch (err) {
      if (err?.name === 'AbortError') return
      const status = err?.status ? `${err.status}` : ''
      const firstValidationErr = err?.body?.errors
        ? Object.values(err.body.errors).flat()[0]
        : null
      const msg = firstValidationErr || err?.message || 'Gagal menyimpan'
      setSaveError(status ? `${status}: ${msg}` : msg)
      setSaveState('error')
    }
  }

  const handleRender = async () => {
    if (renderBusy) return
    setRenderBusy(true)
    setRenderError(null)
    try {
      if (saveState !== 'saved') {
        await handleSave()
      }
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

  // Subtitle chunking 2-3 kata per baris identik dengan splitViralSubtitles di worker
  const activeViralSub = useMemo(() => {
    if (!subtitle.enabled) return null
    const effectiveTime = currentTime - (Number(subtitle.offset_sec) || 0)
    const validRows = rows
      .filter((r) => String(r.text ?? '').trim().length > 0)
      .map((r) => ({
        start: Number(r.start) || 0,
        end: Number(r.end) || 0,
        text: String(r.text ?? '').trim(),
      }))
      .filter((r) => r.end > r.start)

    const chunks = splitViralSubtitlesPreview(validRows, { maxWordsPerLine: 3 })
    return chunks.find((c) => effectiveTime >= c.start && effectiveTime < c.end) || null
  }, [subtitle.enabled, subtitle.offset_sec, currentTime, rows])

  // Perhitungan layout margin vertical identik dengan subtitleLayout di subtitleShift.js
  const subtitleVirtualMarginV = useMemo(() => {
    const scale = virtualDims.h / 1920
    if (subtitle.position === 'middle') return 0
    if (subtitle.position === 'top') {
      const raw = hookBanner.enabled && hookBanner.text ? 340 : 160
      return Math.round(raw * scale)
    }
    return Math.round(240 * scale)
  }, [subtitle.position, hookBanner.enabled, hookBanner.text, virtualDims.h])

  const bannerVirtualMarginV = useMemo(() => {
    const scale = virtualDims.h / 1920
    return Math.round(120 * scale)
  }, [virtualDims.h])

  const bannerVirtualFontSize = useMemo(() => {
    const scale = virtualDims.w / 1080
    return Math.round(56 * scale)
  }, [virtualDims.w])

  const subtitleVirtualFontSize = useMemo(() => {
    const scale = virtualDims.w / 1080
    return Math.round(scale * subtitleFontSize)
  }, [virtualDims.w, subtitleFontSize])

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

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-void text-ink select-none">
      {/* 1. Top Header Bar (h-14) */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 z-40">
        {/* Kiri: Tombol Kembali, Judul Klip & Badge Rasio */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800 transition"
          >
            ← Kembali
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="truncate text-xs sm:text-sm font-semibold text-zinc-100 max-w-[200px] sm:max-w-xs md:max-w-md" title={clip.title}>
              {clip.title}
            </h2>
            <span className="shrink-0 rounded-md border border-zinc-700/80 bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
              {aspectRatio} • {virtualDims.w}×{virtualDims.h}
            </span>
          </div>
        </div>

        {/* Kanan: Pill Auto-Save, Auto-Edit AI & Export MP4 */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span
              title={saveError || ''}
              className={`max-w-[140px] truncate ${
                saveState === 'saved'
                  ? 'text-ok'
                  : saveState === 'saving'
                    ? 'text-accent'
                    : saveState === 'error'
                      ? 'text-fail'
                      : 'text-zinc-500'
              }`}
            >
              {saveState === 'saved'
                ? '● Tersimpan'
                : saveState === 'saving'
                  ? '● Menyimpan…'
                  : saveState === 'error'
                    ? `● Gagal`
                    : '● Belum simpan'}
            </span>
            {saveState === 'error' && (
              <button
                type="button"
                onClick={handleSave}
                className="rounded border border-fail/40 bg-fail/10 px-1.5 py-0.5 text-[10px] text-fail hover:bg-fail/20"
              >
                Coba Lagi
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleRunAutoEditor}
            disabled={autoEditing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent hover:bg-accent/20 transition disabled:opacity-50"
            title="Jalankan ulang Auto-Editor Agent untuk mencari framing & pacing baru"
          >
            {autoEditing ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                <span className="hidden sm:inline">Menganalisis…</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span className="hidden sm:inline">Auto-Edit AI</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-accent px-3.5 text-xs font-bold text-void hover:bg-accent-2 shadow-sm transition"
          >
            Export MP4
          </button>
        </div>
      </header>

      {/* 2. Area Utama (2 Kolom: Kiri Studio & Timeline, Kanan Tab Settings) */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Kolom Kiri: Studio Stage + Timeline Multi-Cut */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* A. Studio Stage: Background Grid Halus & Bingkai Preview Presisi */}
          <div
            ref={stageRef}
            className="flex-1 flex flex-col items-center justify-center bg-[#09090b] relative overflow-hidden p-4 select-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          >
            {/* Toggle Preview Editan vs Hasil Render MP4 */}
            {renderJob?.status === 'done' && (
              <div className="absolute top-3 z-30 flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-1 text-xs shadow-lg backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setPreviewMode('live')}
                  className={`rounded px-2.5 py-1 font-medium transition ${
                    previewMode === 'live'
                      ? 'bg-accent text-void font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  Live Preview Editan
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('mp4')}
                  className={`rounded px-2.5 py-1 font-medium transition ${
                    previewMode === 'mp4'
                      ? 'bg-accent text-void font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  Hasil Render MP4
                </button>
              </div>
            )}

            {/* Kotak Bingkai Preview Presisi */}
            <div
              style={{
                width: `${boxW}px`,
                height: `${boxH}px`,
              }}
              onPointerDown={handlePointerDownCanvas}
              onPointerMove={handlePointerMoveCanvas}
              onPointerUp={handlePointerUpCanvas}
              onPointerCancel={handlePointerUpCanvas}
              className={`relative overflow-hidden rounded-xl border border-zinc-700/80 bg-black shadow-2xl transition-[width,height] duration-200 ${
                previewMode === 'live' && !isBlur && geom?.range > 0 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              {/* Mode MP4 Render Player */}
              {previewMode === 'mp4' && renderJob?.status === 'done' ? (
                <div className="relative h-full w-full bg-black flex items-center justify-center">
                  <video
                    ref={mp4VideoRef}
                    src={`/api/render-jobs/${renderJob.id}/download`}
                    controls
                    autoPlay
                    playsInline
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                /* Virtual Resolution Canvas (Skala 1:1 dengan FFmpeg PlayRes) */
                <div
                  style={{
                    width: `${virtualDims.w}px`,
                    height: `${virtualDims.h}px`,
                    transform: `scale(${stageScale})`,
                    transformOrigin: 'top left',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    overflow: 'hidden',
                  }}
                  className="bg-black select-none"
                >
                  {/* Blur Background Layer (Single-Stream Snapshot scaled & blurred) */}
                  {isBlur && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                      <canvas
                        ref={canvasRef}
                        width={270}
                        height={480}
                        aria-hidden="true"
                        style={{
                          transform: 'scale(1.18)',
                          filter: 'blur(32px) brightness(0.75)',
                        }}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}

                  {/* Main Video Layer */}
                  <video
                    ref={videoRef}
                    src={`/api/clips/${clip.id}/video`}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
                      setReady(true)
                      drawBlurFrame()
                    }}
                    onLoadedData={drawBlurFrame}
                    onCanPlay={drawBlurFrame}
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      setPlaying(false)
                      drawBlurFrame()
                    }}
                    onSeeking={() => {
                      isSeekingRef.current = true
                    }}
                    onSeeked={() => {
                      isSeekingRef.current = false
                      setIsBuffering(false)
                      drawBlurFrame()
                    }}
                    onWaiting={() => setIsBuffering(true)}
                    onStalled={() => setIsBuffering(true)}
                    onPlaying={() => {
                      isSeekingRef.current = false
                      setIsBuffering(false)
                      setPlaying(true)
                    }}
                    onError={() => {
                      setVideoError(true)
                      setIsBuffering(false)
                    }}
                    style={
                      geom && !isBlur && geom.range > 0
                        ? {
                            position: 'absolute',
                            height: '100%',
                            width: `${geom.dispW}px`,
                            maxWidth: 'none',
                            left: `${-cropX * geom.range}px`,
                            top: 0,
                            objectFit: 'cover',
                          }
                        : {
                            width: '100%',
                            height: '100%',
                            objectFit: isBlur ? 'contain' : 'cover',
                          }
                    }
                    className={isBlur ? 'relative z-10' : 'relative'}
                  />

                  {/* Indikator Buffering Halus */}
                  {isBuffering && !videoError && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                      <div className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/90 px-4 py-2 shadow-xl">
                        <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent/40 border-t-accent" />
                        <span className="font-mono text-sm text-zinc-100">Memuat stream video…</span>
                      </div>
                    </div>
                  )}

                  {/* Hook Banner Live Preview (Identik Style: Banner di FFmpeg) */}
                  {hookBanner.enabled && hookBanner.text && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
                      style={{
                        top: `${bannerVirtualMarginV}px`,
                        paddingLeft: `${Math.round(40 * (virtualDims.w / 1080))}px`,
                        paddingRight: `${Math.round(40 * (virtualDims.w / 1080))}px`,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: getFontFamily(hookFont, "'Anton', sans-serif"),
                          fontWeight: 900,
                          fontSize: `${bannerVirtualFontSize}px`,
                          color: '#FFFFFF',
                          textTransform: 'uppercase',
                          textAlign: 'center',
                          lineHeight: 1.15,
                          letterSpacing: '0px',
                          maxWidth: '100%',
                          wordBreak: 'break-word',
                          paintOrder: 'stroke fill',
                          WebkitTextStroke: `${Math.round(4 * (virtualDims.w / 1080))}px #000000`,
                          textShadow: '0 0 4px #000, 2px 2px 4px rgba(0,0,0,0.85)',
                        }}
                      >
                        {hookBanner.text}
                      </span>
                    </div>
                  )}

                  {/* Viral Subtitle Live Preview (Identik Style: Default di FFmpeg) */}
                  {activeViralSub && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
                      style={{
                        top: subtitle.position === 'top'
                          ? `${subtitleVirtualMarginV}px`
                          : subtitle.position === 'middle'
                            ? '50%'
                            : 'auto',
                        bottom: subtitle.position === 'bottom' ? `${subtitleVirtualMarginV}px` : 'auto',
                        transform: subtitle.position === 'middle' ? 'translateY(-50%)' : 'none',
                        paddingLeft: `${Math.round(40 * (virtualDims.w / 1080))}px`,
                        paddingRight: `${Math.round(40 * (virtualDims.w / 1080))}px`,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: getFontFamily(subtitleFont, "'Montserrat ExtraBold', sans-serif"),
                          fontWeight: 800,
                          fontSize: `${subtitleVirtualFontSize}px`,
                          textAlign: 'center',
                          lineHeight: 1.15,
                          letterSpacing: '0px',
                          textTransform: 'uppercase',
                          maxWidth: '100%',
                          wordBreak: 'break-word',
                          paintOrder: 'stroke fill',
                          WebkitTextStroke: `${Math.round(6 * (virtualDims.w / 1080))}px #000000`,
                          textShadow: '0 0 4px #000, 2px 2px 4px rgba(0,0,0,0.85)',
                        }}
                      >
                        {activeViralSub.text.split(/\s+/).map((word, wIdx) => {
                          const clean = word.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
                          const isKeyword = (subtitle.highlight_keywords || [])
                            .map((k) => String(k).toUpperCase())
                            .includes(clean)
                          return (
                            <span
                              key={wIdx}
                              style={{
                                color: isKeyword ? subtitle.highlight_color : subtitle.color,
                                marginRight: '0.3em',
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
              )}
            </div>
          </div>

          {/* B. Timeline Multi-Cut Bawah (Tinggi h-44, Toolbar Ringkas & Ruler) */}
          <div className="h-44 shrink-0 border-t border-zinc-800 bg-zinc-950 p-3 flex flex-col justify-between">
            {/* 1. Toolbar Ringkas Atas Timeline */}
            <div className="flex flex-wrap items-center justify-between gap-2">
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
                <span className="text-zinc-100 font-semibold">{formatTime(currentTime)}</span>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-500">{formatTime(duration)}</span>
                <span
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-accent/15 text-accent border border-accent/40"
                  title="Total durasi yang akan diekspor"
                >
                  Durasi Final: {formatTime(totalOutputDuration)}
                </span>
              </div>
            </div>

            {/* 2. Interactive Timeline Tracks (Ruler, Video Segments with Trim Handles, Subtitle Track) */}
            <div
              ref={timelineTrackRef}
              onPointerDown={handleTimelinePointerDown}
              className="relative select-none cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/90 py-1 px-1 flex flex-col gap-1 overflow-hidden h-28"
            >
              {/* Ruler Bar */}
              <div className="relative h-4 w-full border-b border-zinc-800 text-[9px] font-mono text-zinc-500">
                {rulerTicks.map((t) => (
                  <div
                    key={t}
                    style={{ left: `${(t / duration) * 100}%` }}
                    className="absolute top-0 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                  >
                    <span>{t}s</span>
                    <span className="h-1 w-px bg-zinc-700 mt-0.5" />
                  </div>
                ))}
              </div>

              {/* Video Track with Drag-to-Trim & Segment Selection */}
              <div className="relative h-14 w-full bg-zinc-950/60 rounded flex items-center">
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
                      <div className="flex-1 min-w-0 px-1 text-center font-mono text-[10px] font-bold truncate">
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
              <div className="relative h-3 w-full bg-zinc-950/40 rounded overflow-hidden">
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

        {/* Kolom Kanan: 3 Tab Panel (Lebar Tetap w-[390px], Scrollable) */}
        <aside className="w-[390px] shrink-0 border-l border-zinc-800 bg-zinc-900/95 flex flex-col h-full overflow-hidden">
          {/* Tab Navigation Header */}
          <div className="grid grid-cols-3 gap-1 border-b border-zinc-800 p-2 bg-zinc-950/60 shrink-0">
            {[
              ['style', 'Gaya & Hook'],
              ['subtitle', 'Subtitle'],
              ['export', 'Export & Caption'],
            ].map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`rounded-lg py-2 text-xs font-medium transition ${
                  activeTab === tabId
                    ? 'bg-accent text-void font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Konten Tab Scrollable */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Tab 1: Gaya & Hook */}
            {activeTab === 'style' && (
              <div className="space-y-4">
                {/* Agent Notes Banner (Ringkas & Collapsible) */}
                {currentClip.edit_config_json?.agent_notes && (() => {
                  const notes = currentClip.edit_config_json.agent_notes
                  const isFallback = String(notes.framing_reason || '').toLowerCase().includes('fallback')

                  return (
                    <div
                      className={`rounded-lg border text-xs leading-relaxed overflow-hidden ${
                        isFallback
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                          : 'border-accent/30 bg-accent/5 text-zinc-200'
                      }`}
                    >
                      <div
                        onClick={() => setAgentNotesOpen((prev) => !prev)}
                        className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider font-bold p-2.5 cursor-pointer hover:bg-white/5 transition"
                      >
                        <span className={isFallback ? 'text-amber-400' : 'text-accent'}>
                          {isFallback ? '⚠️ Auto-Editor (Fallback)' : '✨ Auto-Editor Decision'}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRunAutoEditor()
                            }}
                            disabled={autoEditing}
                            className="underline text-[10px] hover:text-white"
                          >
                            {autoEditing ? 'Analisis…' : 'Coba Ulang'}
                          </button>
                          <span>{agentNotesOpen ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {agentNotesOpen && (
                        <div className="p-2.5 pt-0 border-t border-white/5 space-y-1">
                          <p className="text-[11px] leading-snug">
                            <strong className="text-zinc-100">Framing:</strong> {notes.framing_reason}
                          </p>
                          <p className="text-[11px] leading-snug opacity-80">
                            <strong className="text-zinc-100">Pacing:</strong> {notes.pacing_reason}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Pilihan Rasio Aspek */}
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
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
                              ? 'border border-accent bg-accent/20 text-accent shadow-sm'
                              : 'border border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Mode Layout (Full Crop vs Blur Background) */}
                <div className="border-t border-zinc-800/80 pt-3">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
                    Mode Tata Letak
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setLayoutMode('full_crop'); setSaveState('idle'); }}
                      className={`rounded-lg border p-2 text-xs font-medium transition ${
                        layoutMode === 'full_crop'
                          ? 'border-accent bg-accent/15 text-accent font-bold'
                          : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800'
                      }`}
                    >
                      Full Crop (Zoom)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLayoutMode('blur_bg'); setSaveState('idle'); }}
                      className={`rounded-lg border p-2 text-xs font-medium transition ${
                        layoutMode === 'blur_bg'
                          ? 'border-accent bg-accent/15 text-accent font-bold'
                          : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800'
                      }`}
                    >
                      Blur Background
                    </button>
                  </div>
                </div>

                {/* 3 Preset 1-Klik */}
                <div className="border-t border-zinc-800/80 pt-3">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
                    Preset Cepat 1-Klik
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => applyPreset('hormozi')}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-center hover:border-accent hover:bg-zinc-800 transition"
                    >
                      <span className="block text-xs font-bold text-accent">Hormozi</span>
                      <span className="text-[10px] text-zinc-500">Full Crop + Bold</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('podcast')}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-center hover:border-accent hover:bg-zinc-800 transition"
                    >
                      <span className="block text-xs font-bold text-ok">Podcast</span>
                      <span className="text-[10px] text-zinc-500">Blur BG + Clean</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset('breaking')}
                      className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 text-center hover:border-accent hover:bg-zinc-800 transition"
                    >
                      <span className="block text-xs font-bold text-fail">Breaking</span>
                      <span className="text-[10px] text-zinc-500">News Punch</span>
                    </button>
                  </div>
                </div>

                {/* Hook Banner Input & Font 2 Kolom */}
                <div className="border-t border-zinc-800/80 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                      Hook Banner Teks
                    </p>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hookBanner.enabled}
                        onChange={(e) => {
                          setHookBanner((prev) => ({ ...prev, enabled: e.target.checked }))
                          setSaveState('idle')
                        }}
                        className="rounded border-zinc-700"
                        style={{ accentColor: '#eaa33c' }}
                      />
                      Tampilkan
                    </label>
                  </div>
                  {hookBanner.enabled && (
                    <div className="space-y-2.5">
                      <input
                        type="text"
                        value={hookBanner.text}
                        onChange={(e) => {
                          setHookBanner((prev) => ({ ...prev, text: e.target.value.toUpperCase() }))
                          setSaveState('idle')
                        }}
                        placeholder="BANNER HOOK ATAS..."
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold font-sans text-zinc-100 focus:border-accent focus:outline-none"
                      />

                      <div>
                        <span className="block font-mono text-[10px] text-zinc-400 mb-1.5 uppercase tracking-wider font-semibold">
                          Font Hook Banner (2 Kolom)
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                          {FONT_OPTIONS.map((f) => {
                            const active = hookFont === f.key
                            return (
                              <button
                                key={f.key}
                                type="button"
                                onClick={() => {
                                  setHookFont(f.key)
                                  setSaveState('idle')
                                }}
                                style={{ fontFamily: f.family }}
                                className={`rounded-lg py-2 px-2.5 text-center text-xs truncate transition ${
                                  active
                                    ? 'border border-accent bg-accent/20 text-accent font-bold'
                                    : 'border border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                                }`}
                              >
                                {f.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Subtitle */}
            {activeTab === 'subtitle' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                    Pengaturan Subtitle
                  </p>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subtitle.enabled}
                      onChange={(e) => {
                        setSubtitle((prev) => ({ ...prev, enabled: e.target.checked }))
                        setSaveState('idle')
                      }}
                      className="rounded border-zinc-700"
                      style={{ accentColor: '#eaa33c' }}
                    />
                    Aktif
                  </label>
                </div>

                {subtitle.enabled && (
                  <>
                    {/* Pilihan Font Subtitle (2 Kolom) */}
                    <div>
                      <span className="block font-mono text-[10px] text-zinc-400 mb-1.5 uppercase tracking-wider font-semibold">
                        Font Subtitle (2 Kolom)
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {FONT_OPTIONS.map((f) => {
                          const active = subtitleFont === f.key
                          return (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => {
                                setSubtitleFont(f.key)
                                setSaveState('idle')
                              }}
                              style={{ fontFamily: f.family }}
                              className={`rounded-lg py-2 px-2.5 text-center text-xs truncate transition ${
                                active
                                  ? 'border border-accent bg-accent/20 text-accent font-bold'
                                  : 'border border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                              }`}
                            >
                              {f.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Posisi Subtitle (Atas, Tengah, Bawah) */}
                    <div className="border-t border-zinc-800/80 pt-3">
                      <span className="block font-mono text-[10px] text-zinc-400 mb-1.5 uppercase tracking-wider font-semibold">
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
                                  : 'border border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800'
                              }`}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Ukuran Font Subtitle (Presets + Slider 32..96) */}
                    <div className="border-t border-zinc-800/80 pt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                          Ukuran Font ({subtitleFontSize}px)
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 mb-2">
                        {[
                          [44, 'Kecil'],
                          [64, 'Sedang'],
                          [78, 'Besar'],
                          [92, 'Jumbo'],
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
                                  : 'border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100'
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
                    <div className="border-t border-zinc-800/80 pt-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
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
                        <span className="font-mono text-xs text-zinc-100 w-14 text-right">
                          {(subtitle.offset_sec ?? 0) > 0 ? `+${(subtitle.offset_sec ?? 0).toFixed(2)}s` : `${(subtitle.offset_sec ?? 0).toFixed(2)}s`}
                        </span>
                      </div>
                    </div>

                    {/* Warna Subtitle */}
                    <div className="grid grid-cols-2 gap-2 border-t border-zinc-800/80 pt-3">
                      <div>
                        <span className="block font-mono text-[10px] text-zinc-400 mb-1 font-semibold">Warna Teks</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={subtitle.color}
                            onChange={(e) => {
                              setSubtitle((p) => ({ ...p, color: e.target.value.toUpperCase() }))
                              setSaveState('idle')
                            }}
                            className="h-7 w-9 rounded cursor-pointer border border-zinc-700 bg-zinc-950"
                          />
                          <span className="font-mono text-xs text-zinc-300">{subtitle.color}</span>
                        </div>
                      </div>
                      <div>
                        <span className="block font-mono text-[10px] text-zinc-400 mb-1 font-semibold">Warna Highlight</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={subtitle.highlight_color}
                            onChange={(e) => {
                              setSubtitle((p) => ({ ...p, highlight_color: e.target.value.toUpperCase() }))
                              setSaveState('idle')
                            }}
                            className="h-7 w-9 rounded cursor-pointer border border-zinc-700 bg-zinc-950"
                          />
                          <span className="font-mono text-xs text-zinc-300">{subtitle.highlight_color}</span>
                        </div>
                      </div>
                    </div>

                    {/* Daftar Baris Subtitle Editable (Klik to Seek & Edit Teks) */}
                    <div className="border-t border-zinc-800/80 pt-3">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
                        Edit Cue ({rows.length} Baris)
                      </p>
                      <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
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
                                  : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700'
                              }`}
                            >
                              {/* Tombol Waktu (Klik to Seek) */}
                              <button
                                type="button"
                                onClick={() => seekTo(s)}
                                className="shrink-0 rounded bg-zinc-800 px-1.5 py-1 font-mono text-[10px] text-accent hover:bg-accent hover:text-void font-bold transition"
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
                                className="flex-1 min-w-0 bg-transparent text-xs text-zinc-100 outline-none border-b border-transparent focus:border-accent font-sans"
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

            {/* Tab 3: Export & Caption */}
            {activeTab === 'export' && (
              <div className="space-y-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 mb-2 font-semibold">
                    Ringkasan Render Final
                  </p>
                  <div className="space-y-1.5 text-xs text-zinc-400 font-mono rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex justify-between">
                      <span>Format</span>
                      <span className="text-zinc-100">MP4 (H.264 + AAC)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rasio Aspek</span>
                      <span className="text-accent font-bold">{aspectRatio}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tata Letak</span>
                      <span className="text-zinc-100">{isBlur ? 'Blur Background' : 'Full Crop'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Audio Target</span>
                      <span className="text-zinc-100">-14 LUFS Broadcast</span>
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
                      <span className="font-mono text-zinc-100 font-bold">{renderJob.progress_percent}%</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-950">
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
                      className={`${BTN_PRIMARY} w-full py-2.5 text-center text-sm font-bold shadow-md`}
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
                    className={`${BTN_PRIMARY} w-full py-2.5 text-sm font-bold shadow-md`}
                  >
                    {renderBusy ? 'Memulai Render…' : 'Mulai Render Video Final'}
                  </button>
                )}

                {renderError && (
                  <p role="alert" className="text-xs text-fail">
                    {renderError}
                  </p>
                )}

                {/* Panel Rekomendasi Caption (Gen Z + 3 Hashtag) */}
                <div className="border-t border-zinc-800/80 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                      Caption Medsos (Gen Z + 3 Tags)
                    </p>
                    <button
                      type="button"
                      onClick={handleRegenerateCaption}
                      disabled={regeneratingCaption}
                      className="text-[10px] font-mono text-accent hover:underline flex items-center gap-1"
                    >
                      {regeneratingCaption ? (
                        <span className="h-2.5 w-2.5 animate-spin rounded-full border border-accent/40 border-t-accent" />
                      ) : null}
                      <span>{regeneratingCaption ? 'Membuat…' : '✨ Buat Ulang'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={caption}
                    onChange={(e) => {
                      setCaption(e.target.value)
                      setCaptionError(null)
                      setSaveState('idle')
                    }}
                    placeholder="Caption media sosial otomatis..."
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-sans text-zinc-100 focus:border-accent focus:outline-none resize-none leading-relaxed"
                  />
                  {captionError && (
                    <p role="alert" className="mt-1.5 text-[11px] text-fail leading-snug">
                      {captionError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyCaption}
                    disabled={!caption}
                    className={`${BTN_GHOST} w-full mt-2 text-xs font-medium flex items-center justify-center gap-1.5`}
                  >
                    {captionCopied ? (
                      <span className="text-ok font-bold">✓ Tersalin ke Clipboard!</span>
                    ) : (
                      <span>📋 Salin Caption</span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
