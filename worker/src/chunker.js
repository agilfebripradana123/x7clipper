const FULL_TRANSCRIPT_MAX_SEC = 1_200;
const WINDOW_SEC = 900;
const OVERLAP_SEC = 120;

function formatSegments(segments) {
  const lines = [];
  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (idx > 0) {
      const prev = segments[idx - 1];
      const pauseSec = Number((seg.start - prev.end).toFixed(2));
      if (pauseSec >= 0.45) {
        lines.push(`[PAUSE ${pauseSec}s]`);
      }
    }
    lines.push(`[${seg.id}|${Math.floor(seg.start)}] ${seg.text}`);
  }
  return lines.join('\n');
}

/**
 * Bagi transkrip ke window analisis AI.
 * Video <20 menit tetap satu request; sisanya 15 menit dengan overlap 2 menit.
 */
export function chunkSegments(segments, durationSec) {
  if (!Number.isFinite(durationSec) || durationSec < 0) throw new RangeError('durationSec harus angka >= 0');

  if (durationSec < FULL_TRANSCRIPT_MAX_SEC) {
    return [{
      chunkIndex: 0,
      startSec: 0,
      endSec: durationSec,
      segments,
      formattedText: formatSegments(segments),
    }];
  }

  const chunks = [];
  for (let startSec = 0; startSec < durationSec; startSec += WINDOW_SEC - OVERLAP_SEC) {
    const endSec = Math.min(startSec + WINDOW_SEC, durationSec);
    const chunkSegments = segments.filter(({ start, end }) => end > startSec && start < endSec);
    chunks.push({
      chunkIndex: chunks.length,
      startSec,
      endSec,
      segments: chunkSegments,
      formattedText: formatSegments(chunkSegments),
    });
    if (endSec === durationSec) break;
  }
  return chunks;
}
