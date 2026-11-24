/**
 * Refiner batas awal dan akhir klip untuk mencegah awalan menggantung
 * dan akhiran terpotong di tengah kalimat.
 */

// Kata sambung/referensi gantung di awal kalimat yang mengindikasikan
// klip dimulai di tengah pemikiran atau merujuk ke kalimat sebelumnya.
const LEADING_CONJUNCTIONS = new Set([
  'dan', 'tapi', 'tetapi', 'soalnya', 'karena', 'makanya',
  'terus', 'lalu', 'akhirnya', 'itu', 'gitu', 'padahal', 'sedangkan'
]);

// Kata sambung/preposisi/partikel di akhir kalimat yang mengindikasikan
// pembicara belum selesai berbicara atau kalimat menggantung.
const TRAILING_CONJUNCTIONS = new Set([
  'dan', 'tapi', 'karena', 'jadi', 'terus', 'kalau', 'yang', 'atau',
  'untuk', 'dengan', 'di', 'ke', 'nah', 'itu', 'seperti', 'kayak'
]);

function getFirstWord(text) {
  const words = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/i, '')
    .split(/\s+/);
  return words[0] || '';
}

function getLastWord(text) {
  const words = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+$/i, '')
    .split(/\s+/);
  return words[words.length - 1] || '';
}

function hasEndPunctuation(text) {
  return /[.!?]["']?\s*$/.test(String(text ?? '').trim());
}

/**
 * Haluskan batas klip berdasarkan transkrip cues/segmen.
 *
 * @param {Array<{id?: string, start: number, end: number, text: string}>} cues
 * @param {number} startIdx
 * @param {number} endIdx
 * @returns {{ startIdx: number, endIdx: number }}
 */
export function refineClipBoundaries(cues, startIdx, endIdx) {
  if (!Array.isArray(cues) || cues.length === 0) {
    return { startIdx, endIdx };
  }

  let s = Math.max(0, Math.min(startIdx, cues.length - 1));
  let e = Math.max(s, Math.min(endIdx, cues.length - 1));

  // 1. Guard Pembuka (Start):
  // Jika cue di startIdx diawali kata sambung/referensi gantung dan jarak dengan cue sebelumnya < 0.5s,
  // mundurkan startIdx maksimal 2–3 cue hingga menemukan jeda alami (gap >= 0.45s) atau awal kalimat jelas.
  let startRewinds = 0;
  while (s > 0 && startRewinds < 3) {
    const curCue = cues[s];
    const prevCue = cues[s - 1];
    const firstWord = getFirstWord(curCue.text);
    const gapWithPrev = curCue.start - prevCue.end;

    if (LEADING_CONJUNCTIONS.has(firstWord) && gapWithPrev < 0.50) {
      s--;
      startRewinds++;
      // Jika setelah mundur ditemukan jeda alami sebelum cue ini, berhenti
      if (s > 0 && (cues[s].start - cues[s - 1].end >= 0.45)) {
        break;
      }
    } else {
      break;
    }
  }

  // 2. Guard Penutup (End):
  // Jika cue di endIdx diakhiri kata sambung/kalimat menggantung atau tidak diikuti tanda baca akhir (. ? !)
  // dan jarak ke cue berikutnya < 0.45s, majukan endIdx maksimal 4–6 cue (hingga maks +12s)
  // sampai bertemu tanda baca akhir atau jeda bicara >= 0.45s.
  let endAdvances = 0;
  const initialEndSec = cues[e].end;

  while (e < cues.length - 1 && endAdvances < 6) {
    const curCue = cues[e];
    const nextCue = cues[e + 1];
    const lastWord = getLastWord(curCue.text);
    const hasPunct = hasEndPunctuation(curCue.text);
    const gapToNext = nextCue.start - curCue.end;

    const isTrailingConjunction = TRAILING_CONJUNCTIONS.has(lastWord);
    const isHanging = !hasPunct && gapToNext < 0.45;

    if (isTrailingConjunction || isHanging) {
      // Pastikan tidak melompat melebihi batas durasi tambahan +12 detik
      if (nextCue.end - initialEndSec > 12.0) {
        break;
      }
      e++;
      endAdvances++;
      // Jika cue baru memiliki jeda berikutnya >= 0.45s atau punya tanda baca akhir, bisa berhenti
      if (hasEndPunctuation(cues[e].text) || (e < cues.length - 1 && cues[e + 1].start - cues[e].end >= 0.45)) {
        break;
      }
    } else {
      break;
    }
  }

  return { startIdx: s, endIdx: e };
}
