function rounded(value) {
  return Number(value.toFixed(3));
}

/**
 * Deteksi jeda hening (gap antar cue transkrip > minGapSec, default 1.2s)
 * lalu bangun array segmen aktif (cuts) dengan buffer pengaman.
 */
export function detectJumpCuts(subtitles, clipDuration, { minGapSec = 1.2, bufferSec = 0.15 } = {}) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return [{ start: 0, end: rounded(clipDuration) }];
  }

  const sorted = [...subtitles]
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(clipDuration, s.end) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) {
    return [{ start: 0, end: rounded(clipDuration) }];
  }

  const cuts = [];
  let currentStart = Math.max(0, sorted[0].start - bufferSec);
  let currentEnd = Math.min(clipDuration, sorted[0].end + bufferSec);

  for (let i = 1; i < sorted.length; i++) {
    const nextStart = Math.max(0, sorted[i].start - bufferSec);
    const nextEnd = Math.min(clipDuration, sorted[i].end + bufferSec);
    const gap = sorted[i].start - sorted[i - 1].end;

    if (gap > minGapSec && nextStart > currentEnd) {
      cuts.push({ start: rounded(currentStart), end: rounded(currentEnd) });
      currentStart = nextStart;
      currentEnd = nextEnd;
    } else {
      currentEnd = Math.max(currentEnd, nextEnd);
    }
  }

  cuts.push({ start: rounded(currentStart), end: rounded(currentEnd) });
  return cuts;
}

/**
 * Pecah segmen subtitle panjang menjadi potongan pendek viral (2-4 kata per baris)
 * dengan distribusi durasi proporsional berdasarkan panjang karakter kata.
 */
export function splitViralSubtitles(subtitles, { maxWordsPerLine = 3 } = {}) {
  if (!Array.isArray(subtitles)) throw new TypeError('subtitles harus array');
  const maxWords = Math.max(1, Math.min(6, Number(maxWordsPerLine) || 3));
  const result = [];

  for (const item of subtitles) {
    const rawText = String(item.text ?? '').trim();
    const duration = item.end - item.start;

    if (!rawText || duration <= 0) continue;

    const words = rawText.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      result.push({
        start: rounded(item.start),
        end: rounded(item.end),
        text: rawText,
      });
      continue;
    }

    // Kelompokkan kata menjadi potongan 2-3 kata
    const chunks = [];
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(' '));
    }

    // Hitung bobot karakter tiap chunk
    const totalChars = chunks.reduce((acc, c) => acc + c.length, 0);
    let currentStart = item.start;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;
      const chunkDur = isLast
        ? item.end - currentStart
        : duration * (chunk.length / totalChars);

      const chunkEnd = isLast ? item.end : rounded(currentStart + chunkDur);

      result.push({
        start: rounded(currentStart),
        end: rounded(chunkEnd),
        text: chunk,
      });

      currentStart = chunkEnd;
    }
  }

  return result;
}

/**
 * Ambil subtitle yang beririsan dengan klip, clamp batasnya, lalu geser ke 00:00.
 * Opsional: pecah ke potongan viral pendek jika viral: true.
 */
export function shiftSubtitles(segments, startSec, endSec, { viral = false, maxWords = 3 } = {}) {
  if (!Array.isArray(segments)) throw new TypeError('segments harus array');
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw new RangeError('Rentang subtitle tidak valid');
  }

  const shifted = segments
    .filter(({ start, end }) => end > startSec && start < endSec)
    .map(({ start, end, text }) => ({
      start: rounded(Math.max(start, startSec) - startSec),
      end: rounded(Math.min(end, endSec) - startSec),
      text,
    }));

  return viral ? splitViralSubtitles(shifted, { maxWordsPerLine: maxWords }) : shifted;
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

/** Serialisasi subtitle hasil shift ke SRT. */
export function toSrt(subtitles) {
  return subtitles.map(({ start, end, text }, index) => (
    `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}`
  )).join('\n\n') + (subtitles.length ? '\n' : '');
}

export function assTime(seconds) {
  const centis = Math.round(seconds * 100);
  const hours = Math.floor(centis / 360_000);
  const minutes = Math.floor((centis % 360_000) / 6_000);
  const secs = Math.floor((centis % 6_000) / 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
}

/** Hex `#RRGGBB` -> ASS PrimaryColour `&HAABBGGRR`. Nilai tak valid jadi putih. */
export function assColour(hex, alpha = '00') {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ''));
  if (!match) return `&H${alpha}FFFFFF`;
  const rgb = match[1];
  return `&H${alpha}${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toUpperCase();
}

/** Serialisasi subtitle ke ASS dasar dengan dukungan highlight kata viral. */
export function toAss(subtitles, {
  fontName = 'Montserrat',
  fontSize = 42,
  alignment = 2,
  primaryColour = '&H00FFFFFF',
  highlightColour = '&H0000E6FF', // Kuning terang ASS (&HAABBGGRR)
  highlightKeywords = [],
  playResX = 1080,
  playResY = 1920,
} = {}) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,${fontName},${fontSize},${primaryColour},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,2,${alignment},20,20,40,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const kwSet = new Set((highlightKeywords || []).map((k) => String(k).toUpperCase().trim()));

  const events = subtitles.map(({ start, end, text }) => {
    let processedText = String(text ?? '').toUpperCase().trim();

    // Jika kata cocok dengan highlight_keywords, beri tag warna highlight
    if (kwSet.size > 0) {
      const words = processedText.split(/\s+/);
      const highlighted = words.map((w) => {
        const cleanWord = w.replace(/[^A-Z0-9]/g, '');
        if (kwSet.has(cleanWord)) {
          return `{\\c${highlightColour}&}${w}{\\c${primaryColour}&}`;
        }
        return w;
      });
      processedText = highlighted.join(' ');
    }

    const escaped = processedText.replace(/\\(?!c|N)/g, '\\\\').replace(/\r?\n/g, '\\N');
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${escaped}`;
  });

  return `${header}\n${events.join('\n')}\n`;
}
