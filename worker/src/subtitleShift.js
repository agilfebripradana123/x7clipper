function rounded(value) {
  return Number(value.toFixed(3));
}

/**
 * Ambil subtitle yang beririsan dengan klip, clamp batasnya, lalu geser ke 00:00.
 */
export function shiftSubtitles(segments, startSec, endSec) {
  if (!Array.isArray(segments)) throw new TypeError('segments harus array');
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
    throw new RangeError('Rentang subtitle tidak valid');
  }

  return segments
    .filter(({ start, end }) => end > startSec && start < endSec)
    .map(({ start, end, text }) => ({
      start: rounded(Math.max(start, startSec) - startSec),
      end: rounded(Math.min(end, endSec) - startSec),
      text,
    }));
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

function assTime(seconds) {
  const centis = Math.round(seconds * 100);
  const hours = Math.floor(centis / 360_000);
  const minutes = Math.floor((centis % 360_000) / 6_000);
  const secs = Math.floor((centis % 6_000) / 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
}

/** Serialisasi subtitle ke ASS dasar, kompatibel filter subtitles FFmpeg. */
export function toAss(subtitles, { fontName = 'Arial', fontSize = 36 } = {}) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,40,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;

  const events = subtitles.map(({ start, end, text }) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
    return `Dialogue: 0,${assTime(start)},${assTime(end)},Default,,0,0,0,,${escaped}`;
  });

  return `${header}\n${events.join('\n')}\n`;
}
