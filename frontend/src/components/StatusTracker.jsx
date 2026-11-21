import { useEffect, useRef } from 'react'

const STAGES = [
  { key: 'queued', label: 'Antrean', hint: 'Menunggu giliran' },
  { key: 'extracting', label: 'Ekstraksi', hint: 'Mengambil transkrip' },
  { key: 'analyzing', label: 'Analisis', hint: 'AI memilih momen' },
  { key: 'ready', label: 'Siap', hint: 'Klip siap ditinjau' },
]

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Cross() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

const NODE = {
  done: 'border-accent bg-accent text-void',
  active: 'border-accent bg-panel-2 text-accent',
  pending: 'border-line bg-panel text-faint',
  failed: 'border-fail bg-panel-2 text-fail',
}
const LABEL = {
  done: 'text-ink',
  active: 'text-accent',
  pending: 'text-faint',
  failed: 'text-fail',
}

export default function StatusTracker({ status }) {
  const lastRef = useRef(0)
  const current = STAGES.findIndex((s) => s.key === status)

  useEffect(() => {
    if (current >= 0) lastRef.current = current
  }, [current])

  const failed = status === 'failed'
  const ready = status === 'ready'
  const activeIdx = failed ? lastRef.current : current >= 0 ? current : 0
  const fill = `${(activeIdx / (STAGES.length - 1)) * 75}%`

  const stateOf = (i) => {
    if (failed && i === activeIdx) return 'failed'
    if (ready) return 'done'
    if (i < activeIdx) return 'done'
    if (i === activeIdx) return 'active'
    return 'pending'
  }

  return (
    <div className="relative">
      <div className="absolute inset-x-[12.5%] top-[18px] h-px bg-line" aria-hidden="true" />
      <div
        className={`absolute left-[12.5%] top-[18px] h-px transition-[width] duration-700 ease-out ${
          failed ? 'bg-fail/60' : 'bg-accent'
        }`}
        style={{ width: fill }}
        aria-hidden="true"
      />

      <ol className="relative grid grid-cols-4">
        {STAGES.map((stage, i) => {
          const state = stateOf(i)
          return (
            <li key={stage.key} className="flex flex-col items-center text-center">
              <span
                className={`relative grid h-9 w-9 place-items-center rounded-lg border font-mono text-[11px] transition-colors duration-300 ${NODE[state]}`}
              >
                {state === 'active' && <span className="stage-pulse" aria-hidden="true" />}
                {state === 'done' ? (
                  <Check />
                ) : state === 'failed' ? (
                  <Cross />
                ) : (
                  String(i + 1).padStart(2, '0')
                )}
              </span>
              <span className={`mt-3 font-mono text-[10px] uppercase tracking-[0.14em] ${LABEL[state]}`}>
                {stage.label}
              </span>
              <span className="mt-1 hidden text-xs text-faint sm:block">{stage.hint}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
