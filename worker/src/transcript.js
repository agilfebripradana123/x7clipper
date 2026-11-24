const TIMESTAMP_RE = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;
const CUE_SPLIT_RE = /\r?\n\r?\n/;
const ARROW_RE = /-->/;

export function parseTimestamp(value) {
  const match = value.match(TIMESTAMP_RE);
  if (!match) throw new Error(`Timestamp tidak valid: ${value}`);
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const ms = Number(match[4]);
  return Number((hours * 3600 + minutes * 60 + seconds + ms / 1000).toFixed(3));
}

function cleanText(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRawCues(transcriptText) {
  const blocks = transcriptText.split(CUE_SPLIT_RE);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const arrowLine = lines.find((line) => ARROW_RE.test(line));
    if (!arrowLine) continue;

    const [startRaw, endRaw] = arrowLine.split(/\s*-->\s*/);
    const start = parseTimestamp(startRaw);
    const end = parseTimestamp(endRaw.split(/\s+/)[0]);
    const textLines = lines.slice(lines.indexOf(arrowLine) + 1);
    const text = cleanText(textLines.join(' '));
    if (!text || end <= start) continue;

    // Filter rolling caption YouTube yang mengirimkan ulang kalimat sama
    const prev = cues[cues.length - 1];
    if (prev && prev.text === text) {
      prev.end = Math.max(prev.end, end);
      continue;
    }
    if (prev && text.startsWith(prev.text) && text.length > prev.text.length) {
      prev.text = text;
      prev.end = Math.max(prev.end, end);
      continue;
    }

    cues.push({ start, end, text });
  }

  return cues;
}

/**
 * Normalisasi cue VTT/SRT menjadi segmen kalimat 6-10 detik ber-ID [S{id}|{detik}].
 */
export function parseTranscript(transcriptText) {
  const rawCues = parseRawCues(transcriptText);
  if (rawCues.length === 0) {
    return { segments: [], segmentMap: {}, formattedText: '' };
  }

  const segments = [];
  let currentWords = [];
  let segStart = rawCues[0].start;
  let segEnd = rawCues[0].end;

  for (let i = 0; i < rawCues.length; i++) {
    const cue = rawCues[i];
    if (currentWords.length === 0) segStart = cue.start;
    segEnd = cue.end;
    currentWords.push(cue.text);

    const duration = segEnd - segStart;
    const endsWithPunct = /[.!?]$/.test(cue.text);
    const nextCue = rawCues[i + 1];
    const willExceed = nextCue && (nextCue.end - segStart > 10.0);

    if ((duration >= 6.0 && endsWithPunct) || duration >= 10.0 || willExceed || !nextCue) {
      const id = `S${segments.length + 1}`;
      const text = currentWords.join(' ').replace(/\s+/g, ' ').trim();
      segments.push({ id, start: segStart, end: segEnd, text });
      currentWords = [];
    }
  }

  const segmentMap = {};
  const formattedLines = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    segmentMap[seg.id] = { start: seg.start, end: seg.end, text: seg.text };

    if (idx > 0) {
      const prevSeg = segments[idx - 1];
      const pauseSec = Number((seg.start - prevSeg.end).toFixed(2));
      if (pauseSec >= 0.45) {
        formattedLines.push(`[PAUSE ${pauseSec}s]`);
      }
    }

    formattedLines.push(`[${seg.id}|${Math.floor(seg.start)}] ${seg.text}`);
  }

  return {
    segments,
    segmentMap,
    formattedText: formattedLines.join('\n'),
  };
}
