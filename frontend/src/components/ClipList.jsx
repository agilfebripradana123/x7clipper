import { useState } from 'react'
import { prepareClip } from '../api'

const HOOK = {
  contrarian: 'Kontrarian',
  story: 'Cerita',
  actionable_tip: 'Tips praktis',
  emotional: 'Emosional',
  debate: 'Debat',
}

const BTN_SM =
  'inline-flex h-9 items-center justify-center rounded-md px-3.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50'
const BTN_PRIMARY = `${BTN_SM} bg-accent text-void hover:bg-accent-2`
const BTN_GHOST = `${BTN_SM} border border-line text-ink hover:border-line-2 hover:bg-panel-2`

function formatClipDuration(start, end) {
  const sec = Math.max(0, Math.round((end ?? 0) - (start ?? 0)))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function Spinner({ className = '' }) {
  return (
    <span
      className={`h-3.5 w-3.5 animate-spin rounded-full border-2 motion-reduce:animate-none ${className}`}
      aria-hidden="true"
    />
  )
}

function PrepareBadge({ status }) {
  const map = {
    idle: { text: 'Belum disiapkan', cls: 'text-faint', dot: 'bg-faint' },
    preparing: {
      text: 'Menyiapkan',
      cls: 'text-accent',
      dot: 'bg-accent animate-pulse motion-reduce:animate-none',
    },
    ready: { text: 'Siap', cls: 'text-ok', dot: 'bg-ok' },
    failed: { text: 'Gagal', cls: 'text-fail', dot: 'bg-fail' },
  }
  const m = map[status] || map.idle
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${m.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
      {m.text}
    </span>
  )
}

function ClipCard({ clip, error, busy, onPrepare }) {
  const preparing = clip.prepare_status === 'preparing' || busy
  const status = preparing ? 'preparing' : clip.prepare_status
  const hookLabel = HOOK[clip.hook_type] || clip.hook_type
  const message = error || (status === 'failed' ? clip.prepare_error : null)

  return (
    <li className="flex h-full flex-col rounded-xl border border-line bg-panel/60 p-4 transition-colors hover:border-line-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent"
            aria-label={`Skor viral ${clip.viral_score} dari 100`}
          >
            <span className="text-[9px] uppercase tracking-[0.1em] opacity-70">skor</span>
            <span className="text-xs">{clip.viral_score}</span>
          </span>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-muted">
            {hookLabel}
          </span>
        </div>
        <span className="shrink-0 font-mono text-xs text-faint">
          {formatClipDuration(clip.start_sec, clip.end_sec)}
        </span>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-ink">{clip.title}</h3>

      {clip.ai_reason && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{clip.ai_reason}</p>
      )}

      {clip.suggested_caption && (
        <blockquote className="mt-3 border-l-2 border-accent/30 pl-3 text-xs italic leading-relaxed text-faint">
          {clip.suggested_caption}
        </blockquote>
      )}

      {message && (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-fail">
          {message}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <PrepareBadge status={status} />
        {status === 'ready' ? (
          <button
            type="button"
            disabled
            title="Editor tersedia di tahap berikutnya"
            className={BTN_GHOST}
          >
            Buka editor
          </button>
        ) : status === 'failed' ? (
          <button type="button" onClick={() => onPrepare(clip)} disabled={busy} className={BTN_GHOST}>
            Coba lagi
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPrepare(clip)}
            disabled={preparing}
            className={BTN_PRIMARY}
          >
            {preparing ? (
              <>
                <Spinner className="mr-2 border-void/40 border-t-void" />
                Menyiapkan klip…
              </>
            ) : (
              'Edit Klip'
            )}
          </button>
        )}
      </div>
    </li>
  )
}

export default function ClipList({ project, onRefresh, onReset }) {
  const clips = project.clips || []
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState({})

  const handlePrepare = async (clip) => {
    setErrors((prev) => {
      if (!prev[clip.id]) return prev
      const next = { ...prev }
      delete next[clip.id]
      return next
    })
    setBusy((prev) => ({ ...prev, [clip.id]: true }))
    try {
      await prepareClip(clip.id)
      await onRefresh?.()
    } catch (err) {
      const firstError = err?.body?.errors ? Object.values(err.body.errors).flat()[0] : null
      const message = firstError || err?.body?.message || err?.message || 'Gagal menyiapkan klip.'
      setErrors((prev) => ({ ...prev, [clip.id]: message }))
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[clip.id]
        return next
      })
    }
  }

  return (
    <section className="mt-12" aria-labelledby="clips-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent/90">
            Hasil analisis
          </p>
          <h2 id="clips-heading" className="mt-2 font-display text-xl font-semibold text-ink sm:text-2xl">
            Rekomendasi klip
          </h2>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          {clips.length} klip
        </span>
      </div>

      {clips.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line bg-panel/40 p-6 text-center sm:p-8">
          <p className="text-sm text-muted">AI tidak menemukan momen yang cukup kuat di video ini.</p>
          <button type="button" onClick={onReset} className={`${BTN_GHOST} mt-4`}>
            Analisis video lain
          </button>
        </div>
      ) : (
        <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              error={errors[clip.id]}
              busy={!!busy[clip.id]}
              onPrepare={handlePrepare}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
